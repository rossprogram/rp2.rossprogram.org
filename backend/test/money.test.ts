import { describe, it, expect } from 'vitest';
import { parseMoneyToCents, formatCents } from '@rp2/shared';

/** Convenience: assert a successful parse and return the cents. */
function cents(raw: unknown): number {
  const r = parseMoneyToCents(raw);
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.cents;
}

function code(raw: unknown): string {
  const r = parseMoneyToCents(raw);
  if (r.ok) throw new Error(`expected failure, got ${r.cents}`);
  return r.code;
}

describe('parseMoneyToCents', () => {
  it('treats blank and nullish as zero', () => {
    expect(cents('')).toBe(0);
    expect(cents('   ')).toBe(0);
    expect(cents(null)).toBe(0);
    expect(cents(undefined)).toBe(0);
  });

  it('parses plain integers', () => {
    expect(cents('0')).toBe(0);
    expect(cents('1500')).toBe(150_000);
    expect(cents(1500)).toBe(150_000);
  });

  it('parses decimals exactly', () => {
    expect(cents('1234.56')).toBe(123_456);
    expect(cents('0.01')).toBe(1);
    expect(cents('0.1')).toBe(10);
    expect(cents('750.5')).toBe(75_050);
  });

  // The reason the implementation routes numbers through String() first.
  it('parses XLSX float cells without drift', () => {
    expect(cents(1234.56)).toBe(123_456);
    expect(cents(0.07)).toBe(7);
    expect(cents(1149.94)).toBe(114_994);
    expect(cents(8.29)).toBe(829);
  });

  it('accepts currency symbols, commas, and surrounding space', () => {
    expect(cents('$1,500')).toBe(150_000);
    expect(cents('  $1,234.56 ')).toBe(123_456);
    expect(cents('$0')).toBe(0);
    expect(cents('9,999.99')).toBe(999_999);
  });

  it('rejects negatives, including accounting style', () => {
    expect(code('-5')).toBe('negative');
    expect(code('-$5.00')).toBe('negative');
    expect(code('(500)')).toBe('negative');
  });

  it('rejects sub-cent precision distinctly from junk', () => {
    expect(code('1500.005')).toBe('too_precise');
    expect(code('1.234')).toBe('too_precise');
    expect(code('twelve dollars')).toBe('not_money');
    expect(code('N/A')).toBe('not_money');
    expect(code('1500-')).toBe('not_money');
    expect(code(true)).toBe('not_money');
  });

  it('rejects scientific notation and absurd amounts', () => {
    expect(code('1e5')).toBe('too_large');
    expect(code(1e21)).toBe('too_large');
    expect(code('10000.01')).toBe('too_large');
    // Exactly at the cap is allowed.
    expect(cents('10000')).toBe(1_000_000);
  });

  it('rejects malformed comma grouping', () => {
    expect(code('1,50')).toBe('not_money');
    expect(code('12,34,567')).toBe('not_money');
  });
});

describe('formatCents', () => {
  it('drops the decimal on whole dollars', () => {
    expect(formatCents(150_000)).toBe('$1,500');
    expect(formatCents(0)).toBe('$0');
  });

  it('keeps two places otherwise', () => {
    expect(formatCents(123_456)).toBe('$1,234.56');
    expect(formatCents(1)).toBe('$0.01');
    expect(formatCents(75_050)).toBe('$750.50');
  });

  it('round-trips through the parser', () => {
    for (const v of [0, 1, 999, 150_000, 123_456, 1_000_000]) {
      expect(cents(formatCents(v))).toBe(v);
    }
  });
});
