import { describe, it, expect } from 'vitest';
import { validateImport, type CurrentRow } from '../src/services/offer-import.js';
import { TUITION_CENTS } from '@rp2/shared';

/* -------- fixtures -------- */

function app(over: Partial<CurrentRow> = {}): CurrentRow {
  return {
    appId: 'A1',
    studentEmail: 'yash@example.com',
    studentName: 'Yash',
    status: 'submitted',
    internalNotes: null,
    offer: null,
    hasPaidPayments: false,
    ...over,
  };
}

/** An offer row with sensible defaults, for the cases that need one. */
function offerOf(over: Partial<NonNullable<CurrentRow['offer']>> = {}) {
  return {
    courseKey: 'topology',
    section: null,
    cohort: null,
    problemSession: null,
    officeHours: null,
    aidAmountCents: 75_000,
    amountDueCents: 75_000,
    enrollmentDeadline: null,
    notes: null,
    response: null,
    respondedAt: null,
    ...over,
  };
}

function snapshot(...rows: CurrentRow[]): Map<string, CurrentRow> {
  return new Map(rows.map((r) => [r.appId, r]));
}

/** Run the validator over object rows, deriving headers from the first row. */
function run(
  rows: Record<string, unknown>[],
  current: Map<string, CurrentRow>,
  headers?: string[],
) {
  const hdrs = headers ?? Object.keys(rows[0] ?? {});
  return validateImport(rows, hdrs, current, {
    filename: 'test.csv',
    fileHash: 'abc',
    today: '2026-09-05',
  });
}

const OK_ROW = {
  app_id: 'A1',
  student_email: 'yash@example.com',
  status: 'accepted',
  course: 'topology',
  amount_due: '750',
  aid_amount: '750',
};

/* -------- fatal, file level -------- */

describe('fatal errors', () => {
  it('rejects a sheet with no app_id column', () => {
    const { preview } = run([{ status: 'accepted' }], snapshot(app()));
    expect(preview.fatal.map((f) => f.code)).toContain('missing_key_column');
  });

  it('rejects an empty sheet', () => {
    const { preview } = run([], snapshot(app()), ['app_id', 'status']);
    expect(preview.fatal.map((f) => f.code)).toContain('empty_sheet');
  });

  it('rejects duplicate headers', () => {
    const { preview } = run([{ app_id: 'A1' }], snapshot(app()), ['app_id', 'status', 'status']);
    expect(preview.fatal.map((f) => f.code)).toContain('duplicate_header');
  });

  it('produces no resolved rows when fatal', () => {
    const { resolved } = run([{ status: 'accepted' }], snapshot(app()));
    expect(resolved).toEqual([]);
  });
});

/* -------- row identity -------- */

describe('row identity', () => {
  it('errors on a blank app_id', () => {
    const { preview } = run([{ app_id: '', status: 'accepted' }], snapshot(app()));
    expect(preview.errorRows[0]!.errors[0]!.code).toBe('missing_app_id');
  });

  it('errors on an unknown app_id', () => {
    const { preview } = run([{ app_id: 'NOPE', status: 'accepted' }], snapshot(app()));
    expect(preview.errorRows[0]!.errors[0]!.code).toBe('unknown_app_id');
  });

  it('flags duplicated app_ids on both rows, naming each other', () => {
    const { preview } = run(
      [{ app_id: 'A1', status: 'accepted' }, { app_id: 'A1', status: 'rejected' }],
      snapshot(app()),
    );
    expect(preview.errorRows).toHaveLength(2);
    expect(preview.errorRows[0]!.errors[0]!.message).toContain('row 3');
    expect(preview.errorRows[1]!.errors[0]!.message).toContain('row 2');
  });

  it('blocks a misaligned sheet via the email check', () => {
    const { preview } = run(
      [{ ...OK_ROW, student_email: 'someone.else@example.com' }],
      snapshot(app()),
    );
    expect(preview.errorRows[0]!.errors[0]!.code).toBe('email_mismatch');
  });

  it('ignores a blank email cell', () => {
    const { preview } = run([{ ...OK_ROW, student_email: '' }], snapshot(app()));
    expect(preview.errorRows).toHaveLength(0);
  });
});

/* -------- the round-trip invariant -------- */

describe('round trip', () => {
  it('reports zero changes for an untouched template', () => {
    const current = app({
      status: 'accepted',
      offer: offerOf({
        section: 'TOPOLOGY-2', cohort: '5', problemSession: 'Sun 09:00',
        enrollmentDeadline: '2026-09-19', notes: 'Welcome',
      }),
    });
    const { preview, resolved } = run(
      [{
        app_id: 'A1', student_email: 'yash@example.com', student_name: 'Yash',
        status: 'accepted', course: 'topology', section: 'TOPOLOGY-2',
        group: '5', problem_session: 'Sun 09:00',
        aid_amount: '$750', amount_due: '$750',
        enrollment_deadline: '2026-09-19', notes: 'Welcome', internal_notes: '',
      }],
      snapshot(current),
    );
    expect(preview.errorRows).toHaveLength(0);
    expect(preview.changedRows).toHaveLength(0);
    expect(preview.unchangedCount).toBe(1);
    expect(resolved).toHaveLength(0);
  });

  it('leaves absent columns untouched and says so', () => {
    const current = app({
      status: 'accepted',
      offer: offerOf({ aidAmountCents: 0, amountDueCents: 150_000, notes: 'Keep me' }),
    });
    const { preview, resolved } = run([{ app_id: 'A1', status: 'waitlisted' }], snapshot(current));
    expect(preview.absentColumns).toContain('notes');
    expect(preview.appliedColumns).toEqual(['status']);
    expect(resolved[0]!.fields).not.toHaveProperty('notes');
  });

  it('treats an empty cell in a present column as a deletion', () => {
    const current = app({
      status: 'accepted',
      offer: offerOf({ notes: 'Delete me' }),
    });
    const { preview } = run([{ app_id: 'A1', notes: '' }], snapshot(current));
    expect(preview.changedRows[0]!.changes[0]).toMatchObject({
      field: 'notes', before: 'Delete me', after: null,
    });
  });
});

/* -------- field rules -------- */

describe('field validation', () => {
  it('rejects an unknown course but accepts the full label', () => {
    const bad = run([{ ...OK_ROW, course: 'algebra' }], snapshot(app()));
    expect(bad.preview.errorRows[0]!.errors[0]!.code).toBe('unknown_course');

    const good = run([{ ...OK_ROW, course: 'Point-Set Topology' }], snapshot(app()));
    expect(good.preview.errorRows).toHaveLength(0);
    expect(good.resolved[0]!.fields.courseKey).toBe('topology');
  });

  it('rejects unparseable money', () => {
    const { preview } = run([{ ...OK_ROW, amount_due: 'about $700' }], snapshot(app()));
    expect(preview.errorRows[0]!.errors[0]!.code).toBe('money_not_money');
  });

  it('rejects a two-digit-year deadline', () => {
    const { preview } = run(
      [{ ...OK_ROW, enrollment_deadline: '9/19/26' }],
      snapshot(app()),
    );
    expect(preview.errorRows[0]!.errors[0]!.code).toBe('date_two_digit_year');
  });

  it('rejects over-long text', () => {
    const { preview } = run([{ ...OK_ROW, section: 'x'.repeat(41) }], snapshot(app()));
    expect(preview.errorRows[0]!.errors[0]!.code).toBe('too_long');
  });

  it('rejects an unknown status', () => {
    const { preview } = run([{ app_id: 'A1', status: 'maybe' }], snapshot(app()));
    expect(preview.errorRows[0]!.errors[0]!.code).toBe('unknown_value');
  });
});

/* -------- semantic rules -------- */

describe('semantic rules', () => {
  it('refuses to let admin set a family-owned status', () => {
    for (const s of ['enrolled', 'awaiting_payment', 'declined']) {
      const { preview } = run([{ ...OK_ROW, status: s }], snapshot(app()));
      expect(preview.errorRows[0]!.errors.map((e) => e.code)).toContain('family_owned_status');
    }
  });

  it('allows a family-owned status to stay untouched', () => {
    const current = app({
      status: 'enrolled',
      offer: offerOf({ response: 'accepted', respondedAt: 1 }),
    });
    const { preview } = run([{ app_id: 'A1', status: 'enrolled', notes: 'Congrats' }], snapshot(current));
    expect(preview.errorRows).toHaveLength(0);
  });

  it('refuses an offer on a draft application', () => {
    const { preview } = run([{ ...OK_ROW }], snapshot(app({ status: 'draft' })));
    expect(preview.errorRows[0]!.errors.map((e) => e.code)).toContain('draft_application');
  });

  it('requires a course on an accepted row', () => {
    const { preview } = run(
      [{ app_id: 'A1', status: 'accepted', amount_due: '750' }],
      snapshot(app()),
    );
    expect(preview.errorRows[0]!.errors.map((e) => e.code)).toContain('accepted_without_course');
  });

  it('requires an explicit amount due, since blank is ambiguous', () => {
    const { preview } = run(
      [{ app_id: 'A1', status: 'accepted', course: 'topology', amount_due: '' }],
      snapshot(app()),
    );
    expect(preview.errorRows[0]!.errors.map((e) => e.code)).toContain('accepted_without_amount');
  });

  it('accepts an explicit zero for a full scholarship', () => {
    const { preview, resolved } = run(
      [{ app_id: 'A1', status: 'accepted', course: 'topology', amount_due: '0', aid_amount: '1500' }],
      snapshot(app()),
    );
    expect(preview.errorRows).toHaveLength(0);
    // amount_due is 0 both before and after, so it is not in the change set —
    // the offer row picks up 0 from the schema default. What matters is that
    // the row is publishable at all.
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.fields.aidAmountCents).toBe(150_000);
  });

  it('rejects offer fields on a row that carries no offer', () => {
    const { preview } = run(
      [{ app_id: 'A1', status: 'rejected', course: 'topology', problem_session: 'Sun 09:00' }],
      snapshot(app()),
    );
    expect(preview.errorRows[0]!.errors.map((e) => e.code)).toContain('offer_fields_without_offer');
  });

  it('refuses to re-bill a family that has already paid', () => {
    const current = app({
      status: 'enrolled',
      hasPaidPayments: true,
      offer: offerOf({ response: 'accepted', respondedAt: 1 }),
    });
    const { preview } = run([{ app_id: 'A1', amount_due: '900' }], snapshot(current));
    expect(preview.errorRows[0]!.errors.map((e) => e.code)).toContain('already_paid');
  });
});

/* -------- warnings never block -------- */

describe('full scholarships', () => {
  // An import may offer a full ride, but it may never enroll anyone — the
  // family's own acceptance is the only thing that does that.
  it('cannot enroll a full-ride applicant directly from the sheet', () => {
    const { preview } = run(
      [{ app_id: 'A1', status: 'enrolled', course: 'topology', aid_amount: '1500', amount_due: '0' }],
      snapshot(app()),
    );
    expect(preview.errorRows[0]!.errors.map((e) => e.code)).toContain('family_owned_status');
  });

  it('publishes a full-ride offer as accepted, awaiting an answer', () => {
    const { preview, resolved } = run(
      [{ app_id: 'A1', status: 'accepted', course: 'topology', aid_amount: '1500', amount_due: '0' }],
      snapshot(app()),
    );
    expect(preview.errorRows).toHaveLength(0);
    expect(preview.warningRows).toHaveLength(0); // 1500 + 0 == tuition
    expect(resolved[0]!.fields.status).toBe('accepted');
  });
});

describe('warnings', () => {
  it('warns when aid plus due does not equal tuition', () => {
    const { preview } = run(
      [{ ...OK_ROW, aid_amount: '100', amount_due: '100' }],
      snapshot(app()),
    );
    expect(preview.errorRows).toHaveLength(0);
    expect(preview.warningRows[0]!.warnings.map((w) => w.code)).toContain('tuition_mismatch');
  });

  it('warns, but does not block, on rewriting an answered offer', () => {
    const current = app({
      status: 'awaiting_payment',
      offer: offerOf({ enrollmentDeadline: '2026-09-19', response: 'accepted', respondedAt: 1 }),
    });
    const { preview, resolved } = run([{ app_id: 'A1', problem_session: 'Wed 20:00' }], snapshot(current));
    expect(preview.errorRows).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    expect(preview.warningRows[0]!.warnings.map((w) => w.code)).toContain('rewrites_answered_offer');
  });

  it('warns on a past deadline', () => {
    const { preview } = run(
      [{ ...OK_ROW, enrollment_deadline: '2026-08-01' }],
      snapshot(app()),
    );
    expect(preview.warningRows[0]!.warnings.map((w) => w.code)).toContain('deadline_past');
  });

  it('warns when reopening a declined offer', () => {
    const current = app({
      status: 'declined',
      offer: offerOf({ response: 'declined', respondedAt: 1 }),
    });
    const { preview } = run([{ app_id: 'A1', status: 'accepted' }], snapshot(current));
    expect(preview.errorRows).toHaveLength(0);
    expect(preview.warningRows[0]!.warnings.map((w) => w.code)).toContain('reopening');
  });

  it('reports unknown columns without blocking', () => {
    const { preview } = run(
      [{ ...OK_ROW, reviewer_initials: 'JF' }],
      snapshot(app()),
    );
    expect(preview.unknownColumns).toEqual(['reviewer_initials']);
    expect(preview.errorRows).toHaveLength(0);
  });
});

/* -------- diff shape -------- */

describe('diff', () => {
  it('records before and after for each change', () => {
    const { preview, resolved } = run([OK_ROW], snapshot(app()));
    const changes = preview.changedRows[0]!.changes;
    expect(changes).toContainEqual({
      field: 'status', column: 'status', before: 'submitted', after: 'accepted',
    });
    expect(changes).toContainEqual({
      field: 'amountDueCents', column: 'amount_due', before: 0, after: 75_000,
    });
    expect(resolved[0]!.appId).toBe('A1');
  });

  it('does not warn when aid plus due equals tuition', () => {
    expect(TUITION_CENTS).toBe(150_000);
    const { preview } = run(
      [{ ...OK_ROW, aid_amount: '750', amount_due: '750' }],
      snapshot(app()),
    );
    expect(preview.warningRows).toHaveLength(0);
  });
});
