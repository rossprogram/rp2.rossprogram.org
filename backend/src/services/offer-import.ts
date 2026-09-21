import {
  ADMIN_SETTABLE_STATUSES,
  ApplicationStatus as ApplicationStatusEnum,
  DERIVED_STATUSES,
  FAMILY_OWNED_STATUSES,
  IMPORT_MAX_ROWS,
  OFFER_IMPORT_COLUMNS,
  TUITION_CENTS,
  deriveStatus,
  formatCents,
  parseDeadline,
  parseMoneyToCents,
  resolveCourseKey,
  stripCsvGuard,
  todayInProgramTz,
  type ApplicationStatus,
  type ImportChange,
  type ImportIssue,
  type ImportPreview,
  type ImportRow,
  type OfferField,
  type OfferImportColumn,
} from '@rp2/shared';

/*
 * Validation for the admin offer spreadsheet.
 *
 * validateImport() is deliberately PURE — it takes the database snapshot as an
 * argument rather than querying. Every rule below is therefore a unit test with
 * no database, which is the only reason ~20 rules are affordable to cover.
 *
 * Blank-cell semantics, which everything here depends on:
 *   - a MISSING COLUMN means "don't touch that field on any row"
 *   - an EMPTY CELL in a present column means "set that field empty"
 * This works because the downloaded template arrives prefilled, so an empty
 * cell is a deliberate deletion rather than an omission.
 */

/** The current state of one application, as the validator needs to see it. */
export type CurrentRow = {
  appId: string;
  studentEmail: string;
  studentName: string | null;
  status: ApplicationStatus;
  /** Read-only placement context, keyed by import column. */
  context: Record<string, string>;
  /** application.decision_notes — admin-only, never shown to families. */
  internalNotes: string | null;
  offer: OfferSnapshot | null;
  hasPaidPayments: boolean;
};

export type OfferSnapshot = {
  courseKey: string | null;
  section: string | null;
  cohort: string | null;
  problemSession: string | null;
  officeHours: string | null;
  aidAmountCents: number;
  amountDueCents: number;
  enrollmentDeadline: string | null;
  notes: string | null;
  response: 'accepted' | 'declined' | null;
  respondedAt: number | null;
};

/** The resolved, validated value set for one row — what publish() applies. */
export type ResolvedRow = {
  appId: string;
  fields: Partial<Record<OfferField, unknown>>;
};

export type ValidateResult = {
  preview: ImportPreview;
  /** Only rows that are error-free AND actually change something. */
  resolved: ResolvedRow[];
};

const EDITABLE_COLUMNS = OFFER_IMPORT_COLUMNS.filter((c) => c.kind === 'editable');

const FAMILY_OWNED = new Set<string>(FAMILY_OWNED_STATUSES);
const ADMIN_SETTABLE = new Set<string>(ADMIN_SETTABLE_STATUSES);
/** Statuses deriveStatus() owns, and so may rewrite without a status cell. */
const DERIVED = new Set<string>(DERIVED_STATUSES);
const ALL_STATUSES = new Set<string>(ApplicationStatusEnum.options);

/** Statuses that carry no offer, so offer fields on such a row are a mistake. */
const NON_OFFER_STATUSES = new Set<ApplicationStatus>([
  'under_review',
  'waitlisted',
  'rejected',
  'withdrawn',
]);

/*
 * A '#' in app_id marks a non-data row. nanoid's alphabet is [A-Za-z0-9_-], so
 * a real id can never begin with one and there is no collision to worry about.
 */
function isComment(appId: string): boolean {
  return appId.startsWith('#');
}

function cell(row: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(row, key) ? row[key] : undefined;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  // stripCsvGuard undoes the apostrophe csvGuard added on export, so a
  // downloaded template re-imports byte-identically.
  return stripCsvGuard(String(v).trim());
}

function issue(
  row: number,
  column: string | null,
  code: string,
  message: string,
): ImportIssue {
  return { row, column, code, message };
}

/**
 * Validate a parsed sheet against current database state.
 *
 * `sheetRows` are already-sanitized objects (known headers only — see
 * readSheet, which never spreads a parsed row). Row numbers in issues are
 * 1-based as the admin sees them in the spreadsheet, header included.
 */
export function validateImport(
  sheetRows: readonly Record<string, unknown>[],
  headers: readonly string[],
  current: ReadonlyMap<string, CurrentRow>,
  opts: { filename: string; fileHash: string; today?: string } = {
    filename: 'upload',
    fileHash: '',
  },
): ValidateResult {
  const today = opts.today ?? todayInProgramTz();
  const fatal: ImportIssue[] = [];

  const headerSet = new Set(headers);
  const known = new Set(OFFER_IMPORT_COLUMNS.map((c) => c.key));
  const unknownColumns = headers.filter((h) => !known.has(h));

  const dupHeaders = headers.filter((h, i) => headers.indexOf(h) !== i);
  if (dupHeaders.length > 0) {
    fatal.push(
      issue(1, null, 'duplicate_header', `Duplicated column heading: ${[...new Set(dupHeaders)].join(', ')}.`),
    );
  }
  if (!headerSet.has('app_id')) {
    fatal.push(issue(1, 'app_id', 'missing_key_column', 'The sheet has no app_id column.'));
  }
  if (sheetRows.length === 0) {
    fatal.push(issue(1, null, 'empty_sheet', 'The sheet has no data rows.'));
  }
  if (sheetRows.length > IMPORT_MAX_ROWS) {
    fatal.push(
      issue(1, null, 'too_many_rows', `The sheet has ${sheetRows.length} rows; the limit is ${IMPORT_MAX_ROWS}.`),
    );
  }

  // Which editable fields this sheet may write at all.
  const applied = EDITABLE_COLUMNS.filter((c) => headerSet.has(c.key));
  const absent = EDITABLE_COLUMNS.filter((c) => !headerSet.has(c.key));

  const emptyPreview: ImportPreview = {
    fileHash: opts.fileHash,
    filename: opts.filename,
    rowCount: sheetRows.length,
    appliedColumns: applied.map((c) => c.key),
    absentColumns: absent.map((c) => c.key),
    unknownColumns,
    changedRows: [],
    errorRows: [],
    warningRows: [],
    unchangedCount: 0,
    errorCount: 0,
    fatal,
  };
  if (fatal.length > 0) return { preview: emptyPreview, resolved: [] };

  // Duplicate app_id detection needs a first pass so both rows can name each other.
  const rowsByAppId = new Map<string, number[]>();
  sheetRows.forEach((r, i) => {
    const id = str(cell(r, 'app_id'));
    if (id === '' || isComment(id)) return;
    const list = rowsByAppId.get(id);
    if (list) list.push(i + 2);
    else rowsByAppId.set(id, [i + 2]);
  });

  const changedRows: ImportRow[] = [];
  const errorRows: ImportRow[] = [];
  const warningRows: ImportRow[] = [];
  const resolved: ResolvedRow[] = [];
  let unchangedCount = 0;
  let commentRows = 0;

  sheetRows.forEach((raw, i) => {
    const rowNo = i + 2; // header is row 1
    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    const changes: ImportChange[] = [];
    const fields: Partial<Record<OfferField, unknown>> = {};

    const appId = str(cell(raw, 'app_id'));

    // The CSV template carries its guidance as a '#' row, since a CSV has
    // nowhere else to put it. Skip it silently — including after a sort has
    // dragged it into the middle of the data.
    if (isComment(appId)) {
      commentRows += 1;
      return;
    }

    const cur = appId === '' ? undefined : current.get(appId);

    // -- rules 1 & 2: identity
    if (appId === '') {
      errors.push(issue(rowNo, 'app_id', 'missing_app_id', 'This row has no app_id.'));
    } else if ((rowsByAppId.get(appId)?.length ?? 0) > 1) {
      const others = rowsByAppId.get(appId)!.filter((n) => n !== rowNo);
      errors.push(
        issue(rowNo, 'app_id', 'duplicate_app_id', `app_id ${appId} also appears on row ${others.join(', ')}.`),
      );
    } else if (!cur) {
      errors.push(issue(rowNo, 'app_id', 'unknown_app_id', `No application with id ${appId}.`));
    }

    if (errors.length > 0 || !cur) {
      const r: ImportRow = {
        row: rowNo,
        appId,
        studentName: cur?.studentName ?? null,
        studentEmail: cur?.studentEmail ?? null,
        currentStatus: cur?.status ?? null,
        changes: [],
        errors,
        warnings,
      };
      errorRows.push(r);
      return;
    }

    // -- rule 3: the email sanity check
    if (headerSet.has('student_email')) {
      const given = str(cell(raw, 'student_email')).toLowerCase();
      if (given !== '' && given !== cur.studentEmail.trim().toLowerCase()) {
        errors.push(
          issue(rowNo, 'student_email', 'email_mismatch',
            `Row says ${given}, but ${appId} belongs to ${cur.studentEmail}. The sheet may be misaligned.`),
        );
      }
    }

    // -- resolve each editable column present in the sheet
    let nextStatus: ApplicationStatus = cur.status;

    for (const col of applied) {
      const rawCell = cell(raw, col.key);
      const before = currentValueOf(cur, col.field!);
      const parsed = coerce(col, rawCell, rowNo, errors);
      if (parsed === SKIP) continue;

      if (col.field === 'status') {
        nextStatus = (parsed as ApplicationStatus) ?? cur.status;
      }
      if (!sameValue(before, parsed)) {
        changes.push({ field: col.field!, column: col.key, before, after: parsed });
        fields[col.field!] = parsed;
      }
    }

    // -- rule 6: no offers on unsubmitted applications
    if (cur.status === 'draft' && changes.length > 0) {
      errors.push(
        issue(rowNo, null, 'draft_application',
          'This application is still a draft; it cannot be given a decision or an offer.'),
      );
    }

    // -- rule 5: which statuses may an import move a row TO?
    if (nextStatus !== cur.status && !ADMIN_SETTABLE.has(nextStatus)) {
      errors.push(
        FAMILY_OWNED.has(nextStatus)
          ? issue(rowNo, 'status', 'family_owned_status',
              `Only the family or a completed payment can set status to ${nextStatus}.`)
          : issue(rowNo, 'status', 'unsettable_status',
              `An import cannot move an application to ${nextStatus}.`),
      );
    }

    // -- rule 14: never re-bill someone who has already paid
    if (cur.hasPaidPayments && 'amountDueCents' in fields) {
      errors.push(
        issue(rowNo, 'amount_due', 'already_paid',
          'This family has already paid; the amount due cannot be changed here.'),
      );
    }

    const effective = effectiveOffer(cur, fields);

    // -- rules 11 & 12: an accepted row must be a complete offer
    if (nextStatus === 'accepted') {
      if (!effective.courseKey) {
        errors.push(
          issue(rowNo, 'course', 'accepted_without_course',
            'An accepted applicant needs a course placement.'),
        );
      }
      if (headerSet.has('amount_due')) {
        const dueCell = str(cell(raw, 'amount_due'));
        const wasSet = cur.offer !== null;
        if (dueCell === '' && !wasSet) {
          errors.push(
            issue(rowNo, 'amount_due', 'accepted_without_amount',
              'Enter an explicit amount due — use 0 for a full scholarship. A blank cell is ambiguous.'),
          );
        }
      }
    }

    // -- rule 13: offer fields on a row that carries no offer
    if (NON_OFFER_STATUSES.has(nextStatus)) {
      const offerish = changes.filter(
        (c) => c.field !== 'status' && c.field !== 'internalNotes' && c.after !== null && c.after !== '',
      );
      if (offerish.length > 0) {
        errors.push(
          issue(rowNo, offerish[0]!.column, 'offer_fields_without_offer',
            `Status is ${nextStatus}, so ${offerish.map((c) => c.column).join(', ')} would not be shown to anyone.`),
        );
      }
    }

    // -- warnings
    if (effective.aidAmountCents + effective.amountDueCents !== TUITION_CENTS && nextStatus === 'accepted') {
      warnings.push(
        issue(rowNo, 'amount_due', 'tuition_mismatch',
          `Aid ${formatCents(effective.aidAmountCents)} + due ${formatCents(effective.amountDueCents)} does not equal tuition ${formatCents(TUITION_CENTS)}.`),
      );
    }
    if (effective.enrollmentDeadline && effective.enrollmentDeadline < today) {
      warnings.push(
        issue(rowNo, 'enrollment_deadline', 'deadline_past',
          `The deadline ${effective.enrollmentDeadline} has already passed.`),
      );
    }
    if (cur.offer?.response && changes.some((c) => c.field !== 'internalNotes')) {
      warnings.push(
        issue(rowNo, null, 'rewrites_answered_offer',
          `This family already ${cur.offer.response} their offer; this rewrites it.`),
      );
    }
    if (FAMILY_OWNED.has(cur.status) && nextStatus === 'accepted') {
      warnings.push(
        issue(rowNo, 'status', 'reopening',
          `Reopening an offer that was ${cur.status}.`),
      );
    }

    /*
     * The money can carry a family across a status boundary with no status
     * cell in the sheet at all — a full scholarship for someone who already
     * accepted enrolls them. publish() writes that transition, so the preview
     * has to show it.
     *
     * Gated on another change existing, so an untouched template still
     * re-imports as zero changes (roundtrip.test.ts). Rows with a paid payment
     * are skipped: rule 14 has already rejected any money change on those, and
     * this validator cannot see how much was paid.
     */
    if (
      !('status' in fields) &&
      changes.length > 0 &&
      !cur.hasPaidPayments &&
      DERIVED.has(cur.status)
    ) {
      const derived = deriveStatus(
        {
          response: cur.offer?.response ?? null,
          amountDueCents: effective.amountDueCents,
        },
        0,
      );
      if (derived !== cur.status) {
        changes.push({
          field: 'status',
          column: 'status',
          before: cur.status,
          after: derived,
        });
      }
    }

    const out: ImportRow = {
      row: rowNo,
      appId,
      studentName: cur.studentName,
      studentEmail: cur.studentEmail,
      currentStatus: cur.status,
      changes,
      errors,
      warnings,
    };

    if (errors.length > 0) {
      errorRows.push(out);
    } else if (changes.length === 0) {
      unchangedCount += 1;
      if (warnings.length > 0) warningRows.push(out);
    } else {
      changedRows.push(out);
      if (warnings.length > 0) warningRows.push(out);
      resolved.push({ appId, fields });
    }
  });

  return {
    preview: {
      ...emptyPreview,
      // Comment rows are not data and should not be counted as rows read.
      rowCount: sheetRows.length - commentRows,
      changedRows,
      errorRows,
      warningRows,
      unchangedCount,
      errorCount: errorRows.reduce((n, r) => n + r.errors.length, 0),
    },
    resolved,
  };
}

/** Sentinel: this cell produced an error, so it contributes no change. */
const SKIP = Symbol('skip');

function coerce(
  col: OfferImportColumn,
  raw: unknown,
  rowNo: number,
  errors: ImportIssue[],
): unknown {
  const s = str(raw);

  switch (col.type) {
    case 'money': {
      const r = parseMoneyToCents(raw);
      if (!r.ok) {
        const why =
          r.code === 'negative' ? 'cannot be negative'
          : r.code === 'too_precise' ? 'has more than two decimal places'
          : r.code === 'too_large' ? 'is larger than $10,000'
          : 'is not a dollar amount';
        errors.push(issue(rowNo, col.key, `money_${r.code}`, `"${s}" ${why}.`));
        return SKIP;
      }
      return r.cents;
    }
    case 'date': {
      const r = parseDeadline(raw);
      if (!r.ok) {
        errors.push(
          issue(rowNo, col.key, `date_${r.code}`,
            r.code === 'two_digit_year'
              ? `"${s}" uses a two-digit year — write it as YYYY-MM-DD.`
              : `"${s}" is not a date. Use YYYY-MM-DD.`),
        );
        return SKIP;
      }
      return r.date;
    }
    case 'enum': {
      if (s === '') return col.field === 'status' ? SKIP : null;
      if (col.field === 'courseKey') {
        const key = resolveCourseKey(s);
        if (!key) {
          errors.push(
            issue(rowNo, col.key, 'unknown_course',
              `"${s}" is not a course. Use one of: ${col.enumValues?.join(', ')}.`),
          );
          return SKIP;
        }
        return key;
      }
      const v = s.toLowerCase().replace(/\s+/g, '_');
      if (col.field === 'status') {
        // Any real status is a legal VALUE — the template prefills whatever a
        // row currently is, including ones admin may not set (draft,
        // submitted, enrolled...). Whether a CHANGE to it is allowed is a
        // transition question, checked by the caller against the current row.
        if (!ALL_STATUSES.has(v)) {
          errors.push(
            issue(rowNo, col.key, 'unknown_value',
              `"${s}" is not a status. Use one of: ${col.enumValues?.join(', ')}.`),
          );
          return SKIP;
        }
        return v;
      }
      if (!col.enumValues?.includes(v)) {
        errors.push(
          issue(rowNo, col.key, 'unknown_value',
            `"${s}" is not valid here. Use one of: ${col.enumValues?.join(', ')}.`),
        );
        return SKIP;
      }
      return v;
    }
    default: {
      if (col.maxLength && s.length > col.maxLength) {
        errors.push(
          issue(rowNo, col.key, 'too_long',
            `${col.label} is ${s.length} characters; the limit is ${col.maxLength}.`),
        );
        return SKIP;
      }
      return s === '' ? null : s;
    }
  }
}

function currentValueOf(cur: CurrentRow, field: OfferField): unknown {
  switch (field) {
    case 'status': return cur.status;
    case 'internalNotes': return cur.internalNotes;
    case 'aidAmountCents': return cur.offer?.aidAmountCents ?? 0;
    case 'amountDueCents': return cur.offer?.amountDueCents ?? 0;
    case 'courseKey': return cur.offer?.courseKey ?? null;
    case 'section': return cur.offer?.section ?? null;
    case 'cohort': return cur.offer?.cohort ?? null;
    case 'problemSession': return cur.offer?.problemSession ?? null;
    case 'officeHours': return cur.offer?.officeHours ?? null;
    case 'enrollmentDeadline': return cur.offer?.enrollmentDeadline ?? null;
    case 'notes': return cur.offer?.notes ?? null;
  }
}

/** The offer as it would stand after this row's changes are applied. */
function effectiveOffer(cur: CurrentRow, fields: Partial<Record<OfferField, unknown>>) {
  const pick = <T,>(f: OfferField, fallback: T): T =>
    (f in fields ? (fields[f] as T) : fallback);
  return {
    courseKey: pick('courseKey', cur.offer?.courseKey ?? null),
    aidAmountCents: pick('aidAmountCents', cur.offer?.aidAmountCents ?? 0),
    amountDueCents: pick('amountDueCents', cur.offer?.amountDueCents ?? 0),
    enrollmentDeadline: pick('enrollmentDeadline', cur.offer?.enrollmentDeadline ?? null),
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Empty is empty, however the sheet spelled it.
  if ((a === null || a === undefined || a === '') && (b === null || b === '')) {
    return true;
  }
  return false;
}
