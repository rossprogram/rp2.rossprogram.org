/*
 * readSheet is the trust boundary for an uploaded file. It is admin-only, but
 * "admin-only" is not a reason to hand a crafted workbook to a parser with a
 * known prototype-pollution CVE.
 */
import { describe, it, expect } from 'vitest';
import { utils, write } from 'xlsx';

process.env.DATABASE_URL = ':memory:';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-pass-zod';

const { readSheet, previewImport, OfferError } = await import('../src/services/offers.js');
const { IMPORT_MAX_ROWS } = await import('@rp2/shared');
const { runMigrations } = await import('../src/db/migrate.js');

runMigrations();

function csv(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

function sheet(rows: Record<string, unknown>[]): Buffer {
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'offers');
  return Buffer.from(write(wb, { type: 'buffer', bookType: 'csv' }) as Uint8Array);
}

describe('readSheet', () => {
  it('reads headers and rows from a CSV', () => {
    const r = readSheet(csv('app_id,status\nA1,accepted\n'));
    expect(r.headers).toEqual(['app_id', 'status']);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.app_id).toBe('A1');
  });

  it('hashes the bytes, so publish can detect a swapped file', () => {
    const a = readSheet(csv('app_id\nA1\n'));
    const b = readSheet(csv('app_id\nA2\n'));
    expect(a.fileHash).toHaveLength(64);
    expect(a.fileHash).not.toBe(b.fileHash);
    expect(readSheet(csv('app_id\nA1\n')).fileHash).toBe(a.fileHash);
  });

  it('keeps only columns it recognises', () => {
    const r = readSheet(csv('app_id,status,reviewer,secret\nA1,accepted,JF,x\n'));
    expect(Object.keys(r.rows[0]!)).toEqual(['app_id', 'status']);
    // Unknown headers are still reported, so the preview can list them.
    expect(r.headers).toContain('reviewer');
  });

  // The rebuilt row uses a null prototype and copies only known keys, so a
  // crafted sheet cannot reach Object.prototype.
  it('cannot pollute Object.prototype through a crafted header', () => {
    const before = ({} as Record<string, unknown>).polluted;
    const r = readSheet(csv('app_id,__proto__,constructor\nA1,{"polluted":true},x\n'));
    expect(({} as Record<string, unknown>).polluted).toBe(before);
    expect(Object.getPrototypeOf(r.rows[0]!)).toBeNull();
    expect('__proto__' in r.rows[0]!).toBe(false);
  });

  it('rejects a file over the size cap before parsing it', () => {
    const huge = Buffer.alloc(3 * 1024 * 1024, 'a');
    expect(() => readSheet(huge)).toThrow(OfferError);
    try {
      readSheet(huge);
    } catch (err) {
      expect((err as InstanceType<typeof OfferError>).code).toBe('file_too_large');
      expect((err as InstanceType<typeof OfferError>).statusCode).toBe(413);
    }
  });

  it('rejects a sheet with more rows than the cap', () => {
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => ({
      app_id: `A${i}`,
    }));
    try {
      readSheet(sheet(rows));
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as InstanceType<typeof OfferError>).code).toBe('too_many_rows');
    }
  });

  // SheetJS will happily read binary garbage as a one-column CSV rather than
  // throwing, so the rejection lands one layer later — as a fatal preview
  // error naming the missing key column. Assert the guarantee that matters:
  // junk never reaches the database.
  it('lets the validator reject a file that is not a spreadsheet', () => {
    const junk = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    expect(() => readSheet(junk)).not.toThrow();
    const p = previewImport(junk, 'photo.jpg');
    expect(p.fatal.map((f) => f.code)).toContain('missing_key_column');
    expect(p.changedRows).toEqual([]);
  });

  it('ignores blank rows rather than treating them as data', () => {
    const r = readSheet(csv('app_id,status\nA1,accepted\n\n\nA2,waitlisted\n'));
    expect(r.rows).toHaveLength(2);
  });
});
