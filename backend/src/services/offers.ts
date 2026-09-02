import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { read, write, utils } from 'xlsx';
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  OFFER_IMPORT_COLUMNS,
  TUITION_CENTS,
  courseLabel,
  csvGuard,
  questionByKey,
  formatCents,
  isPastDeadline,
  type ApplicationStatus,
  type ImportPreview,
  type NotifyResult,
  type OfferEnvelope,
  type OfferView,
  type PublishResult,
} from '@rp2/shared';
import { db } from '../db/client.js';
import {
  application,
  applicationResponse,
  guardianLink,
  offer,
  offerImport,
  payment,
  user,
} from '../db/schema.js';
import { validateImport, type CurrentRow, type ResolvedRow } from './offer-import.js';

/*
 * Offers: the admin spreadsheet round trip, and the family's response to it.
 *
 * The authority for "where is this family in the process" is offer.response
 * plus the sum of paid payments. application.status is a denormalization of
 * those two, recomputed by deriveStatus() inside every write transaction, so
 * the two can never disagree.
 */

export class OfferError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 409,
  ) {
    super(message);
    this.name = 'OfferError';
  }
}

const now = (): number => Math.floor(Date.now() / 1000);

/** Name of the sheet holding the data grid, as opposed to the instructions. */
const DATA_SHEET = 'offers';

/* ==================== status derivation ==================== */

type DerivableOffer = { response: 'accepted' | 'declined' | null; amountDueCents: number };

/**
 * The single place these three statuses are computed. Called inside the same
 * transaction as every offer or payment write.
 *
 * paidCents is the SUM of paid payments, not one payment's amount — that is
 * what makes installments and mid-flight price changes correct for free.
 */
export function deriveStatus(o: DerivableOffer, paidCents: number): ApplicationStatus {
  if (o.response === 'declined') return 'declined';
  if (o.response !== 'accepted') return 'accepted';
  return paidCents >= o.amountDueCents ? 'enrolled' : 'awaiting_payment';
}

export function paidCentsFor(applicationId: string): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${payment.amountCents}), 0)` })
    .from(payment)
    .where(and(eq(payment.applicationId, applicationId), eq(payment.status, 'paid')))
    .get();
  return row?.total ?? 0;
}

/* ==================== reading the sheet ==================== */

export type ParsedSheet = {
  rows: Record<string, unknown>[];
  headers: string[];
  fileHash: string;
};

/**
 * Parse an uploaded CSV or XLSX. xlsx sniffs the format, so one path serves
 * both.
 *
 * Rows are rebuilt onto a null-prototype object containing only headers we
 * recognise — a parsed sheet is never spread, because xlsx has a known
 * prototype-pollution CVE and a crafted sheet should not be able to reach
 * Object.prototype even from an admin-only route.
 */
export function readSheet(buf: Buffer): ParsedSheet {
  if (buf.length > IMPORT_MAX_BYTES) {
    throw new OfferError('file_too_large', `The file is larger than ${IMPORT_MAX_BYTES} bytes.`, 413);
  }

  const wb = read(buf, { type: 'buffer', cellDates: true, raw: true });
  // Prefer the data sheet by NAME so the xlsx template can lead with an
  // Instructions sheet — the admin should meet the guidance before the grid.
  // A CSV (or a hand-made workbook) has one sheet and falls back to it.
  const name =
    wb.SheetNames.find((n) => n.toLowerCase() === DATA_SHEET) ?? wb.SheetNames[0];
  if (!name) throw new OfferError('no_sheet', 'The file has no worksheet.', 400);
  const ws = wb.Sheets[name];
  if (!ws) throw new OfferError('no_sheet', 'The file has no worksheet.', 400);

  const raw = utils.sheet_to_json<Record<string, unknown>>(ws, {
    raw: true,
    defval: '',
    blankrows: false,
  });
  if (raw.length > IMPORT_MAX_ROWS) {
    throw new OfferError('too_many_rows', `The sheet has more than ${IMPORT_MAX_ROWS} rows.`, 413);
  }

  const headerRows = utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false });
  const headers = (headerRows[0] ?? []).map((h) => String(h ?? '').trim());

  const known = new Set(OFFER_IMPORT_COLUMNS.map((c) => c.key));
  const rows = raw.map((r) => {
    const clean = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(r)) {
      const k = key.trim();
      if (known.has(k)) clean[k] = r[key];
    }
    return clean;
  });

  return { rows, headers, fileHash: createHash('sha256').update(buf).digest('hex') };
}

/* ==================== the current-state snapshot ==================== */

/** Load every application the validator might need, keyed by id. */
export function loadCurrentRows(): Map<string, CurrentRow> {
  const apps = db
    .select({
      id: application.id,
      status: application.status,
      internalNotes: application.decisionNotes,
      email: user.email,
    })
    .from(application)
    .innerJoin(user, eq(user.id, application.applicantUserId))
    .all();

  const offers = new Map(
    db.select().from(offer).all().map((o) => [o.applicationId, o]),
  );

  const paidIds = new Set(
    db
      .select({ id: payment.applicationId })
      .from(payment)
      .where(eq(payment.status, 'paid'))
      .all()
      .map((r) => r.id),
  );

  const context = loadContext();

  const out = new Map<string, CurrentRow>();
  for (const a of apps) {
    const o = offers.get(a.id);
    out.set(a.id, {
      appId: a.id,
      studentEmail: a.email,
      studentName: context.get(a.id)?.legal_name ?? null,
      context: context.get(a.id) ?? {},
      status: a.status,
      internalNotes: a.internalNotes,
      offer: o
        ? {
            courseKey: o.courseKey,
            section: o.section,
            cohort: o.cohort,
            problemSession: o.problemSession,
            officeHours: o.officeHours,
            aidAmountCents: o.aidAmountCents,
            amountDueCents: o.amountDueCents,
            enrollmentDeadline: o.enrollmentDeadline,
            notes: o.notes,
            response: o.response,
            respondedAt: o.respondedAt,
          }
        : null,
      hasPaidPayments: paidIds.has(a.id),
    });
  }
  return out;
}

/*
 * Read-only columns the template carries so placement can be done in one
 * sheet: timezone, grade, and proof experience are what actually decide which
 * section a student belongs in.
 */
const CONTEXT_KEYS = [
  'student_legal_name',
  'student_preferred_name',
  'student_grade_level',
  'student_school',
  'student_location',
  'student_timezone',
  'proof_experience',
  'aid_level',
  'guardian_name',
  'guardian_email',
] as const;

/** Map of application id -> { column key: display value }. */
function loadContext(): Map<string, Record<string, string>> {
  const rows = db
    .select({
      applicationId: applicationResponse.applicationId,
      questionKey: applicationResponse.questionKey,
      value: applicationResponse.value,
    })
    .from(applicationResponse)
    .where(inArray(applicationResponse.questionKey, [...CONTEXT_KEYS]))
    .all();

  const out = new Map<string, Record<string, string>>();
  for (const r of rows) {
    const entry = out.get(r.applicationId) ?? {};
    // Render option values as their human label — 'some' is meaningless in a
    // spreadsheet, 'Some experience' is not.
    entry[COLUMN_FOR_QUESTION[r.questionKey] ?? r.questionKey] = displayValue(
      r.questionKey,
      r.value,
    );
    out.set(r.applicationId, entry);
  }
  return out;
}

const COLUMN_FOR_QUESTION: Record<string, string> = {
  student_legal_name: 'legal_name',
  student_preferred_name: 'preferred_name',
  student_grade_level: 'grade',
  student_school: 'school',
  student_location: 'location',
  student_timezone: 'timezone',
  proof_experience: 'proof_experience',
  aid_level: 'aid_request',
  guardian_name: 'guardian_name',
  guardian_email: 'guardian_email',
};

function displayValue(questionKey: string, raw: string): string {
  const v = safeJson(raw);
  if (v === null) return '';
  const q = questionByKey(questionKey);
  const opt =
    q && 'options' in q
      ? q.options?.find((o: { value: string }) => o.value === v)
      : undefined;
  return opt?.label ?? v;
}

function safeJson(v: string): string | null {
  try {
    const parsed: unknown = JSON.parse(v);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/* ==================== template ==================== */

const TEMPLATE_STATUSES: ApplicationStatus[] = [
  'submitted',
  'under_review',
  'accepted',
  'awaiting_payment',
  'enrolled',
  'declined',
  'waitlisted',
];

/**
 * Build the template, prefilled with current values. Prefilling is what makes
 * "empty cell means clear this field" safe, and what makes an untouched
 * download re-import as zero changes.
 */
export function buildTemplate(format: 'csv' | 'xlsx'): Buffer {
  const current = loadCurrentRows();
  const rows = [...current.values()]
    .filter((r) => TEMPLATE_STATUSES.includes(r.status))
    .sort((a, b) => (a.studentName ?? '').localeCompare(b.studentName ?? ''));

  // Every free-text cell is neutralized against spreadsheet formula
  // evaluation; see csvGuard. app_id needs it too — nanoid ids can start
  // with '-'.
  const json = rows.map((r) => ({
    app_id: csvGuard(r.appId),
    student_email: csvGuard(r.studentEmail),
    preferred_name: csvGuard(r.context.preferred_name ?? ''),
    legal_name: csvGuard(r.context.legal_name ?? ''),
    grade: csvGuard(r.context.grade ?? ''),
    proof_experience: csvGuard(r.context.proof_experience ?? ''),
    school: csvGuard(r.context.school ?? ''),
    location: csvGuard(r.context.location ?? ''),
    timezone: csvGuard(r.context.timezone ?? ''),
    aid_request: csvGuard(r.context.aid_request ?? ''),
    guardian_name: csvGuard(r.context.guardian_name ?? ''),
    guardian_email: csvGuard(r.context.guardian_email ?? ''),
    status: r.status,
    course: r.offer?.courseKey ?? '',
    section: csvGuard(r.offer?.section ?? ''),
    group: csvGuard(r.offer?.cohort ?? ''),
    problem_session: csvGuard(r.offer?.problemSession ?? ''),
    office_hours: csvGuard(r.offer?.officeHours ?? ''),
    // Dollars as plain decimal text: survives a CSV round trip and re-parses
    // to the same cents.
    aid_amount: r.offer ? dollars(r.offer.aidAmountCents) : '',
    amount_due: r.offer ? dollars(r.offer.amountDueCents) : '',
    enrollment_deadline: r.offer?.enrollmentDeadline ?? '',
    notes: csvGuard(r.offer?.notes ?? ''),
    internal_notes: csvGuard(r.internalNotes ?? ''),
  }));

  const wb = utils.book_new();

  if (format === 'xlsx') {
    // Instructions lead, so the admin meets the rules before the grid.
    // readSheet finds the data by sheet NAME, not position.
    utils.book_append_sheet(wb, instructionSheet(), 'Instructions');
  }

  const ws = utils.json_to_sheet(
    // A CSV has no second sheet to put guidance on, so it carries a single
    // '#' row instead. The importer skips it wherever a sort leaves it.
    format === 'csv' ? [helpRow(), ...json] : json,
    { header: OFFER_IMPORT_COLUMNS.map((c) => c.key) },
  );
  ws['!cols'] = OFFER_IMPORT_COLUMNS.map((c) => ({
    wch: c.type === 'text' ? 40 : Math.max(12, c.key.length + 2),
  }));
  // Freeze the header row so it stays visible while scrolling.
  ws['!freeze'] = { xSplit: '0', ySplit: '1' };
  utils.book_append_sheet(wb, ws, DATA_SHEET);

  const out: unknown = write(wb, { type: 'buffer', bookType: format });
  return Buffer.from(out as Uint8Array);
}

/** The '#' guidance row embedded in the CSV template. */
function helpRow(): Record<string, string> {
  const row: Record<string, string> = {};
  for (const c of OFFER_IMPORT_COLUMNS) {
    row[c.key] = c.key === 'app_id' ? '# DO NOT DELETE THIS ROW' : csvGuard(c.help);
  }
  return row;
}

/**
 * The Instructions sheet. Generated from OFFER_IMPORT_COLUMNS so the guidance
 * can never drift from the columns it describes.
 */
function instructionSheet() {
  const rows: string[][] = [
    ['ℝℙ² — offers import'],
    [],
    ['How this works'],
    ['1.', 'This file is already filled in with what we currently have on record.'],
    ['2.', `Edit cells on the "${DATA_SHEET}" sheet. Change only what you mean to change.`],
    ['3.', 'Upload it back in the admin portal. You will see every change listed'],
    ['', 'for review before anything is saved.'],
    [],
    ['Rules worth knowing'],
    ['•', 'A column you DELETE is left alone on every row.'],
    ['•', 'A cell you EMPTY clears that field. Those are different things.'],
    ['•', 'Do not edit app_id, student_email, or student_name. They identify the row;'],
    ['', 'a mismatch between app_id and student_email will block the import.'],
    ['•', 'Uploading this file unchanged makes no changes at all. That is safe to do.'],
    ['•', 'Nobody is emailed when you publish. Sending is a separate button afterwards.'],
    [],
    ['Columns'],
    ['Column', 'Edit?', 'What it means'],
  ];

  for (const c of OFFER_IMPORT_COLUMNS) {
    rows.push([
      c.key,
      c.kind === 'editable' ? 'yes' : 'NO',
      c.help,
    ]);
  }

  rows.push(
    [],
    ['A word about the two notes columns'],
    ['', '"notes" is shown to the student and the parent, word for word.'],
    ['', '"internal_notes" is never shown to anyone outside the admin portal.'],
    ['', 'Put candid assessments in internal_notes.'],
  );

  const ws = utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 78 }];
  return ws;
}

/** Integer cents to a bare decimal string, e.g. 75000 -> "750.00". */
function dollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/* ==================== preview and publish ==================== */

export function previewImport(buf: Buffer, filename: string): ImportPreview {
  const { rows, headers, fileHash } = readSheet(buf);
  const { preview } = validateImport(rows, headers, loadCurrentRows(), { filename, fileHash });
  return preview;
}

/**
 * Apply an import.
 *
 * Re-parses and re-validates from scratch rather than trusting the preview:
 * the database may have moved (a family can accept an offer mid-review), and
 * the preview's verdict is advisory only.
 */
export function publishImport(input: {
  buf: Buffer;
  filename: string;
  importId: string;
  expectedHash: string;
  adminUserId: string;
}): PublishResult {
  const existing = db.select().from(offerImport).where(eq(offerImport.id, input.importId)).get();
  if (existing) {
    return {
      importId: existing.id,
      applied: existing.changedCount,
      changedAppIds: JSON.parse(existing.changedAppIds) as string[],
      alreadyPublished: true,
    };
  }

  const { rows, headers, fileHash } = readSheet(input.buf);
  if (input.expectedHash && fileHash !== input.expectedHash) {
    throw new OfferError(
      'file_changed',
      'This is not the file that was previewed. Preview it again before publishing.',
    );
  }

  const { preview, resolved } = validateImport(rows, headers, loadCurrentRows(), {
    filename: input.filename,
    fileHash,
  });

  if (preview.fatal.length > 0) {
    throw new OfferError('fatal_errors', preview.fatal[0]!.message, 400);
  }
  if (preview.errorCount > 0) {
    throw new OfferError(
      'row_errors',
      `${preview.errorCount} row(s) still have errors. Fix them and preview again.`,
    );
  }

  const stamp = now();
  const changedAppIds = resolved.map((r) => r.appId);

  db.transaction((tx) => {
    for (const r of resolved) applyRow(tx, r, input.importId, stamp);

    tx.insert(offerImport)
      .values({
        id: input.importId,
        importedByUserId: input.adminUserId,
        filename: input.filename,
        fileHash,
        rowCount: preview.rowCount,
        changedCount: resolved.length,
        changedAppIds: JSON.stringify(changedAppIds),
        diffJson: JSON.stringify(preview.changedRows),
        createdAt: stamp,
      })
      .run();
  });

  return {
    importId: input.importId,
    applied: resolved.length,
    changedAppIds,
    alreadyPublished: false,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function applyRow(tx: Tx, r: ResolvedRow, importId: string, stamp: number): void {
  const f = r.fields;

  if ('internalNotes' in f) {
    tx.update(application)
      .set({ decisionNotes: (f.internalNotes as string | null) ?? null })
      .where(eq(application.id, r.appId))
      .run();
  }

  const offerFields = {
    ...('courseKey' in f ? { courseKey: f.courseKey as string | null } : {}),
    ...('section' in f ? { section: f.section as string | null } : {}),
    ...('cohort' in f ? { cohort: f.cohort as string | null } : {}),
    ...('problemSession' in f
      ? { problemSession: f.problemSession as string | null }
      : {}),
    ...('officeHours' in f ? { officeHours: f.officeHours as string | null } : {}),
    ...('aidAmountCents' in f ? { aidAmountCents: f.aidAmountCents as number } : {}),
    ...('amountDueCents' in f ? { amountDueCents: f.amountDueCents as number } : {}),
    ...('enrollmentDeadline' in f
      ? { enrollmentDeadline: f.enrollmentDeadline as string | null }
      : {}),
    ...('notes' in f ? { notes: f.notes as string | null } : {}),
  };

  const status = f.status as ApplicationStatus | undefined;
  const needsOffer = Object.keys(offerFields).length > 0 || status === 'accepted';

  if (needsOffer) {
    const existing = tx.select().from(offer).where(eq(offer.applicationId, r.appId)).get();
    if (existing) {
      tx.update(offer)
        .set({ ...offerFields, lastImportId: importId, updatedAt: stamp })
        .where(eq(offer.applicationId, r.appId))
        .run();
    } else {
      tx.insert(offer)
        .values({
          id: nanoid(),
          applicationId: r.appId,
          ...offerFields,
          lastImportId: importId,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .run();
    }
  }

  if (status) {
    tx.update(application)
      .set({ status, decisionAt: stamp, updatedAt: stamp })
      .where(eq(application.id, r.appId))
      .run();
  }
}

/* ==================== notification targets ==================== */

export type NotifyTarget = {
  applicationId: string;
  studentName: string | null;
  emails: string[];
};

/** Student and guardian addresses for each application in an import batch. */
export function notifyTargetsFor(importId: string): NotifyTarget[] {
  const imp = db.select().from(offerImport).where(eq(offerImport.id, importId)).get();
  if (!imp) throw new OfferError('unknown_import', 'No such import.', 404);

  const appIds = JSON.parse(imp.changedAppIds) as string[];
  if (appIds.length === 0) return [];

  const rows = db
    .select({
      id: application.id,
      studentEmail: user.email,
      applicantUserId: application.applicantUserId,
    })
    .from(application)
    .innerJoin(user, eq(user.id, application.applicantUserId))
    .where(inArray(application.id, appIds))
    .all();

  const guardians = new Map(
    db
      .select({ applicantUserId: guardianLink.applicantUserId, email: user.email })
      .from(guardianLink)
      .innerJoin(user, eq(user.id, guardianLink.guardianUserId))
      .all()
      .map((r) => [r.applicantUserId, r.email]),
  );

  const names = new Map(
    db
      .select({
        applicationId: applicationResponse.applicationId,
        value: applicationResponse.value,
      })
      .from(applicationResponse)
      .where(eq(applicationResponse.questionKey, 'student_legal_name'))
      .all()
      .map((r) => [r.applicationId, safeJson(r.value)]),
  );

  return rows.map((r) => {
    const guardian = guardians.get(r.applicantUserId);
    const emails = [r.studentEmail];
    if (guardian && guardian.toLowerCase() !== r.studentEmail.toLowerCase()) {
      emails.push(guardian);
    }
    return { applicationId: r.id, studentName: names.get(r.id) ?? null, emails };
  });
}

export function markNotified(importId: string, result: NotifyResult): void {
  const stamp = now();
  db.transaction((tx) => {
    tx.update(offerImport)
      .set({ notifiedAt: stamp, notifiedCount: result.sent })
      .where(eq(offerImport.id, importId))
      .run();
    const imp = tx.select().from(offerImport).where(eq(offerImport.id, importId)).get();
    if (!imp) return;
    const appIds = JSON.parse(imp.changedAppIds) as string[];
    if (appIds.length > 0) {
      tx.update(offer)
        .set({ notifiedAt: stamp })
        .where(inArray(offer.applicationId, appIds))
        .run();
    }
  });
}

export function listImports(limit = 20) {
  return db
    .select()
    .from(offerImport)
    .orderBy(sql`${offerImport.createdAt} DESC`)
    .limit(limit)
    .all()
    .map((r) => ({
      id: r.id,
      filename: r.filename,
      rowCount: r.rowCount,
      changedCount: r.changedCount,
      createdAt: r.createdAt,
      notifiedAt: r.notifiedAt,
      notifiedCount: r.notifiedCount,
    }));
}

/* ==================== the family side ==================== */

export type OfferActor = {
  userId: string;
  kind: 'student' | 'guardian';
  email: string;
  applicantUserId: string;
};

/**
 * Is this user allowed to act on this application's offer?
 *
 * Returns null for both "no such application" and "not your application" — the
 * caller answers 404 either way, so the endpoint never confirms that an id
 * exists.
 */
export function authorizeOfferActor(userId: string, applicationId: string): OfferActor | null {
  const app = db
    .select({ applicantUserId: application.applicantUserId })
    .from(application)
    .where(eq(application.id, applicationId))
    .get();
  if (!app) return null;

  const me = db.select({ email: user.email }).from(user).where(eq(user.id, userId)).get();
  if (!me) return null;

  if (app.applicantUserId === userId) {
    return { userId, kind: 'student', email: me.email, applicantUserId: app.applicantUserId };
  }

  const link = db
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .where(
      and(
        eq(guardianLink.guardianUserId, userId),
        eq(guardianLink.applicantUserId, app.applicantUserId),
      ),
    )
    .get();

  return link
    ? { userId, kind: 'guardian', email: me.email, applicantUserId: app.applicantUserId }
    : null;
}

export function loadOfferEnvelope(
  applicationId: string,
  actor: OfferActor,
  paymentsEnabled: boolean,
): OfferEnvelope {
  const app = db
    .select({ id: application.id, status: application.status })
    .from(application)
    .where(eq(application.id, applicationId))
    .get();
  if (!app) throw new OfferError('not_found', 'No such application.', 404);

  const o = db.select().from(offer).where(eq(offer.applicationId, applicationId)).get();

  const nameRow = db
    .select({ value: applicationResponse.value })
    .from(applicationResponse)
    .where(
      and(
        eq(applicationResponse.applicationId, applicationId),
        eq(applicationResponse.questionKey, 'student_legal_name'),
      ),
    )
    .get();

  // An offer is only shown once the family has actually been told about it.
  const visible = o !== undefined && o.notifiedAt !== null;

  let view: OfferView | null = null;
  if (visible) {
    view = {
      courseKey: o.courseKey,
      courseLabel: courseLabel(o.courseKey),
      section: o.section,
      cohort: o.cohort,
      problemSession: o.problemSession,
      officeHours: o.officeHours,
      tuitionCents: TUITION_CENTS,
      aidAmountCents: o.aidAmountCents,
      amountDueCents: o.amountDueCents,
      enrollmentDeadline: o.enrollmentDeadline,
      notes: o.notes,
      response: o.response,
      respondedAt: o.respondedAt,
      respondedByKind: o.respondedByUserId
        ? kindOf(o.respondedByUserId, applicationId)
        : null,
      paidCents: paidCentsFor(applicationId),
      pastDeadline: isPastDeadline(o.enrollmentDeadline),
      paymentsEnabled,
    };
  }

  return {
    applicationId,
    status: app.status,
    actorKind: actor.kind,
    studentName: nameRow ? safeJson(nameRow.value) : null,
    offer: view,
  };
}

function kindOf(userId: string, applicationId: string): 'student' | 'guardian' {
  const app = db
    .select({ applicantUserId: application.applicantUserId })
    .from(application)
    .where(eq(application.id, applicationId))
    .get();
  return app && app.applicantUserId === userId ? 'student' : 'guardian';
}

/**
 * Record a family's response.
 *
 * The guarded UPDATE (`WHERE response IS NULL`) plus the `changes` check is the
 * whole concurrency story: this function contains no `await`, better-sqlite3 is
 * synchronous, and Node is single-threaded, so it is atomic against other
 * requests. A student and a guardian clicking at the same moment produce
 * exactly one write; the loser gets an idempotent result.
 */
export function respondToOffer(
  applicationId: string,
  actor: OfferActor,
  response: 'accepted' | 'declined',
): { status: ApplicationStatus; idempotent: boolean } {
  const o = db.select().from(offer).where(eq(offer.applicationId, applicationId)).get();
  if (!o || o.notifiedAt === null) {
    throw new OfferError('no_offer', 'There is no offer to respond to.', 404);
  }
  if (isPastDeadline(o.enrollmentDeadline)) {
    throw new OfferError(
      'deadline_passed',
      `This offer expired on ${o.enrollmentDeadline}. Please email us.`,
    );
  }

  const stamp = now();

  return db.transaction((tx) => {
    const res = tx
      .update(offer)
      .set({
        response,
        respondedAt: stamp,
        respondedByUserId: actor.userId,
        updatedAt: stamp,
      })
      .where(and(eq(offer.applicationId, applicationId), isNull(offer.response)))
      .run();

    if (res.changes === 0) {
      const cur = tx.select().from(offer).where(eq(offer.applicationId, applicationId)).get()!;
      if (cur.response === response) {
        const status = deriveStatus(cur, paidCentsFor(applicationId));
        return { status, idempotent: true };
      }
      throw new OfferError(
        'already_responded',
        `This offer was already ${cur.response}. Please email us to change it.`,
      );
    }

    const status = deriveStatus({ response, amountDueCents: o.amountDueCents }, paidCentsFor(applicationId));
    tx.update(application)
      .set({ status, updatedAt: stamp })
      .where(eq(application.id, applicationId))
      .run();

    return { status, idempotent: false };
  });
}

/** Recompute and persist status from the authoritative offer + payments. */
export function refreshStatus(applicationId: string): ApplicationStatus | null {
  const o = db.select().from(offer).where(eq(offer.applicationId, applicationId)).get();
  if (!o) return null;
  const status = deriveStatus(o, paidCentsFor(applicationId));
  db.update(application)
    .set({ status, updatedAt: now() })
    .where(eq(application.id, applicationId))
    .run();
  return status;
}

export function offerSummaryFor(applicationId: string) {
  const o = db.select().from(offer).where(eq(offer.applicationId, applicationId)).get();
  if (!o) return null;
  return {
    courseLabel: courseLabel(o.courseKey),
    section: o.section,
    cohort: o.cohort,
    problemSession: o.problemSession,
    officeHours: o.officeHours,
    amountDue: formatCents(o.amountDueCents),
    amountDueCents: o.amountDueCents,
    enrollmentDeadline: o.enrollmentDeadline,
    notes: o.notes,
  };
}
