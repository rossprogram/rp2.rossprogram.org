/*
 * normalize-timezones: find and repair student timezone answers that are not
 * real IANA zones.
 *
 * The timezone question is a free-text input with a datalist of suggestions,
 * not a closed select, and nothing validates it on save — so answers like
 * 'Asia/Beijing', 'Shanghai', 'America/Los Angeles' and, memorably,
 * 'Asia/SingaporeSingapore' are all in the table. Most sit on abandoned
 * drafts and do no harm, but a bad zone on an ENROLLED student cannot be used
 * to reconstruct their section's meeting time, and would go on to break any
 * per-student time arithmetic.
 *
 * Nothing is guessed. Whitespace is trimmed on request because that is
 * unambiguous; every other correction has to be named explicitly, because
 * deciding that 'Shanghai' means Asia/Shanghai is a judgement about a real
 * person's location, not a string operation.
 *
 * Dry run by default.
 *
 * Usage:
 *   pnpm --filter @rp2/backend normalize-timezones
 *   pnpm --filter @rp2/backend normalize-timezones -- --trim --apply
 *   pnpm --filter @rp2/backend normalize-timezones -- --set APPID=Asia/Singapore --apply
 */

import { and, eq } from 'drizzle-orm';
import { isValidTimeZone } from '@rp2/shared';
import { db } from '../db/client.js';
import { application, applicationResponse } from '../db/schema.js';

const QUESTION_KEY = 'student_timezone';

function usage(): never {
  console.error('usage: normalize-timezones [--trim] [--set APPID=Zone ...] [--apply]');
  process.exit(2);
}

const now = (): number => Math.floor(Date.now() / 1000);

function readJson(raw: string): string | null {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

function write(applicationId: string, zone: string): void {
  db.update(applicationResponse)
    .set({ value: JSON.stringify(zone), updatedAt: now() })
    .where(
      and(
        eq(applicationResponse.applicationId, applicationId),
        eq(applicationResponse.questionKey, QUESTION_KEY),
      ),
    )
    .run();
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const trim = args.includes('--trim');

  const sets = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== '--set') continue;
    const pair = args[i + 1];
    if (!pair || !pair.includes('=')) usage();
    const [id, zone] = pair.split(/=(.*)/s) as [string, string];
    // Validate before anything is written, so a typo in the fix cannot
    // replace one bad zone with another.
    if (!isValidTimeZone(zone)) {
      console.error(`  ! "${zone}" is not a timezone Intl recognises. Nothing written.`);
      process.exit(2);
    }
    sets.set(id, zone);
    i += 1;
  }
  if (args.some((a) => a.startsWith('--') && !['--apply', '--trim', '--set'].includes(a))) usage();

  const rows = db
    .select({
      applicationId: applicationResponse.applicationId,
      value: applicationResponse.value,
      status: application.status,
    })
    .from(applicationResponse)
    .innerJoin(application, eq(application.id, applicationResponse.applicationId))
    .where(eq(applicationResponse.questionKey, QUESTION_KEY))
    .all();

  console.log(apply ? 'Applying:' : 'Dry run (pass --apply to write):');
  console.log(`  timezone answers: ${rows.length}`);
  console.log('');

  let fixed = 0;
  let remaining = 0;

  for (const r of rows) {
    const stored = readJson(r.value);
    if (stored === null) continue;

    const trimmed = stored.trim();
    const named = sets.get(r.applicationId);
    const valid = isValidTimeZone(trimmed);

    // Nothing wrong with it.
    if (valid && trimmed === stored && !named) continue;

    const enrolled = r.status === 'enrolled';
    const tag = enrolled ? 'ENROLLED' : r.status;

    if (named) {
      console.log(`  ${r.applicationId} [${tag}]  "${stored}" -> "${named}"  (named)`);
      if (apply) write(r.applicationId, named);
      fixed += 1;
      continue;
    }

    if (valid && trimmed !== stored) {
      // Whitespace only: unambiguous, so --trim may fix it.
      if (trim) {
        console.log(`  ${r.applicationId} [${tag}]  "${stored}" -> "${trimmed}"  (trimmed)`);
        if (apply) write(r.applicationId, trimmed);
        fixed += 1;
      } else {
        console.log(`  ${r.applicationId} [${tag}]  "${stored}"  has stray whitespace — pass --trim`);
        remaining += 1;
      }
      continue;
    }

    console.log(
      `  ${r.applicationId} [${tag}]  "${stored}" is not a real zone` +
        `  — fix with --set ${r.applicationId}=<Zone>`,
    );
    remaining += 1;
  }

  console.log('');
  console.log(`  ${apply ? 'fixed' : 'would fix'}: ${fixed}`);
  if (remaining > 0) {
    console.log(`  still broken: ${remaining}`);
    // Only an enrolled student's bad zone actually costs anything today.
    const enrolledBroken = rows.filter((r) => {
      const v = readJson(r.value);
      return (
        r.status === 'enrolled' &&
        v !== null &&
        !sets.has(r.applicationId) &&
        (!isValidTimeZone(v.trim()) || (!trim && v !== v.trim()))
      );
    }).length;
    if (enrolledBroken > 0) {
      console.log(`  !! ${enrolledBroken} of them belong to ENROLLED students.`);
      process.exitCode = 1;
    } else {
      console.log('  (none of them enrolled — drafts and past applicants only)');
    }
  }
}

main();
