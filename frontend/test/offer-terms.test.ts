/*
 * money() in OfferTerms is a client-side reimplementation of formatCents on
 * the server. Two implementations of the same money formatting is a drift
 * risk, and a drift here misstates what a family owes — so pin them together.
 */
import { describe, it, expect } from 'vitest';
import { formatCents, parseMoneyToCents } from '@rp2/shared';
import { money, formatDeadline } from '../src/features/offer/OfferTerms';

describe('money', () => {
  it('agrees with the server formatter on every amount that matters', () => {
    const amounts = [
      0, 1, 50, 99, 100, 999, 1_000, 7_500, 75_000, 75_050,
      100_000, 123_456, 150_000, 999_999, 1_000_000,
    ];
    for (const cents of amounts) {
      expect(money(cents), `${cents} cents`).toBe(formatCents(cents));
    }
  });

  it('drops the decimal on whole dollars and keeps it otherwise', () => {
    expect(money(150_000)).toBe('$1,500');
    expect(money(75_050)).toBe('$750.50');
    expect(money(0)).toBe('$0');
    expect(money(1)).toBe('$0.01');
  });

  it('round-trips back through the importer parser', () => {
    for (const cents of [0, 1, 75_000, 123_456, 150_000]) {
      const parsed = parseMoneyToCents(money(cents));
      expect(parsed.ok && parsed.cents).toBe(cents);
    }
  });
});

describe('formatDeadline', () => {
  // The date is a calendar day, not an instant. Parsing '2026-09-19' with
  // new Date() would shift it a day west of Greenwich.
  it('does not shift the day for a viewer in another timezone', () => {
    const shown = formatDeadline('2026-09-19');
    expect(shown).toContain('19');
    expect(shown).toContain('2026');
    expect(shown).not.toContain('18');
  });

  it('passes null through, since a deadline is optional', () => {
    expect(formatDeadline(null)).toBeNull();
  });
});
