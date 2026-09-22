import { describe, it, expect } from 'vitest';
import {
  NICKNAME_MAX,
  discordNickname,
  groupRoleName,
  sectionNumber,
  sectionRoleName,
} from '@rp2/shared';

/*
 * Role and nickname naming.
 *
 * Pure string work, but it is what 192 students see next to their face in
 * every channel, and what staff use to tell one Bryan from another. The cases
 * below are drawn from the real cohort.
 */

describe('sectionNumber', () => {
  it('reads the trailing number of a section string', () => {
    expect(sectionNumber('QUADRATIC-2')).toBe('2');
    expect(sectionNumber('TOPOLOGY-1')).toBe('1');
    expect(sectionNumber('CGT-10')).toBe('10');
  });

  it('gives up rather than guessing', () => {
    // Free-typed section strings existed before the format was constrained.
    expect(sectionNumber('topology 2 (Tues)')).toBeNull();
    expect(sectionNumber('B')).toBeNull();
    expect(sectionNumber('')).toBeNull();
    expect(sectionNumber(null)).toBeNull();
  });
});

describe('role names', () => {
  it('builds a section role from the course and the section', () => {
    expect(sectionRoleName('quadratic', 'QUADRATIC-2')).toBe('Quadratic-Forms-2');
    expect(sectionRoleName('ggt', 'GGT-1')).toBe('Geometric-Group-Theory-1');
    expect(sectionRoleName('cgt', 'CGT-2')).toBe('Combinatorial-Game-Theory-2');
    expect(sectionRoleName('topology', 'TOPOLOGY-1')).toBe('Topology-1');
  });

  it('builds a group role from the abbreviation', () => {
    expect(groupRoleName('quadratic', 'QUADRATIC-2', '3')).toBe('QF-2-Group-3');
    expect(groupRoleName('ggt', 'GGT-1', '6')).toBe('GGT-1-Group-6');
    // Topology spells its group roles out in full; the others abbreviate.
    // Both come from the same derivation — only the constants differ.
    expect(groupRoleName('topology', 'TOPOLOGY-2', '4')).toBe('Topology-2-Group-4');
  });

  /*
   * Returning null is what stops a malformed offer minting a role called
   * `null-Group-3` for two dozen students.
   */
  it('returns null rather than inventing a name', () => {
    expect(sectionRoleName(null, 'QUADRATIC-2')).toBeNull();
    expect(sectionRoleName('quadratic', 'nonsense')).toBeNull();
    expect(groupRoleName('quadratic', 'QUADRATIC-2', '')).toBeNull();
    expect(groupRoleName('unknown-course', 'X-1', '3')).toBeNull();
  });

  it('covers every course in the catalogue', () => {
    for (const key of ['topology', 'ggt', 'cgt', 'quadratic']) {
      expect(sectionRoleName(key, 'X-1')).not.toBeNull();
      expect(groupRoleName(key, 'X-1', '1')).not.toBeNull();
    }
  });
});

describe('discordNickname', () => {
  it('leads with the preferred name and keeps the legal one', () => {
    expect(discordNickname('Alex', 'Alexander Sheng')).toBe('Alex (Alexander Sheng)');
    expect(discordNickname('Shahd', 'Shahd Luai Omer')).toBe('Shahd (Shahd Luai Omer)');
  });

  /* 37 of 192 students at launch gave no preferred name. */
  it('falls back to the legal name when there is no preferred one', () => {
    expect(discordNickname(null, 'Ann Song')).toBe('Ann Song');
    expect(discordNickname('', 'Ann Song')).toBe('Ann Song');
    expect(discordNickname('   ', 'Ann Song')).toBe('Ann Song');
  });

  /* Several students typed their full name into both fields. */
  it('collapses a preferred name that is just the legal name again', () => {
    expect(discordNickname('Nikolai Morozov', 'Nikolai Morozov')).toBe('Nikolai Morozov');
    expect(discordNickname('nikolai morozov', 'Nikolai Morozov')).toBe('Nikolai Morozov');
  });

  /* 6 of 192 overflow Discord's 32-character cap in the combined form. */
  it('never exceeds Discord’s nickname limit', () => {
    const cases: [string | null, string][] = [
      ['Alexander', 'Alexander Konstantinopoulos-Kavanagh'],
      [null, 'Bartholomew Wolfeschlegelsteinhausenbergerdorff'],
      ['Maximilian-Wolfgang', 'Maximilian-Wolfgang von Habsburg-Lothringen'],
      ['A', 'B'],
    ];
    for (const [preferred, legal] of cases) {
      const nick = discordNickname(preferred, legal);
      expect(nick.length).toBeLessThanOrEqual(NICKNAME_MAX);
      expect(nick.length).toBeGreaterThan(0);
    }
  });

  it('keeps the preferred name intact and trims the parenthetical', () => {
    const nick = discordNickname('Alexander', 'Alexander Konstantinopoulos-Kavanagh');
    expect(nick.startsWith('Alexander (')).toBe(true);
    expect(nick.endsWith('…)')).toBe(true);
    expect(nick.length).toBeLessThanOrEqual(NICKNAME_MAX);
  });

  it('survives a preferred name that fills the field on its own', () => {
    const long = 'Bartholomew-Maximilian-Wolfgang-Xavier';
    const nick = discordNickname(long, 'Someone Else Entirely');
    expect(nick.length).toBeLessThanOrEqual(NICKNAME_MAX);
  });

  it('does not produce an empty nickname from empty input', () => {
    expect(discordNickname(null, null)).toBe('');
    expect(discordNickname('Alex', null)).toBe('Alex');
  });
});
