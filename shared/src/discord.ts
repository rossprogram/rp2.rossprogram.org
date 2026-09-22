/*
 * Discord naming rules.
 *
 * Pure string functions, shared so the bot, the admin preview, and the tests
 * all agree on what a role or a nickname is called. Nothing here talks to
 * Discord.
 */

import { COURSES } from './offers.js';

/** Discord's hard cap on a guild nickname. Exceeding it is a 400. */
export const NICKNAME_MAX = 32;

function course(courseKey: string | null | undefined) {
  return COURSES.find((c) => c.key === courseKey);
}

/**
 * The trailing number of a section string: 'QUADRATIC-2' -> '2'.
 *
 * Returns null rather than guessing. Section strings are admin-typed, and the
 * `section` import column constrains them to COURSE-N — but this module is
 * also run against rows written before that constraint existed.
 */
export function sectionNumber(section: string | null | undefined): string | null {
  if (!section) return null;
  const m = /^[A-Za-z]+-([0-9]+)$/.exec(section.trim());
  return m?.[1] ?? null;
}

/** 'quadratic' + 'QUADRATIC-2' -> 'Quadratic-Forms-2' */
export function sectionRoleName(
  courseKey: string | null | undefined,
  section: string | null | undefined,
): string | null {
  const c = course(courseKey);
  const n = sectionNumber(section);
  if (!c || !n) return null;
  return `${c.roleName}-${n}`;
}

/** 'quadratic' + 'QUADRATIC-2' + '3' -> 'QF-2-Group-3' */
export function groupRoleName(
  courseKey: string | null | undefined,
  section: string | null | undefined,
  cohort: string | null | undefined,
): string | null {
  const c = course(courseKey);
  const n = sectionNumber(section);
  const g = cohort?.trim();
  if (!c || !n || !g) return null;
  return `${c.abbrev}-${n}-Group-${g}`;
}

/** The `discord_role.key` for a section — stable, and independent of display. */
export function sectionRoleKey(section: string): string {
  return section.trim().toUpperCase();
}

/** The `discord_role.key` for a group within a section. */
export function groupRoleKey(section: string, cohort: string): string {
  return `${section.trim().toUpperCase()}/${cohort.trim()}`;
}

/**
 * The guild nickname for a student: "Preferred (Legal Name)".
 *
 * Staff need to match a Discord member to a real person at a glance, so the
 * legal name is always present. The preferred name leads because that is what
 * people want to be called.
 *
 * Collapses to the legal name alone when the parenthetical would be noise —
 * no preferred name (37 of 192 students at launch), or a preferred name that
 * is just the legal name again (e.g. "Nikolai Morozov" / "Nikolai Morozov").
 *
 * Truncation keeps the preferred name intact and trims the parenthetical,
 * because losing "who is this" is better than losing "what do I call them".
 * If even the bare name overflows, it is cut with an ellipsis. 6 of 192
 * students overflow at launch.
 */
export function discordNickname(
  preferred: string | null | undefined,
  legal: string | null | undefined,
): string {
  const p = (preferred ?? '').trim();
  const l = (legal ?? '').trim();

  if (!l) return truncate(p, NICKNAME_MAX);
  if (!p || p.toLowerCase() === l.toLowerCase()) return truncate(l, NICKNAME_MAX);

  const full = `${p} (${l})`;
  if (full.length <= NICKNAME_MAX) return full;

  // Trim the legal name inside the parentheses, keeping the preferred name
  // and the closing bracket. Needs room for ' (' + at least one char + '…)'.
  const room = NICKNAME_MAX - p.length - ' ('.length - '…)'.length;
  if (room >= 1) return `${p} (${l.slice(0, room)}…)`;

  // The preferred name alone already fills the field.
  return truncate(p, NICKNAME_MAX);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
