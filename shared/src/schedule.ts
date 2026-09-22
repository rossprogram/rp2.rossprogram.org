/*
 * Sections, meeting times, and the dates they actually fall on.
 *
 * The one thing to understand before touching this file: `offer.problem_session`
 * is stored in each STUDENT's local time, not the program's. One section has
 * eight different strings on file —
 *
 *   'Sun 09:00' America/New_York   'Sun 14:00' Europe/London
 *   'Sun 08:00' America/Chicago    'Sun 21:00' Asia/Singapore
 *
 * — and they are all the same meeting, Sunday 13:00 UTC. Some of them are not
 * even on the same weekday: 'Fri 19:30' in New York is 'Sat 07:30' in
 * Singapore. So a section's true time cannot be read off any single offer
 * row; it has to be reconstructed, and the reconstruction is what
 * resolveSectionTime() below does.
 *
 * Meeting times are then stored as WALL CLOCK in PROGRAM_TIMEZONE — a weekday
 * and a minute-of-day — and never as a UTC offset. US daylight saving ends
 * Nov 1 and the EU's ends Oct 25, both mid-term, and the offer notes promise
 * families that "US daylight-saving changes do not affect your times". A
 * section pinned to a UTC instant would be an hour wrong for every session
 * after Nov 1, and would express itself as attendance quietly failing to
 * match rather than as an error.
 */

import { PROGRAM_TIMEZONE } from './offers.js';

/* ==================== the term ==================== */

/** The pilot term. The first term key the system has ever had. */
export const TERM_KEY = 'fall-2026';
export const TERM_START = '2026-09-27'; // Sunday
export const TERM_END = '2026-12-12'; // Saturday

/**
 * No sessions this week. Inclusive, and expressed as plain dates because the
 * break is a run of days, not an interval of instants.
 */
export const TERM_BREAKS: readonly { from: string; to: string; reason: string }[] = [
  { from: '2026-11-23', to: '2026-11-29', reason: 'US Thanksgiving' },
];

/** Both kinds of weekly meeting. Separately scheduled, so separately modelled. */
export const SESSION_KINDS = ['problem_session', 'office_hours'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const WEEK_SECONDS = 7 * 24 * 60 * 60;

/* ==================== timezone arithmetic ==================== */

/**
 * The offset of `timeZone` at a given instant, in milliseconds.
 *
 * Intl is the only timezone database Node ships, so this reads the wall clock
 * that zone shows at the instant and subtracts. Ugly, dependency-free, and
 * correct across DST boundaries.
 */
function offsetMsAt(instantMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(instantMs))) parts[p.type] = p.value;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl renders midnight as hour 24 in some locales/zones.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - instantMs;
}

/** True when the string is a timezone Intl will actually accept. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant at which `timeZone` shows the given wall-clock date and time.
 *
 * Two passes: guess using the offset at the naive instant, then correct using
 * the offset at the guess. One correction is enough for every real zone —
 * offsets only ever move by an hour or two, so the second lookup lands on the
 * right side of any transition.
 *
 * Returns unix SECONDS, matching the rest of the codebase.
 */
export function wallClockToInstant(
  date: string, // 'YYYY-MM-DD'
  minuteOfDay: number,
  timeZone: string,
): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  let guess = naive - offsetMsAt(naive, timeZone);
  guess = naive - offsetMsAt(guess, timeZone);
  return Math.floor(guess / 1000);
}

/** The wall clock `timeZone` shows at an instant, as weekday + minute-of-day. */
export function instantToWallClock(
  instantSeconds: number,
  timeZone: string,
): { weekday: number; minuteOfDay: number; date: string } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(instantSeconds * 1000))) parts[p.type] = p.value;
  const weekday = WEEKDAY_NAMES.indexOf(parts.weekday as (typeof WEEKDAY_NAMES)[number]);
  return {
    weekday,
    minuteOfDay: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/* ==================== parsing what the admin typed ==================== */

const SCHEDULE_RE = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+([0-9]{1,2}):([0-9]{2})$/;

/** 'Sun 09:00' -> { weekday: 0, minuteOfDay: 540 }. Null on anything else. */
export function parseScheduleString(
  raw: string | null | undefined,
): { weekday: number; minuteOfDay: number } | null {
  if (!raw) return null;
  const m = SCHEDULE_RE.exec(raw.trim());
  if (!m) return null;
  const weekday = WEEKDAY_NAMES.indexOf(m[1] as (typeof WEEKDAY_NAMES)[number]);
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) return null;
  return { weekday, minuteOfDay: hour * 60 + minute };
}

/** { weekday: 0, minuteOfDay: 540 } -> 'Sun 09:00'. */
export function formatScheduleString(weekday: number, minuteOfDay: number): string {
  const h = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const mi = String(minuteOfDay % 60).padStart(2, '0');
  return `${WEEKDAY_NAMES[weekday]} ${h}:${mi}`;
}

/* ==================== reconstructing a section's true time ==================== */

/**
 * Where in the week an instant falls, in seconds since Sunday 00:00 UTC.
 *
 * Weekly recurrence means only this phase matters, which is what lets two
 * students on opposite sides of the date line be recognised as attending the
 * same meeting.
 */
function weekPhase(instantSeconds: number): number {
  // 1970-01-04 was a Sunday.
  const epochSunday = Date.UTC(1970, 0, 4) / 1000;
  return (((instantSeconds - epochSunday) % WEEK_SECONDS) + WEEK_SECONDS) % WEEK_SECONDS;
}

export type StudentSchedule = {
  /** Whatever identifies the student in the caller's world, for error messages. */
  ref: string;
  /** The string as stored on the offer, in the student's own local time. */
  local: string;
  timeZone: string;
};

export type SectionTimeResult =
  | {
      ok: true;
      weekday: number;
      minuteOfDay: number;
      /** How many students agreed. */
      agreed: number;
      /**
       * Students whose row could not be used at all — an unparseable schedule
       * or a timezone Intl rejects. Reported even on success: "23 of 24 agree"
       * is a mystery, "this student's timezone is invalid" is a task.
       */
      skipped: string[];
    }
  | {
      ok: false;
      reason: 'no_usable_rows' | 'disagreement';
      /** One line per student we could not reconcile, for a human to read. */
      detail: string[];
    };

/**
 * Reconstruct a section's meeting time in PROGRAM_TIMEZONE from the local
 * times its students were each told.
 *
 * Every student's (local weekday+time, their timezone) should name the same
 * instant. The function insists on that rather than trusting the majority:
 * a section where students disagree has a real scheduling error in it, and
 * finding that before term is the entire point of running this.
 */
export function resolveSectionTime(
  students: readonly StudentSchedule[],
  /** Any date inside the term; used only to anchor the week. */
  referenceDate: string = TERM_START,
): SectionTimeResult {
  const detail: string[] = [];
  const phases = new Map<number, number>(); // phase -> count
  let firstInstant: number | null = null;

  for (const s of students) {
    const parsed = parseScheduleString(s.local);
    if (!parsed) {
      detail.push(`${s.ref}: cannot parse schedule "${s.local}"`);
      continue;
    }
    // Trim before validating: one student's zone is stored as
    // 'America/Vancouver ' with a trailing space, which is a whitespace bug
    // on our side rather than a bad answer on theirs.
    const timeZone = s.timeZone.trim();
    if (!isValidTimeZone(timeZone)) {
      detail.push(`${s.ref}: "${s.timeZone}" is not a timezone Intl recognises`);
      continue;
    }

    // Find the date in the reference week on which this student's local
    // weekday falls, then take the instant of their local time on that date.
    const instant = instantForLocalWeekday(referenceDate, parsed.weekday, parsed.minuteOfDay, timeZone);
    const phase = weekPhase(instant);
    phases.set(phase, (phases.get(phase) ?? 0) + 1);
    if (firstInstant === null) firstInstant = instant;
  }

  if (phases.size === 0) return { ok: false, reason: 'no_usable_rows', detail };

  if (phases.size > 1) {
    // Report every distinct time so a human can see which students are odd.
    for (const [phase, count] of [...phases].sort((a, b) => b[1] - a[1])) {
      const asProgram = instantToWallClock(epochSundayPlus(phase), PROGRAM_TIMEZONE);
      detail.push(
        `${count} student(s) imply ${formatScheduleString(asProgram.weekday, asProgram.minuteOfDay)} ${PROGRAM_TIMEZONE}`,
      );
    }
    return { ok: false, reason: 'disagreement', detail };
  }

  const only = [...phases][0]!;
  const [phase, agreed] = only;
  const wall = instantToWallClock(epochSundayPlus(phase), PROGRAM_TIMEZONE);
  return { ok: true, weekday: wall.weekday, minuteOfDay: wall.minuteOfDay, agreed, skipped: detail };
}

/** Turn a week phase back into a concrete instant during the term. */
function epochSundayPlus(phase: number): number {
  const termStartSunday = wallClockToInstant(TERM_START, 0, 'UTC');
  return termStartSunday + phase;
}

/**
 * The instant of `minuteOfDay` on whichever day of the reference week reads as
 * `weekday` in `timeZone`.
 *
 * Searching a window rather than computing an offset, because the student's
 * weekday and the program's can differ — 'Fri 19:30' in New York and
 * 'Sat 07:30' in Singapore are the same moment.
 */
function instantForLocalWeekday(
  referenceDate: string,
  weekday: number,
  minuteOfDay: number,
  timeZone: string,
): number {
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(referenceDate, offset);
    const instant = wallClockToInstant(date, minuteOfDay, timeZone);
    if (instantToWallClock(instant, timeZone).weekday === weekday) return instant;
  }
  // Unreachable for a real zone: seven consecutive days cover every weekday.
  return wallClockToInstant(referenceDate, minuteOfDay, timeZone);
}

/* ==================== occurrences ==================== */

/** 'YYYY-MM-DD' plus n days, in plain calendar arithmetic. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Weekday of a plain date, 0 = Sunday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isBreakDate(date: string): boolean {
  return TERM_BREAKS.some((b) => date >= b.from && date <= b.to);
}

export type Occurrence = { date: string; startsAt: number };

/**
 * Every date this section meets, and the instant each one starts.
 *
 * `startsAt` is recomputed per date from the wall clock, so the November
 * sessions land an hour later in UTC than the October ones — which is exactly
 * what the families were promised.
 */
export function occurrencesFor(
  weekday: number,
  minuteOfDay: number,
  opts: { from?: string; to?: string } = {},
): Occurrence[] {
  const from = opts.from ?? TERM_START;
  const to = opts.to ?? TERM_END;
  const out: Occurrence[] = [];

  let date = from;
  // Walk to the first matching weekday.
  while (date <= to && weekdayOf(date) !== weekday) date = addDays(date, 1);

  for (; date <= to; date = addDays(date, 7)) {
    if (isBreakDate(date)) continue;
    out.push({ date, startsAt: wallClockToInstant(date, minuteOfDay, PROGRAM_TIMEZONE) });
  }
  return out;
}

/* ==================== normalising what people type ==================== */

/**
 * Every IANA zone this runtime knows, or an empty list if it cannot say.
 *
 * `Intl.supportedValuesOf` is ES2022 and present on Node 20 and every browser
 * we care about, but it is typed loosely enough to be worth guarding.
 */
function knownZones(): readonly string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    if (typeof fn === 'function') {
      const v = fn('timeZone');
      if (Array.isArray(v) && v.length > 0) return v;
    }
  } catch {
    /* fall through to the empty list */
  }
  return [];
}

let zoneCache: readonly string[] | null = null;
function zones(): readonly string[] {
  zoneCache ??= knownZones();
  return zoneCache;
}

/**
 * Turn what somebody typed into a real IANA zone, or null.
 *
 * The timezone question is a free-text box with a datalist of suggestions, so
 * the stored answers include 'America/Los Angeles', 'Shanghai',
 * 'America/Vancouver ' and 'Asia/SingaporeSingapore' — that last one being
 * what a datalist autocomplete does when it appends to what was already
 * typed. Twelve of 705 answers were unusable.
 *
 * Only unambiguous repairs are made:
 *   - whitespace and casing
 *   - a space where the zone has an underscore
 *   - a suggestion appended to a complete zone ('Asia/SingaporeSingapore')
 *   - a bare city that exactly one zone ends with ('Shanghai')
 *
 * Anything else returns null and is left for a human. 'Asia/Beijing' is the
 * case worth keeping in mind: the right answer is Asia/Shanghai, but that is
 * a fact about China's timezone policy rather than a string operation, and
 * guessing it here would set a precedent for guessing worse things.
 */
export function normalizeTimeZone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const all = zones();
  // Without a zone list all we can do is trust Intl's own validation.
  if (all.length === 0) return isValidTimeZone(trimmed) ? trimmed : null;

  const exact = all.find((z) => z === trimmed);
  if (exact) return exact;

  const spaced = trimmed.replace(/\s+/g, '_');
  const lower = spaced.toLowerCase();

  const caseless = all.find((z) => z.toLowerCase() === lower);
  if (caseless) return caseless;

  // A complete zone with something appended to it.
  const prefixed = all
    .filter((z) => lower.startsWith(z.toLowerCase()) && lower.length > z.length)
    .sort((a, b) => b.length - a.length)[0];
  if (prefixed) return prefixed;

  // A bare city, accepted only when exactly one zone ends with it — so
  // 'Shanghai' resolves and anything ambiguous does not.
  const tail = lower.split('/').pop() ?? '';
  const byTail = all.filter((z) => (z.toLowerCase().split('/').pop() ?? '') === tail);
  if (byTail.length === 1) return byTail[0]!;

  return null;
}
