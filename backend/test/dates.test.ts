import { describe, it, expect } from 'vitest';
import { parseDeadline, todayInProgramTz, isPastDeadline } from '@rp2/shared';

function date(raw: unknown): string | null {
  const r = parseDeadline(raw);
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.date;
}

function code(raw: unknown): string {
  const r = parseDeadline(raw);
  if (r.ok) throw new Error(`expected failure, got ${r.date}`);
  return r.code;
}

describe('parseDeadline', () => {
  it('treats blank and nullish as no deadline', () => {
    expect(date('')).toBeNull();
    expect(date('   ')).toBeNull();
    expect(date(null)).toBeNull();
    expect(date(undefined)).toBeNull();
  });

  it('accepts ISO dates unchanged', () => {
    expect(date('2026-09-19')).toBe('2026-09-19');
    expect(date(' 2026-12-12 ')).toBe('2026-12-12');
  });

  // xlsx with cellDates:true builds date cells at UTC midnight. Reading local
  // parts here would shift the day for anyone west of Greenwich.
  it('reads a Date via its UTC parts', () => {
    expect(date(new Date(Date.UTC(2026, 8, 19)))).toBe('2026-09-19');
    expect(date(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01-01');
    expect(code(new Date('nonsense'))).toBe('unparseable');
  });

  // What Excel writes the moment someone opens and re-saves a CSV.
  it('accepts M/D/YYYY', () => {
    expect(date('9/19/2026')).toBe('2026-09-19');
    expect(date('09/19/2026')).toBe('2026-09-19');
    expect(date('12/1/2026')).toBe('2026-12-01');
  });

  it('rejects two-digit years rather than guessing the century', () => {
    expect(code('9/19/26')).toBe('two_digit_year');
    expect(code('10/15/26')).toBe('two_digit_year');
  });

  it('accepts Excel serial numbers, as numbers or text', () => {
    // 46284 = 2026-09-19 under the 1899-12-30 epoch.
    expect(date(46284)).toBe('2026-09-19');
    expect(date('46284')).toBe('2026-09-19');
  });

  it('rejects impossible calendar dates', () => {
    expect(code('2026-02-30')).toBe('unparseable');
    expect(code('2026-13-01')).toBe('unparseable');
    expect(code('2/30/2026')).toBe('unparseable');
  });

  it('rejects junk', () => {
    expect(code('next Friday')).toBe('unparseable');
    expect(code('19-09-2026')).toBe('unparseable');
  });
});

describe('isPastDeadline', () => {
  it('never expires a null deadline', () => {
    expect(isPastDeadline(null)).toBe(false);
  });

  it('compares calendar days, not instants', () => {
    // 03:00 UTC on Sep 20 is still Sep 19 in New York, so a Sep 19 deadline
    // has not passed yet for a family anywhere in the program's timezone.
    const justAfterUtcMidnight = new Date('2026-09-20T03:00:00Z');
    expect(isPastDeadline('2026-09-19', justAfterUtcMidnight)).toBe(false);
    expect(isPastDeadline('2026-09-18', justAfterUtcMidnight)).toBe(true);
  });

  it('is inclusive of the deadline day itself', () => {
    const noonEt = new Date('2026-09-19T16:00:00Z');
    expect(isPastDeadline('2026-09-19', noonEt)).toBe(false);
    expect(isPastDeadline('2026-09-20', noonEt)).toBe(false);
  });
});

describe('todayInProgramTz', () => {
  it('formats as ISO', () => {
    expect(todayInProgramTz(new Date('2026-09-19T16:00:00Z'))).toBe('2026-09-19');
    expect(todayInProgramTz()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
