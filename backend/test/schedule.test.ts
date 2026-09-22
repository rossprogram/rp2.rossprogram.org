import { describe, it, expect } from 'vitest';
import {
  PROGRAM_TIMEZONE,
  TERM_START,
  addDays,
  formatScheduleString,
  instantToWallClock,
  isValidTimeZone,
  occurrencesFor,
  parseScheduleString,
  resolveSectionTime,
  wallClockToInstant,
  weekdayOf,
} from '@rp2/shared';

/*
 * Section times and the dates they fall on.
 *
 * Every case here is drawn from the real cohort. The stakes: an hour of drift
 * does not throw, it just quietly stops matching students to sessions, and by
 * the time anyone notices, the attendance for those weeks is gone.
 */

describe('wall clock to instant', () => {
  it('converts a New York morning in daylight time', () => {
    // 2026-10-18 is EDT (UTC-4). 09:00 local = 13:00 UTC.
    const t = wallClockToInstant('2026-10-18', 9 * 60, 'America/New_York');
    expect(new Date(t * 1000).toISOString()).toBe('2026-10-18T13:00:00.000Z');
  });

  /*
   * The whole reason meeting times are stored as wall clock. US DST ends
   * 2026-11-01; the same 09:00 session is an hour later in UTC afterwards.
   */
  it('moves with daylight saving rather than through it', () => {
    const before = wallClockToInstant('2026-10-18', 9 * 60, 'America/New_York');
    const after = wallClockToInstant('2026-11-08', 9 * 60, 'America/New_York');
    expect(new Date(before * 1000).toISOString()).toBe('2026-10-18T13:00:00.000Z');
    expect(new Date(after * 1000).toISOString()).toBe('2026-11-08T14:00:00.000Z');

    // Same wall clock, different UTC offset — 21 days apart plus one hour.
    expect(after - before).toBe(21 * 24 * 3600 + 3600);
  });

  it('round-trips through instantToWallClock', () => {
    for (const date of ['2026-09-27', '2026-10-25', '2026-11-01', '2026-12-12']) {
      for (const minute of [0, 9 * 60, 13 * 60 + 30, 23 * 60 + 59]) {
        const t = wallClockToInstant(date, minute, PROGRAM_TIMEZONE);
        const back = instantToWallClock(t, PROGRAM_TIMEZONE);
        expect(`${back.date} ${back.minuteOfDay}`).toBe(`${date} ${minute}`);
      }
    }
  });

  it('handles zones with a half-hour offset', () => {
    // Asia/Calcutta is UTC+5:30 year round. 18:30 local = 13:00 UTC.
    const t = wallClockToInstant('2026-10-18', 18 * 60 + 30, 'Asia/Calcutta');
    expect(new Date(t * 1000).toISOString()).toBe('2026-10-18T13:00:00.000Z');
  });
});

describe('parsing what the admin typed', () => {
  it('reads the stored format', () => {
    expect(parseScheduleString('Sun 09:00')).toEqual({ weekday: 0, minuteOfDay: 540 });
    expect(parseScheduleString('Fri 19:30')).toEqual({ weekday: 5, minuteOfDay: 1170 });
    expect(parseScheduleString('  Sat 07:30  ')).toEqual({ weekday: 6, minuteOfDay: 450 });
  });

  it('refuses anything it does not understand', () => {
    for (const bad of ['Sunday 09:00', 'Sun 9am', '09:00', 'Sun 25:00', 'Sun 09:61', '', null]) {
      expect(parseScheduleString(bad)).toBeNull();
    }
  });

  it('formats back to the stored form', () => {
    expect(formatScheduleString(0, 540)).toBe('Sun 09:00');
    expect(formatScheduleString(6, 450)).toBe('Sat 07:30');
  });
});

describe('reconstructing a section time from student-local strings', () => {
  /*
   * TOPOLOGY-2, verbatim from production: eight different strings, one
   * meeting, Sunday 09:00 New York.
   */
  it('reconciles the real TOPOLOGY-2 spread', () => {
    const result = resolveSectionTime([
      { ref: 'a', local: 'Sun 09:00', timeZone: 'America/New_York' },
      { ref: 'b', local: 'Sun 08:00', timeZone: 'America/Chicago' },
      { ref: 'c', local: 'Sun 09:00', timeZone: 'America/Detroit' },
      { ref: 'd', local: 'Sun 14:00', timeZone: 'Europe/London' },
      { ref: 'e', local: 'Sun 15:00', timeZone: 'Europe/Berlin' },
      { ref: 'f', local: 'Sun 17:00', timeZone: 'Asia/Dubai' },
      { ref: 'g', local: 'Sun 18:30', timeZone: 'Asia/Calcutta' },
      { ref: 'h', local: 'Sun 19:30', timeZone: 'Asia/Rangoon' },
      { ref: 'i', local: 'Sun 21:00', timeZone: 'Asia/Hong_Kong' },
      { ref: 'j', local: 'Sun 21:00', timeZone: 'Asia/Singapore' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatScheduleString(result.weekday, result.minuteOfDay)).toBe('Sun 09:00');
    expect(result.agreed).toBe(10);
  });

  /*
   * TOPOLOGY-1 crosses the date line: 'Fri 19:30' in New York is 'Sat 07:30'
   * in Singapore. Matching on weekday alone would call these two meetings.
   */
  it('reconciles students whose local weekday differs', () => {
    const result = resolveSectionTime([
      { ref: 'ny', local: 'Fri 19:30', timeZone: 'America/New_York' },
      { ref: 'sg', local: 'Sat 07:30', timeZone: 'Asia/Singapore' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatScheduleString(result.weekday, result.minuteOfDay)).toBe('Fri 19:30');
    expect(result.agreed).toBe(2);
  });

  /*
   * A genuine scheduling error must surface, not be averaged away. Finding
   * these before term is the point of running the backfill at all.
   */
  it('reports disagreement rather than taking the majority', () => {
    const result = resolveSectionTime([
      { ref: 'a', local: 'Sun 09:00', timeZone: 'America/New_York' },
      { ref: 'b', local: 'Sun 09:00', timeZone: 'America/New_York' },
      { ref: 'c', local: 'Sun 10:00', timeZone: 'America/New_York' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('disagreement');
    expect(result.detail.join(' ')).toContain('Sun 09:00');
    expect(result.detail.join(' ')).toContain('Sun 10:00');
  });

  /* One enrolled student really does have 'Asia/SingaporeSingapore' on file. */
  it('names an invalid timezone instead of throwing', () => {
    const result = resolveSectionTime([
      { ref: 'ok', local: 'Sun 09:00', timeZone: 'America/New_York' },
      { ref: 'broken', local: 'Sun 21:00', timeZone: 'Asia/SingaporeSingapore' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The good row still resolves the section; the bad one is not silently counted.
    expect(result.agreed).toBe(1);
  });

  /* One enrolled student's zone is stored as 'America/Vancouver ' — a
   * whitespace bug on our side, not a bad answer on theirs. */
  it('tolerates a timezone with stray whitespace', () => {
    const result = resolveSectionTime([
      { ref: 'a', local: 'Sun 12:00', timeZone: 'America/New_York' },
      { ref: 'b', local: 'Sun 09:00', timeZone: 'America/Vancouver ' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.agreed).toBe(2);
    expect(result.skipped).toEqual([]);
  });

  it('names unusable rows even when the section still resolves', () => {
    const result = resolveSectionTime([
      { ref: 'good', local: 'Sun 09:00', timeZone: 'America/New_York' },
      { ref: 'bad-zone', local: 'Sun 21:00', timeZone: 'Asia/SingaporeSingapore' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A bare "1 of 2 agree" is a mystery; the skipped list is a task.
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain('bad-zone');
  });

  it('reports when nothing is usable at all', () => {
    const result = resolveSectionTime([{ ref: 'x', local: 'whenever', timeZone: 'Mars/Olympus' }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_usable_rows');
    expect(result.detail).toHaveLength(1);
  });

  it('knows a bad timezone from a good one', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Asia/SingaporeSingapore')).toBe(false);
  });
});

describe('occurrences', () => {
  /*
   * The program promised ten of each. Sunday sessions: eleven Sundays fall in
   * the term, and the one inside the Thanksgiving break is dropped.
   */
  it('produces ten Sunday problem sessions, skipping the break', () => {
    const occ = occurrencesFor(0, 9 * 60);
    expect(occ).toHaveLength(10);
    expect(occ[0]!.date).toBe('2026-09-27');
    expect(occ.map((o) => o.date)).not.toContain('2026-11-29');
    expect(occ.at(-1)!.date).toBe('2026-12-06');
  });

  it('produces ten Saturday office hours, skipping the break', () => {
    const occ = occurrencesFor(6, 9 * 60);
    expect(occ).toHaveLength(10);
    expect(occ[0]!.date).toBe('2026-10-03');
    expect(occ.map((o) => o.date)).not.toContain('2026-11-28');
    expect(occ.at(-1)!.date).toBe('2026-12-12');
  });

  it('every occurrence is on the requested weekday', () => {
    for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
      for (const o of occurrencesFor(weekday, 12 * 60)) {
        expect(weekdayOf(o.date)).toBe(weekday);
      }
    }
  });

  /*
   * The DST assertion, stated as a property: the same wall-clock session is a
   * different UTC instant either side of November 1.
   */
  it('shifts UTC across the daylight-saving boundary', () => {
    const occ = occurrencesFor(0, 9 * 60);
    const october = occ.find((o) => o.date === '2026-10-18')!;
    const november = occ.find((o) => o.date === '2026-11-08')!;

    const utcHour = (t: number) => new Date(t * 1000).getUTCHours();
    expect(utcHour(october.startsAt)).toBe(13);
    expect(utcHour(november.startsAt)).toBe(14);
  });

  it('starts every occurrence at the right local time', () => {
    for (const o of occurrencesFor(0, 9 * 60)) {
      const wall = instantToWallClock(o.startsAt, PROGRAM_TIMEZONE);
      expect(wall.minuteOfDay).toBe(9 * 60);
      expect(wall.date).toBe(o.date);
    }
  });
});

describe('date helpers', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-09-27', 7)).toBe('2026-10-04');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('knows the term anchors', () => {
    expect(weekdayOf(TERM_START)).toBe(0); // Sunday
    expect(weekdayOf('2026-12-12')).toBe(6); // Saturday
  });
});
