import { describe, it, expect } from 'vitest';
import {
  countryFlag,
  countryFromLocation,
  countryName,
  countryRoleName,
  resolveCountry,
} from '@rp2/shared';

/*
 * Reading a country out of "City, state / province, country".
 *
 * Every location string below is one an applicant actually typed. The
 * question was free text, so the parser's job is to be right on these and to
 * say "don't know" rather than guess on the rest.
 */

describe('country role names', () => {
  it('is a flag and the name people use', () => {
    expect(countryRoleName('CN')).toBe('🇨🇳 China');
    expect(countryRoleName('IN')).toBe('🇮🇳 India');
    expect(countryRoleName('US')).toBe('🇺🇸 United States');
    expect(countryRoleName('GB')).toBe('🇬🇧 United Kingdom');
    expect(countryRoleName('KR')).toBe('🇰🇷 South Korea');
  });

  it('pins the names ICU renders awkwardly', () => {
    expect(countryName('HK')).toBe('Hong Kong');
    expect(countryName('MO')).toBe('Macau');
    expect(countryName('MM')).toBe('Myanmar');
    expect(countryName('BA')).toBe('Bosnia and Herzegovina');
  });

  it('builds the flag from regional indicators', () => {
    expect(countryFlag('de')).toBe('🇩🇪');
  });

  it('is not a country for groupings or retired codes', () => {
    expect(countryName('EU')).toBeNull();
    expect(countryName('ZZ')).toBeNull();
    expect(countryName('DD')).toBeNull();
    expect(countryName('USA')).toBeNull();
  });
});

describe('countryFromLocation', () => {
  const cases: [string, string | null][] = [
    ['Shanghai/China', 'CN'],
    ['Shenzhen，Guangdong，China', 'CN'],
    ['Wuxi', 'CN'],
    ["Xi'an", 'CN'],
    ['Mumbai/India', 'IN'],
    ['NJ / USA', 'US'],
    ['New Jersey', 'US'],
    ['CA', 'US'],
    ['the United States', 'US'],
    ['United States.', 'US'],
    ['U.S.', 'US'],
    ['Vancouver/BC Canada', 'CA'],
    ['Toronto, ON, CANADA', 'CA'],
    ['seoul / Korea', 'KR'],
    ['Istanbul / Turkiye', 'TR'],
    ['Sharjah/United Arab Emirates', 'AE'],
    ['Wales', 'GB'],
    ['Haywards Heath / West Sussex / United Kingdom', 'GB'],
    ['Bosnia and Herzohovina', 'BA'],
    ['São Paulo / Brazil', 'BR'],
    ['Sudan al diean east darfur state', 'SD'],
    ['Merzkirchen, Rheinland-Palatinate, Germany', 'DE'],
    ['Hong Kong', 'HK'],
    ['Hong Kong, China', 'HK'],
    ['Macau', 'MO'],
  ];
  it.each(cases)('%s -> %s', (location, code) => {
    expect(countryFromLocation(location)).toBe(code);
  });

  it('does not read a country out of a longer name that contains it', () => {
    expect(countryFromLocation('Albuquerque, New Mexico')).toBe('US');
    expect(countryFromLocation('Jersey City, NJ')).toBe('US');
    expect(countryFromLocation('Juba, South Sudan')).toBe('SS');
    expect(countryFromLocation('Sydney, New South Wales')).toBe('AU');
  });

  it('trusts a postal code only as a whole segment', () => {
    expect(countryFromLocation('Province: Faysal')).toBeNull();
  });

  it('says nothing for a city it does not know', () => {
    expect(countryFromLocation('Redlands')).toBeNull();
    expect(countryFromLocation('Exeter')).toBeNull();
    expect(countryFromLocation('')).toBeNull();
    expect(countryFromLocation(null)).toBeNull();
  });
});

describe('resolveCountry', () => {
  it('prefers what they wrote over their time zone', () => {
    // A mainland student who chose Hong Kong's zone.
    expect(resolveCountry('Wuxi', 'Asia/Hong_Kong')).toEqual({
      code: 'CN',
      source: 'location',
      conflict: 'HK',
    });
  });

  it('falls back to the time zone when the text names nowhere', () => {
    expect(resolveCountry('Exeter', 'America/New_York')).toEqual({
      code: 'US',
      source: 'timezone',
      conflict: null,
    });
    expect(resolveCountry('London', 'Europe/London')?.code).toBe('GB');
  });

  it('tolerates the stray whitespace in stored zones', () => {
    expect(resolveCountry('', 'America/Vancouver ')?.code).toBe('CA');
  });

  it('reads Georgia as the state when the time zone is American', () => {
    expect(resolveCountry('Atlanta, Georgia', 'America/New_York')?.code).toBe('US');
    expect(resolveCountry('Tbilisi, Georgia', 'Asia/Tbilisi')?.code).toBe('GE');
  });

  it('gives up when neither says anything', () => {
    expect(resolveCountry('Province: Faysal', 'Asia/SingaporeSingapore')).toBeNull();
  });
});
