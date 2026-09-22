/*
 * backfill-sections: turn the free-text section strings on offers into real
 * section rows, and generate the term's session occurrences.
 *
 * The meeting time is not stored anywhere. `offer.problem_session` holds each
 * student's OWN local rendering — 'Sun 09:00' for New York and 'Sun 21:00' for
 * Singapore are the same meeting, and 'Fri 19:30' / 'Sat 07:30' are too. So
 * this reconstructs the true time by converting every student's local string
 * through their stated timezone and insisting they all agree.
 *
 * That insistence is the point. A section whose students disagree has a real
 * scheduling error in it, and it is far better to see that now than to
 * discover in week 7 that attendance never matched for a dozen students.
 *
 * Dry run by default.
 *
 * Usage:
 *   pnpm --filter @rp2/backend backfill-sections            # report only
 *   pnpm --filter @rp2/backend backfill-sections -- --apply
 */

import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  PROGRAM_TIMEZONE,
  SESSION_KINDS,
  TERM_KEY,
  formatScheduleString,
  occurrencesFor,
  resolveSectionTime,
  type SessionKind,
  type StudentSchedule,
} from '@rp2/shared';
import { db } from '../db/client.js';
import {
  application,
  applicationResponse,
  offer,
  section,
  sessionOccurrence,
} from '../db/schema.js';

function usage(): never {
  console.error('usage: backfill-sections [--apply]');
  process.exit(2);
}

const now = (): number => Math.floor(Date.now() / 1000);

type Row = {
  applicationId: string;
  label: string;
  courseKey: string | null;
  problemSession: string | null;
  officeHours: string | null;
  timeZone: string;
};

/** Every enrolled student's placement plus the timezone they told us. */
function loadRows(): Row[] {
  const offers = db
    .select({
      applicationId: application.id,
      label: offer.section,
      courseKey: offer.courseKey,
      problemSession: offer.problemSession,
      officeHours: offer.officeHours,
    })
    .from(application)
    .innerJoin(offer, eq(offer.applicationId, application.id))
    .where(eq(application.status, 'enrolled'))
    .all();

  const zones = new Map<string, string>();
  for (const r of db
    .select({ applicationId: applicationResponse.applicationId, value: applicationResponse.value })
    .from(applicationResponse)
    .where(eq(applicationResponse.questionKey, 'student_timezone'))
    .all()) {
    try {
      const v: unknown = JSON.parse(r.value);
      if (typeof v === 'string') zones.set(r.applicationId, v);
    } catch {
      /* a malformed response is reported later as an unusable row */
    }
  }

  return offers
    .filter((o): o is typeof o & { label: string } => Boolean(o.label))
    .map((o) => ({ ...o, timeZone: zones.get(o.applicationId) ?? '' }));
}

/** 'QUADRATIC-2' -> 2. */
function sectionNumberOf(label: string): number | null {
  const m = /^[A-Za-z]+-([0-9]+)$/.exec(label.trim());
  return m ? Number(m[1]) : null;
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  if (args.some((a) => a.startsWith('-') && a !== '--apply')) usage();

  const rows = loadRows();
  if (rows.length === 0) {
    console.error('No enrolled students with a section. Nothing to do.');
    process.exit(1);
  }

  const byLabel = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byLabel.get(r.label) ?? [];
    list.push(r);
    byLabel.set(r.label, list);
  }

  console.log(apply ? 'Applying:' : 'Dry run (pass --apply to write):');
  console.log(`  enrolled students with a placement: ${rows.length}`);
  console.log(`  distinct sections: ${byLabel.size}`);
  console.log('');

  let problems = 0;
  let occurrenceTotal = 0;

  for (const [label, members] of [...byLabel].sort()) {
    const courseKey = members.find((m) => m.courseKey)?.courseKey ?? null;
    const number = sectionNumberOf(label);

    if (!courseKey || number === null) {
      console.log(`  ${label}: SKIPPED — course key or section number missing`);
      problems += 1;
      continue;
    }

    console.log(`  ${label} (${courseKey}, ${members.length} students)`);

    const resolved: Partial<Record<SessionKind, { weekday: number; minuteOfDay: number }>> = {};

    for (const kind of SESSION_KINDS) {
      const schedules: StudentSchedule[] = members.map((m) => ({
        ref: m.applicationId,
        local: (kind === 'problem_session' ? m.problemSession : m.officeHours) ?? '',
        timeZone: m.timeZone,
      }));

      const result = resolveSectionTime(schedules);
      if (!result.ok) {
        problems += 1;
        console.log(`      ${kind}: UNRESOLVED (${result.reason})`);
        for (const line of result.detail) console.log(`        ${line}`);
        continue;
      }

      resolved[kind] = { weekday: result.weekday, minuteOfDay: result.minuteOfDay };
      const when = formatScheduleString(result.weekday, result.minuteOfDay);
      console.log(
        `      ${kind}: ${when} ${PROGRAM_TIMEZONE}  (${result.agreed}/${members.length} agree)`,
      );
      // Name the unusable rows. A bare count is not something anyone can act on.
      for (const line of result.skipped) {
        problems += 1;
        console.log(`        ! ${line}`);
      }
    }

    // Occurrence counts, which are the thing worth eyeballing: the program
    // promised ten of each.
    for (const kind of SESSION_KINDS) {
      const r = resolved[kind];
      if (!r) continue;
      const occ = occurrencesFor(r.weekday, r.minuteOfDay);
      occurrenceTotal += occ.length;
      if (occ.length !== 10) {
        problems += 1;
        console.log(`      ${kind}: ${occ.length} occurrences — expected 10`);
      }
    }

    if (!apply) continue;

    const stamp = now();
    db.transaction((tx) => {
      const existing = tx
        .select()
        .from(section)
        .where(eq(section.label, label))
        .all()
        .find((s) => s.term === TERM_KEY);

      const sectionId = existing?.id ?? nanoid();
      const values = {
        term: TERM_KEY,
        courseKey,
        number,
        label,
        problemWeekday: resolved.problem_session?.weekday ?? null,
        problemMinute: resolved.problem_session?.minuteOfDay ?? null,
        officeWeekday: resolved.office_hours?.weekday ?? null,
        officeMinute: resolved.office_hours?.minuteOfDay ?? null,
        updatedAt: stamp,
      };

      if (existing) {
        tx.update(section).set(values).where(eq(section.id, sectionId)).run();
      } else {
        tx.insert(section).values({ id: sectionId, ...values, createdAt: stamp }).run();
      }

      for (const kind of SESSION_KINDS) {
        const r = resolved[kind];
        if (!r) continue;
        for (const o of occurrencesFor(r.weekday, r.minuteOfDay)) {
          tx.insert(sessionOccurrence)
            .values({
              id: nanoid(),
              sectionId,
              kind,
              date: o.date,
              startsAt: o.startsAt,
              createdAt: stamp,
            })
            // Re-running must not duplicate, and must not clobber a session
            // someone has since cancelled or attached a Zoom occurrence to.
            .onConflictDoUpdate({
              target: [sessionOccurrence.sectionId, sessionOccurrence.kind, sessionOccurrence.date],
              set: { startsAt: o.startsAt },
            })
            .run();
        }
      }
    });
  }

  console.log('');
  console.log(`  occurrences: ${occurrenceTotal}`);
  if (problems > 0) {
    console.log('');
    console.log(`  !! ${problems} problem(s) above need a human before this is trustworthy.`);
    process.exitCode = 1;
  } else if (!apply) {
    console.log('  Everything resolved cleanly. Re-run with --apply to write.');
  }
}

main();
