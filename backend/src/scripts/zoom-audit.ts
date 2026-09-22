/*
 * zoom-audit: inventory the Zoom account and say who could be removed.
 *
 * READ ONLY. It never deletes anything, by design — the point is to produce a
 * list a person can read and argue with before anything irreversible happens.
 *
 * "Keep" is derived rather than typed: the sections table already knows which
 * instructor teaches what, so the mentors to keep are whoever holds a section,
 * plus anyone named with --keep. That way the list cannot drift from who is
 * actually teaching.
 *
 * Removing a Zoom user takes their cloud recordings with them, so every
 * candidate is checked for recordings and the ones that have any are listed
 * separately. For a program whose sessions involve minors, that is not a
 * detail to discover afterwards.
 *
 * Usage:
 *   pnpm --filter @rp2/backend zoom-audit
 *   pnpm --filter @rp2/backend zoom-audit -- --keep fowler@rossprogram.org
 *   pnpm --filter @rp2/backend zoom-audit -- --recordings-since 2024-01-01
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { section, sectionStaff, user } from '../db/schema.js';
import { countRecordings, listUsers, type ZoomUser } from '../integrations/zoom/index.js';

function usage(): never {
  console.error('usage: zoom-audit [--keep EMAIL ...] [--recordings-since YYYY-MM-DD]');
  process.exit(2);
}

const TYPE_NAME: Record<number, string> = { 1: 'Basic', 2: 'Licensed', 3: 'On-prem' };

/** Everyone the portal says is teaching or assisting a section. */
function staffEmails(): Map<string, string> {
  const rows = db
    .select({ email: user.email, label: section.label, role: sectionStaff.role })
    .from(sectionStaff)
    .innerJoin(user, eq(user.id, sectionStaff.userId))
    .innerJoin(section, eq(section.id, sectionStaff.sectionId))
    .all();

  const out = new Map<string, string>();
  for (const r of rows) {
    const key = r.email.toLowerCase();
    const held = out.get(key);
    out.set(key, held ? `${held}, ${r.label}` : `${r.label} (${r.role})`);
  }
  return out;
}

function age(iso: string | null): string {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return 'unknown';
  if (days < 60) return `${days}d ago`;
  if (days < 730) return `${Math.floor(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const keepExtra = new Set<string>();
  let since = '2024-01-01';

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--keep') {
      const v = args[i + 1];
      if (!v) usage();
      keepExtra.add(v.trim().toLowerCase());
      i += 1;
    } else if (args[i] === '--recordings-since') {
      const v = args[i + 1];
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) usage();
      since = v;
      i += 1;
    } else {
      usage();
    }
  }

  const staff = staffEmails();
  const users = await listUsers('active');

  const keep: { u: ZoomUser; why: string }[] = [];
  const candidates: ZoomUser[] = [];

  for (const u of users) {
    const email = u.email.toLowerCase();
    if (staff.has(email)) keep.push({ u, why: `teaches ${staff.get(email)}` });
    else if (keepExtra.has(email)) keep.push({ u, why: 'named with --keep' });
    else candidates.push(u);
  }

  console.log('Zoom account inventory (read only — nothing is changed)');
  console.log(`  active users: ${users.length}`);
  console.log(`  licensed: ${users.filter((u) => u.type === 2).length}`);
  console.log('');

  console.log(`KEEP (${keep.length})`);
  for (const { u, why } of keep.sort((a, b) => a.u.email.localeCompare(b.u.email))) {
    console.log(
      `  ${u.email.padEnd(38)} ${(TYPE_NAME[u.type] ?? String(u.type)).padEnd(9)} last login ${age(u.lastLoginAt).padEnd(10)} — ${why}`,
    );
  }
  console.log('');

  // Anyone on the portal roster who has no Zoom account yet is the other half
  // of this picture, and the reason a section could end up unhostable.
  const zoomEmails = new Set(users.map((u) => u.email.toLowerCase()));
  const missing = [...staff.keys()].filter((e) => !zoomEmails.has(e));
  if (missing.length > 0) {
    console.log(`MISSING FROM ZOOM (${missing.length}) — teaching a section with no Zoom account`);
    for (const e of missing.sort()) console.log(`  ${e.padEnd(38)} ${staff.get(e)}`);
    console.log('');
  }

  console.log(`CANDIDATES FOR REMOVAL (${candidates.length}) — checking recordings…`);
  const withRecordings: { u: ZoomUser; n: number }[] = [];
  const clean: ZoomUser[] = [];

  for (const u of candidates) {
    const n = await countRecordings(u.id, since, new Date().toISOString().slice(0, 10));
    if (n > 0) withRecordings.push({ u, n });
    else clean.push(u);
  }

  if (withRecordings.length > 0) {
    console.log('');
    console.log(`  !! ${withRecordings.length} have cloud recordings since ${since}.`);
    console.log('     Removing a user deletes their recordings. Decide these individually.');
    for (const { u, n } of withRecordings.sort((a, b) => b.n - a.n)) {
      console.log(`     ${u.email.padEnd(38)} ${String(n).padStart(4)} recording(s)  last login ${age(u.lastLoginAt)}`);
    }
  }

  console.log('');
  console.log(`  ${clean.length} with no recordings since ${since}:`);
  for (const u of clean.sort((a, b) => a.email.localeCompare(b.email))) {
    console.log(
      `     ${u.email.padEnd(38)} ${(TYPE_NAME[u.type] ?? String(u.type)).padEnd(9)} created ${age(u.createdAt).padEnd(10)} last login ${age(u.lastLoginAt)}`,
    );
  }

  console.log('');
  console.log('Nothing has been changed. Removal is a separate, deliberate step.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
