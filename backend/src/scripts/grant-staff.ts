/*
 * grant-staff: create staff accounts and assign them to sections.
 *
 * Reads a roster on stdin, one person per line, tab- or pipe-separated:
 *
 *   Name <email>            | role     | SECTION[,SECTION...]
 *   Blaze Okonogi <b@x.com> | mentor   | GGT-2,TOPOLOGY-2
 *   Emma Li <e@x.com>       | assistant|
 *
 * Sections may be empty — an assistant who is not yet assigned is still a
 * staff account. Section labels must already exist; run backfill-sections
 * first.
 *
 * The roster is NOT kept in the repo. Fourteen staff email addresses are
 * personal data, the repository currently holds none, and CLAUDE.md is
 * explicit that PII lives in the database. So the list is passed in and the
 * database is where it comes to rest.
 *
 * Idempotent: re-running adds nothing and changes nothing except assignments
 * that actually differ. Dry run by default.
 *
 * Usage:
 *   pnpm --filter @rp2/backend grant-staff < roster.txt
 *   pnpm --filter @rp2/backend grant-staff -- --apply < roster.txt
 */

import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { TERM_KEY } from '@rp2/shared';
import { db } from '../db/client.js';
import { section, sectionStaff, user, userRole } from '../db/schema.js';

function usage(): never {
  console.error('usage: grant-staff [--apply] < roster.txt');
  console.error('  line format:  Name <email> | mentor|assistant | SECTION,SECTION');
  process.exit(2);
}

const now = (): number => Math.floor(Date.now() / 1000);

type Entry = {
  name: string;
  email: string;
  role: 'mentor' | 'assistant';
  sections: string[];
};

const LINE = /^(.*?)<([^>]+)>\s*[|\t]\s*(mentor|assistant)\s*[|\t]?\s*(.*)$/i;

function parseRoster(text: string): { entries: Entry[]; errors: string[] } {
  const entries: Entry[] = [];
  const errors: string[] = [];

  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const m = LINE.exec(line);
    if (!m) {
      errors.push(`line ${i + 1}: cannot parse "${line}"`);
      continue;
    }
    const email = m[2]!.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push(`line ${i + 1}: "${email}" is not an email address`);
      continue;
    }
    entries.push({
      name: m[1]!.trim(),
      email,
      role: m[3]!.toLowerCase() as 'mentor' | 'assistant',
      sections: (m[4] ?? '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    });
  }
  return { entries, errors };
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fileArg = args.find((a) => !a.startsWith('-'));
  if (args.some((a) => a.startsWith('-') && a !== '--apply')) usage();

  const text = readFileSync(fileArg ?? 0, 'utf8');
  const { entries, errors } = parseRoster(text);

  if (errors.length > 0) {
    for (const e of errors) console.error(`  ! ${e}`);
    console.error('Fix the roster and re-run. Nothing was written.');
    process.exit(2);
  }
  if (entries.length === 0) usage();

  // Sections must exist before anyone can be assigned to one.
  const sections = new Map(
    db
      .select()
      .from(section)
      .all()
      .filter((s) => s.term === TERM_KEY)
      .map((s) => [s.label, s]),
  );

  console.log(apply ? 'Applying:' : 'Dry run (pass --apply to write):');
  console.log(`  roster: ${entries.length} (${entries.filter((e) => e.role === 'mentor').length} mentors, ${entries.filter((e) => e.role === 'assistant').length} assistants)`);
  console.log(`  sections known: ${sections.size}`);
  console.log('');

  let problems = 0;
  const assigned = new Set<string>();

  for (const e of entries) {
    const existing = db.select().from(user).where(eq(user.email, e.email)).get();
    const held = existing
      ? db
          .select({ role: userRole.role })
          .from(userRole)
          .where(eq(userRole.userId, existing.id))
          .all()
          .map((r) => r.role)
      : [];

    const notes: string[] = [];
    if (existing) {
      notes.push(held.length > 0 ? `existing account (${held.join(', ')})` : 'existing account');
    } else {
      notes.push('new account');
    }
    if (!held.includes(e.role)) notes.push(`+${e.role}`);

    for (const label of e.sections) {
      if (!sections.has(label)) {
        problems += 1;
        notes.push(`UNKNOWN SECTION ${label}`);
      } else {
        assigned.add(label);
      }
    }

    const where = e.sections.length > 0 ? e.sections.join(', ') : '(no section)';
    console.log(`  ${e.name} <${e.email}>  ${e.role}  ${where}`);
    console.log(`      ${notes.join('; ')}`);

    if (!apply) continue;

    db.transaction((tx) => {
      const userId = existing?.id ?? nanoid();
      if (!existing) {
        tx.insert(user).values({ id: userId, email: e.email, createdAt: now() }).run();
      }
      // Roles are additive: Blaze keeps `admin` and gains `mentor`.
      tx.insert(userRole)
        .values({ userId, role: e.role, grantedAt: now() })
        .onConflictDoNothing()
        .run();

      for (const label of e.sections) {
        const s = sections.get(label);
        if (!s) continue;
        tx.insert(sectionStaff)
          .values({ sectionId: s.id, userId, role: e.role, assignedAt: now() })
          .onConflictDoUpdate({
            target: [sectionStaff.sectionId, sectionStaff.userId],
            set: { role: e.role },
          })
          .run();
      }
    });
  }

  // A section with no mentor is a section whose Zoom meeting nobody owns.
  const unstaffed = [...sections.keys()].filter((l) => !assigned.has(l)).sort();
  if (unstaffed.length > 0) {
    console.log('');
    console.log(`  !! ${unstaffed.length} section(s) with nobody on this roster:`);
    for (const l of unstaffed) console.log(`     ${l}`);
    problems += unstaffed.length;
  }

  console.log('');
  if (problems > 0) {
    console.log(`  !! ${problems} problem(s) need a human.`);
    process.exitCode = 1;
  } else if (!apply) {
    console.log('  Clean. Re-run with --apply to write.');
  }
}

main();
