/*
 * zoom-remove: detach users who no longer belong on the Ross Zoom account.
 *
 * Disassociate, not delete, by default. Disassociating unlinks someone from
 * the account and leaves them their own free Zoom account with their content
 * intact; deleting destroys it. These are former participants from an older
 * platform, not data we own, and the reversible option is the right one.
 *
 * Three guards, because this acts on nearly two hundred real people:
 *
 *   - the keep set is DERIVED from section_staff, not typed, so it cannot
 *     drift from who is actually teaching;
 *   - licensed accounts are refused outright unless named, because a licence
 *     on this account means staff — Blaze's Zoom address is
 *     okonogi@rossprogram.org while the portal knows him as a gmail address,
 *     so he appeared as a removal candidate on the first audit;
 *   - a recording check that cannot be performed counts as UNKNOWN and stops
 *     the run, rather than being read as "none".
 *
 * Dry run by default.
 *
 * Usage:
 *   pnpm --filter @rp2/backend zoom-remove -- --keep a@b.com
 *   pnpm --filter @rp2/backend zoom-remove -- --keep a@b.com --apply
 *   pnpm --filter @rp2/backend zoom-remove -- --keep a@b.com --apply --delete
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { section, sectionStaff, user, zoomAccount } from '../db/schema.js';
import {
  ZoomError,
  countRecordings,
  listUsers,
  removeUser,
  type ZoomUser,
} from '../integrations/zoom/index.js';

function usage(): never {
  console.error(
    'usage: zoom-remove [--keep EMAIL ...] [--apply] [--delete] [--allow-licensed] [--since YYYY-MM-DD]',
  );
  process.exit(2);
}

/** Pause between calls: nearly 200 deletions is exactly where a burst gets throttled. */
const GAP_MS = 350;

/** Protected addresses: both the portal one and the Zoom one, where they differ. */
function staffEmails(): Set<string> {
  const rows = db
    .select({ email: user.email, zoomEmail: zoomAccount.zoomEmail })
    .from(sectionStaff)
    .innerJoin(user, eq(user.id, sectionStaff.userId))
    .innerJoin(section, eq(section.id, sectionStaff.sectionId))
    .leftJoin(zoomAccount, eq(zoomAccount.userId, sectionStaff.userId))
    .all();

  const out = new Set<string>();
  for (const r of rows) {
    out.add(r.email.toLowerCase());
    if (r.zoomEmail) out.add(r.zoomEmail.toLowerCase());
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const hard = args.includes('--delete');
  const allowLicensed = args.includes('--allow-licensed');
  const keepExtra = new Set<string>();
  let since = '2024-01-01';

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === '--keep') {
      const v = args[i + 1];
      if (!v) usage();
      keepExtra.add(v.trim().toLowerCase());
      i += 1;
    } else if (a === '--since') {
      const v = args[i + 1];
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) usage();
      since = v;
      i += 1;
    } else if (!['--apply', '--delete', '--allow-licensed'].includes(a)) {
      usage();
    }
  }

  const action = hard ? 'delete' : 'disassociate';
  const keep = new Set([...staffEmails(), ...keepExtra]);
  const users = await listUsers('active');
  const today = new Date().toISOString().slice(0, 10);

  const candidates = users.filter((u) => !keep.has(u.email.toLowerCase()));

  console.log(apply ? `Applying: ${action}` : `Dry run — would ${action} (pass --apply):`);
  console.log(`  active users: ${users.length}`);
  console.log(`  protected: ${users.length - candidates.length}`);
  console.log(`  candidates: ${candidates.length}`);
  console.log('');

  // Licensed accounts are staff. Never sweep one up in a bulk removal.
  const licensed = candidates.filter((u) => u.type === 2);
  if (licensed.length > 0 && !allowLicensed) {
    console.log(`  !! ${licensed.length} candidate(s) hold a LICENCE and will be skipped:`);
    for (const u of licensed) console.log(`     ${u.email}`);
    console.log('     A licence on this account means staff. Name them with --keep,');
    console.log('     or pass --allow-licensed if you really mean it.');
    console.log('');
  }

  const actionable = candidates.filter((u) => allowLicensed || u.type !== 2);

  console.log(`  checking recordings for ${actionable.length}…`);
  const unknown: ZoomUser[] = [];
  const withRecordings: { u: ZoomUser; n: number }[] = [];
  const clear: ZoomUser[] = [];

  for (const u of actionable) {
    const n = await countRecordings(u.id, since, today);
    if (n === null) unknown.push(u);
    else if (n > 0) withRecordings.push({ u, n });
    else clear.push(u);
  }

  if (unknown.length > 0) {
    console.log('');
    console.log(`  !! could not check recordings for ${unknown.length} account(s).`);
    console.log('     That is UNKNOWN, not zero. Nothing will be touched.');
    for (const u of unknown.slice(0, 10)) console.log(`     ${u.email}`);
    process.exitCode = 1;
    return;
  }

  if (withRecordings.length > 0) {
    console.log('');
    console.log(`  ${withRecordings.length} have cloud recordings:`);
    for (const { u, n } of withRecordings) console.log(`     ${u.email}  ${n} recording(s)`);
    if (action === 'delete') {
      console.log('     Deleting destroys these. Disassociate instead, or --keep them.');
      process.exitCode = 1;
      return;
    }
    console.log('     Disassociating leaves these with their owner, intact.');
  }

  const targets = [...clear, ...withRecordings.map((w) => w.u)];
  console.log('');
  console.log(`  ${apply ? 'removing' : 'would remove'}: ${targets.length}`);

  if (!apply) {
    for (const u of targets.slice(0, 15)) console.log(`     ${u.email}`);
    if (targets.length > 15) console.log(`     … and ${targets.length - 15} more`);
    console.log('');
    console.log(`  Re-run with --apply to ${action} them.`);
    return;
  }

  let done = 0;
  const failed: { email: string; why: string }[] = [];

  for (const u of targets) {
    try {
      await removeUser(u.id, action);
      done += 1;
      if (done % 25 === 0) console.log(`     …${done}/${targets.length}`);
    } catch (err) {
      // One stubborn account must not abandon the other 194.
      failed.push({
        email: u.email,
        why: err instanceof ZoomError ? `${err.status} ${err.message}` : String(err),
      });
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  console.log('');
  console.log(`  ${action}d: ${done}`);
  if (failed.length > 0) {
    console.log(`  failed: ${failed.length}`);
    for (const f of failed.slice(0, 20)) console.log(`     ${f.email} — ${f.why}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
