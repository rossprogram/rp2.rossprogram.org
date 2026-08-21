/*
 * export-applications: writes an .xlsx of applications, one row per app.
 *
 * Usage:
 *   pnpm --filter @rp2/backend export-applications -- <out.xlsx>
 *   pnpm --filter @rp2/backend export-applications -- --all <out.xlsx>
 *
 * Defaults to `submitted`, `under_review`, `accepted`, `waitlisted`.
 * `--all` includes drafts too.
 *
 * Columns:
 *   app_id, status, submitted_at (UTC), guardian_submitted_at (UTC),
 *   applicant_email, guardian_email,
 *   one column per question_key in QUESTIONS declaration order,
 *   plus availability (compact string) and files (kind:filename;...).
 */

import { eq, inArray } from 'drizzle-orm';
import { writeFile, utils } from 'xlsx';
import { QUESTIONS, type Question } from '@rp2/shared';
import { db } from '../db/client.js';
import {
  application,
  applicationAvailability,
  applicationCoursePreference,
  applicationFile,
  applicationResponse,
  guardianLink,
  user,
} from '../db/schema.js';

const DEFAULT_STATUSES = [
  'submitted',
  'under_review',
  'accepted',
  'waitlisted',
] as const;

function usage(): never {
  console.error('usage: export-applications [--all] <out.xlsx>');
  process.exit(2);
}

function isoUtc(unix: number | null | undefined): string {
  if (!unix) return '';
  return new Date(unix * 1000).toISOString();
}

function stringifyValue(q: Question, raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) {
    if (q.type === 'ranked') return raw.filter((v) => typeof v === 'string').join(', ');
    if (q.type === 'multi_select') return raw.filter((v) => typeof v === 'string').join(', ');
    return JSON.stringify(raw);
  }
  return JSON.stringify(raw);
}

function labelFor(q: Question, value: string): string {
  if ('options' in q && Array.isArray(q.options)) {
    const opt = q.options.find((o) => o.value === value);
    if (opt) return `${value} (${opt.label})`;
  }
  return value;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatAvailability(
  rows: { weekday: number; startMin: number; endMin: number }[],
): string {
  if (rows.length === 0) return '';
  const sorted = [...rows].sort(
    (a, b) => a.weekday - b.weekday || a.startMin - b.startMin,
  );
  return sorted
    .map((r) => `${WEEKDAYS[r.weekday]} ${fmtMin(r.startMin)}-${fmtMin(r.endMin)}`)
    .join('; ');
}

function fmtMin(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatCoursePrefs(rows: { courseKey: string; rank: number }[]): string {
  return [...rows]
    .sort((a, b) => a.rank - b.rank)
    .map((r) => r.courseKey)
    .join(', ');
}

function formatFiles(
  rows: { kind: string; filename: string; size: number }[],
): string {
  return rows.map((r) => `${r.kind}:${r.filename} (${r.size}B)`).join('; ');
}

function main(): void {
  const args = process.argv.slice(2);
  let includeAll = false;
  let out: string | undefined;
  for (const arg of args) {
    if (arg === '--all') includeAll = true;
    else if (arg.startsWith('-')) usage();
    else out = arg;
  }
  if (!out) usage();

  const statuses = includeAll
    ? ([
        'draft',
        'awaiting_guardian',
        'submitted',
        'under_review',
        'accepted',
        'waitlisted',
        'rejected',
        'withdrawn',
      ] as const)
    : DEFAULT_STATUSES;

  const apps = db
    .select({
      id: application.id,
      applicantUserId: application.applicantUserId,
      status: application.status,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
      submittedAt: application.submittedAt,
      guardianSubmittedAt: application.guardianSubmittedAt,
      applicantEmail: user.email,
    })
    .from(application)
    .innerJoin(user, eq(user.id, application.applicantUserId))
    .where(inArray(application.status, [...statuses]))
    .all();

  if (apps.length === 0) {
    console.error(`no applications matching status: ${statuses.join(', ')}`);
    process.exit(1);
  }

  const rows: Record<string, string>[] = [];

  for (const app of apps) {
    const responseRows = db
      .select({
        questionKey: applicationResponse.questionKey,
        value: applicationResponse.value,
      })
      .from(applicationResponse)
      .where(eq(applicationResponse.applicationId, app.id))
      .all();

    const responseMap: Record<string, unknown> = {};
    for (const r of responseRows) {
      try {
        responseMap[r.questionKey] = JSON.parse(r.value);
      } catch {
        responseMap[r.questionKey] = r.value;
      }
    }

    const availRows = db
      .select({
        weekday: applicationAvailability.weekday,
        startMin: applicationAvailability.startMin,
        endMin: applicationAvailability.endMin,
      })
      .from(applicationAvailability)
      .where(eq(applicationAvailability.applicationId, app.id))
      .all();

    const courseRows = db
      .select({
        courseKey: applicationCoursePreference.courseKey,
        rank: applicationCoursePreference.rank,
      })
      .from(applicationCoursePreference)
      .where(eq(applicationCoursePreference.applicationId, app.id))
      .all();

    const fileRows = db
      .select({
        kind: applicationFile.kind,
        filename: applicationFile.filename,
        size: applicationFile.size,
        storageKey: applicationFile.storageKey,
      })
      .from(applicationFile)
      .where(eq(applicationFile.applicationId, app.id))
      .all();

    const link = db
      .select({ guardianEmail: user.email, acceptedAt: guardianLink.acceptedAt })
      .from(guardianLink)
      .innerJoin(user, eq(user.id, guardianLink.guardianUserId))
      .where(eq(guardianLink.applicantUserId, app.applicantUserId))
      .get();

    const row: Record<string, string> = {
      app_id: app.id,
      status: app.status,
      submitted_at_utc: isoUtc(app.submittedAt),
      guardian_submitted_at_utc: isoUtc(app.guardianSubmittedAt),
      updated_at_utc: isoUtc(app.updatedAt),
      applicant_email: app.applicantEmail,
      guardian_link_email: link?.guardianEmail ?? '',
      guardian_link_accepted: link?.acceptedAt ? 'yes' : 'no',
    };

    for (const q of QUESTIONS) {
      const raw = responseMap[q.key];
      const s = stringifyValue(q, raw);
      // For single_select, show both the stored value and the human label.
      row[q.key] = q.type === 'single_select' && s ? labelFor(q, s) : s;
    }

    // Denormalized helpers (also in per-question columns above, but this is
    // the compact human-readable form).
    row['availability_pretty'] = formatAvailability(availRows);
    row['course_preferences_pretty'] = formatCoursePrefs(courseRows);
    row['files'] = formatFiles(fileRows);
    row['file_storage_keys'] = fileRows.map((f) => `${f.kind}:${f.storageKey}`).join(' | ');

    rows.push(row);
  }

  const header = [
    'app_id',
    'status',
    'submitted_at_utc',
    'guardian_submitted_at_utc',
    'updated_at_utc',
    'applicant_email',
    'guardian_link_email',
    'guardian_link_accepted',
    ...QUESTIONS.map((q) => q.key),
    'availability_pretty',
    'course_preferences_pretty',
    'files',
    'file_storage_keys',
  ];

  const worksheet = utils.json_to_sheet(rows, { header });
  worksheet['!cols'] = header.map((h) => ({
    wch: Math.min(60, Math.max(12, h.length + 2)),
  }));
  const wb = utils.book_new();
  utils.book_append_sheet(wb, worksheet, 'Applications');

  writeFile(wb, out);
  console.log(`wrote ${rows.length} application(s) to ${out}`);
}

main();
