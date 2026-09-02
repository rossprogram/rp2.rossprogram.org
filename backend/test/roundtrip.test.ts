/*
 * The round-trip invariant.
 *
 * A template downloaded and re-uploaded without edits must produce ZERO
 * changes. Everything else in the import design rests on this: it is what
 * makes "an empty cell clears the field" safe, and it is the first thing to
 * break if the money or date coercers regress.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { nanoid } from 'nanoid';

process.env.DATABASE_URL = ':memory:';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-pass-zod';
process.env.EMAIL_TRANSPORT = 'console';

const { db } = await import('../src/db/client.js');
const schema = await import('../src/db/schema.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { buildTemplate, previewImport } = await import('../src/services/offers.js');
const { utils, read, write } = await import('xlsx');
const { OFFER_IMPORT_COLUMNS } = await import('@rp2/shared');

const now = () => Math.floor(Date.now() / 1000);

/** Three applicants spanning full-pay, partial aid, and full scholarship. */
function seedThree() {
  const cases = [
    { course: 'topology', aid: 0, due: 150_000, notes: null },
    { course: 'ggt', aid: 75_000, due: 75_000, notes: 'Line one\nLine two, with a comma' },
    { course: 'quadratic', aid: 150_000, due: 0, notes: 'Quotes "like this" survive too' },
  ];
  cases.forEach((c, i) => {
    const uid = nanoid();
    const aid = nanoid();
    db.insert(schema.user).values({ id: uid, email: `s${i}@example.com`, createdAt: now() }).run();
    db.insert(schema.application)
      .values({
        id: aid, applicantUserId: uid, status: 'accepted',
        createdAt: now(), updatedAt: now(), submittedAt: now(),
        decisionNotes: i === 0 ? 'strong file' : null,
      })
      .run();
    db.insert(schema.applicationResponse)
      .values({
        applicationId: aid, questionKey: 'student_legal_name',
        value: JSON.stringify(`Student ${i}`), updatedAt: now(),
      })
      .run();
    db.insert(schema.offer)
      .values({
        id: nanoid(), applicationId: aid, courseKey: c.course,
        section: 'TOPOLOGY-2', cohort: '5',
        problemSession: 'Sun 09:00', officeHours: 'Sat 09:00',
        aidAmountCents: c.aid, amountDueCents: c.due,
        enrollmentDeadline: '2026-09-19', notes: c.notes,
        createdAt: now(), updatedAt: now(), notifiedAt: now(),
      })
      .run();
  });
}

beforeAll(() => {
  runMigrations();
});

beforeEach(() => {
  db.delete(schema.offer).run();
  db.delete(schema.applicationResponse).run();
  db.delete(schema.application).run();
  db.delete(schema.user).run();
});

describe('template round trip', () => {
  // Regression: the template prefills whatever status a row currently has,
  // including statuses an import may not SET (submitted, draft, enrolled).
  // Re-uploading such a row untouched must be a no-op, not an error.
  it('accepts a prefilled status that admin could not set as a change', () => {
    const uid = nanoid();
    const aid = nanoid();
    db.insert(schema.user).values({ id: uid, email: 'new@example.com', createdAt: now() }).run();
    db.insert(schema.application)
      .values({
        id: aid, applicantUserId: uid, status: 'submitted',
        createdAt: now(), updatedAt: now(), submittedAt: now(),
      })
      .run();

    const p = previewImport(buildTemplate('csv'), 'offers.csv');
    expect(p.errorRows).toEqual([]);
    expect(p.changedRows).toEqual([]);
    expect(p.unchangedCount).toBe(1);
  });

  it('still refuses to MOVE a row to a status admin does not own', () => {
    const uid = nanoid();
    const aid = nanoid();
    db.insert(schema.user).values({ id: uid, email: 'new@example.com', createdAt: now() }).run();
    db.insert(schema.application)
      .values({
        id: aid, applicantUserId: uid, status: 'accepted',
        createdAt: now(), updatedAt: now(), submittedAt: now(),
      })
      .run();

    const wb2 = utils.book_new();
    utils.book_append_sheet(
      wb2,
      utils.json_to_sheet([{ app_id: aid, status: 'submitted' }]),
      'offers',
    );
    const p = previewImport(
      Buffer.from(write(wb2, { type: 'buffer', bookType: 'csv' }) as Uint8Array),
      'offers.csv',
    );
    expect(p.errorRows[0]!.errors[0]!.code).toBe('unsettable_status');
  });

  it('makes no changes when a CSV template is re-uploaded untouched', () => {
    seedThree();
    const p = previewImport(buildTemplate('csv'), 'offers.csv');
    expect(p.fatal).toEqual([]);
    expect(p.errorRows).toEqual([]);
    expect(p.changedRows).toEqual([]);
    expect(p.unchangedCount).toBe(3);
  });

  it('makes no changes when an Excel template is re-uploaded untouched', () => {
    seedThree();
    const p = previewImport(buildTemplate('xlsx'), 'offers.xlsx');
    expect(p.fatal).toEqual([]);
    expect(p.errorRows).toEqual([]);
    expect(p.changedRows).toEqual([]);
    expect(p.unchangedCount).toBe(3);
  });

  // Excel rewrites dates and drops trailing zeros the moment you open and
  // re-save a CSV. Simulate that by round-tripping through the parser and
  // re-serializing, which is what SheetJS does to the same cells.
  it('survives a spreadsheet application opening and re-saving the file', () => {
    seedThree();
    const original = buildTemplate('csv');
    const wb = read(original, { type: 'buffer', cellDates: true, raw: true });
    const resaved = Buffer.from(
      write(wb, { type: 'buffer', bookType: 'csv' }) as Uint8Array,
    );

    const p = previewImport(resaved, 'offers.csv');
    expect(p.fatal).toEqual([]);
    expect(p.errorRows).toEqual([]);
    expect(p.changedRows).toEqual([]);
  });

  it('detects exactly one change when exactly one cell is edited', () => {
    seedThree();
    const wb = read(buildTemplate('csv'), { type: 'buffer', cellDates: true, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    const rows = utils.sheet_to_json<Record<string, unknown>>(ws, { raw: true, defval: '' });
    rows[1]!.section = 'B';

    const edited = utils.book_new();
    utils.book_append_sheet(edited, utils.json_to_sheet(rows), 'offers');
    const p = previewImport(
      Buffer.from(write(edited, { type: 'buffer', bookType: 'csv' }) as Uint8Array),
      'offers.csv',
    );

    expect(p.errorRows).toEqual([]);
    expect(p.changedRows).toHaveLength(1);
    expect(p.changedRows[0]!.changes).toEqual([
      { field: 'section', column: 'section', before: 'TOPOLOGY-2', after: 'B' },
    ]);
  });

  it('leaves a deleted column alone rather than clearing it', () => {
    seedThree();
    const wb = read(buildTemplate('csv'), { type: 'buffer', cellDates: true, raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    const rows = utils.sheet_to_json<Record<string, unknown>>(ws, { raw: true, defval: '' });
    // Drop notes entirely, the way an admin would by deleting the column.
    const trimmed = rows.map((r) => {
      const { notes: _notes, ...rest } = r as Record<string, unknown> & { notes?: unknown };
      return rest;
    });

    const wb2 = utils.book_new();
    utils.book_append_sheet(wb2, utils.json_to_sheet(trimmed), 'offers');
    const p = previewImport(
      Buffer.from(write(wb2, { type: 'buffer', bookType: 'csv' }) as Uint8Array),
      'offers.csv',
    );

    expect(p.changedRows).toEqual([]);
    expect(p.absentColumns).toContain('notes');
    expect(p.appliedColumns).not.toContain('notes');
  });
});

describe('template instructions', () => {
  it('leads the xlsx with an Instructions sheet, data second', () => {
    seedThree();
    const wb = read(buildTemplate('xlsx'), { type: 'buffer' });
    expect(wb.SheetNames[0]).toBe('Instructions');
    expect(wb.SheetNames).toContain('offers');

    const text = utils.sheet_to_csv(wb.Sheets['Instructions']!);
    expect(text).toContain('A column you DELETE is left alone');
    expect(text).toContain('A cell you EMPTY clears that field');
    expect(text).toContain('VISIBLE TO THE STUDENT AND PARENT');
    expect(text).toContain('Nobody is emailed when you publish');
  });

  // The guidance is generated from OFFER_IMPORT_COLUMNS, so it cannot drift
  // from the columns it describes.
  it('documents every column, and marks which are editable', () => {
    seedThree();
    const wb = read(buildTemplate('xlsx'), { type: 'buffer' });
    // Read raw cells rather than sheet_to_csv, which re-quotes commas.
    const rows = utils.sheet_to_json<string[]>(wb.Sheets['Instructions']!, {
      header: 1,
      defval: '',
    });
    const byColumn = new Map(rows.map((r) => [r[0], r]));

    for (const c of OFFER_IMPORT_COLUMNS) {
      const row = byColumn.get(c.key);
      expect(row, `no instructions row for ${c.key}`).toBeDefined();
      expect(row![1]).toBe(c.kind === 'editable' ? 'yes' : 'NO');
      expect(row![2]).toBe(c.help);
    }
  });

  it('reads the data sheet by name, not by position', () => {
    seedThree();
    // Would parse the Instructions sheet and find no app_id if it went by [0].
    const p = previewImport(buildTemplate('xlsx'), 'offers.xlsx');
    expect(p.fatal).toEqual([]);
    expect(p.rowCount).toBe(3);
  });

  it('puts a help row in the CSV and skips it on import', () => {
    seedThree();
    const csv = buildTemplate('csv').toString('utf8');
    expect(csv).toContain('# DO NOT DELETE THIS ROW');
    expect(csv).toContain('VISIBLE TO THE STUDENT AND PARENT');

    const p = previewImport(buildTemplate('csv'), 'offers.csv');
    expect(p.fatal).toEqual([]);
    expect(p.errorRows).toEqual([]);
    expect(p.changedRows).toEqual([]);
    // The comment row is not counted as data.
    expect(p.rowCount).toBe(3);
    expect(p.unchangedCount).toBe(3);
  });

  it('still skips the help row after the admin sorts the sheet', () => {
    seedThree();
    const wb = read(buildTemplate('csv'), { type: 'buffer', cellDates: true, raw: true });
    const rows = utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[wb.SheetNames[0]!]!,
      { raw: true, defval: '' },
    );
    // Sorting by name drags the '#' row into the middle.
    const sorted = [rows[1]!, rows[0]!, rows[2]!, rows[3]!];
    const wb2 = utils.book_new();
    utils.book_append_sheet(wb2, utils.json_to_sheet(sorted), 'offers');

    const p = previewImport(
      Buffer.from(write(wb2, { type: 'buffer', bookType: 'csv' }) as Uint8Array),
      'offers.csv',
    );
    expect(p.errorRows).toEqual([]);
    expect(p.changedRows).toEqual([]);
    expect(p.rowCount).toBe(3);
  });

  it('does not mistake a help row for a duplicate or an unknown id', () => {
    seedThree();
    const p = previewImport(buildTemplate('csv'), 'offers.csv');
    const codes = p.errorRows.flatMap((r) => r.errors.map((e) => e.code));
    expect(codes).not.toContain('unknown_app_id');
    expect(codes).not.toContain('duplicate_app_id');
  });
});
