/*
 * Countries: names, flags, and reading one out of what an applicant typed.
 *
 * The application never asked for a country as a structured field — it asked
 * for "City, state / province, country" as free text, and got "Shanghai/China",
 * "NJ / USA", "Wuxi", "seoul / Korea" and "Province: Faysal". So a country is
 * something we INFER, and everything here is written to say "don't know"
 * rather than guess. The /role command lets a student pick their own country
 * anyway; inference only chooses the default and which roles to create.
 *
 * Pure functions, shared so the bot, the role-creation script and the tests
 * agree on what a country role is called. Nothing here talks to Discord.
 */

/* ==================== names and flags ==================== */

/**
 * Names that differ from what ICU calls them.
 *
 * ICU's English names drift between Node releases ("Turkey" became "Türkiye")
 * and some read like diplomatic footnotes ("Hong Kong SAR China"). A role name
 * is something students see next to each other's faces, so pin the ones
 * we care about to what people actually say.
 */
const NAME_OVERRIDES: Record<string, string> = {
  BA: 'Bosnia and Herzegovina',
  CZ: 'Czech Republic',
  HK: 'Hong Kong',
  MM: 'Myanmar',
  MO: 'Macau',
  TR: 'Turkey',
};

/**
 * Two-letter region codes ICU knows that are not countries anyone lives in —
 * groupings, the unknown region, and private-use codes — plus the retired
 * codes ICU still names. Those last would otherwise make "Germany" resolve
 * to DD, the old East German code, and fly its flag.
 */
const NOT_COUNTRIES = new Set([
  'AC', 'CP', 'DG', 'EA', 'EU', 'EZ', 'IC', 'QO', 'TA', 'UN', 'ZZ',
  'XA', 'XB',
  'AN', 'BU', 'CS', 'DD', 'DY', 'FX', 'HV', 'NH', 'RH', 'SU', 'TP', 'UK',
  'VD', 'YD', 'YU', 'ZR',
]);

let regionNames: Intl.DisplayNames | null = null;

function icuName(code: string): string | null {
  regionNames ??= new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  try {
    return regionNames.of(code) ?? null;
  } catch {
    return null;
  }
}

/** 'CN' -> 'China'. Null for anything that is not a country code. */
export function countryName(code: string): string | null {
  const c = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || NOT_COUNTRIES.has(c)) return null;
  const override = NAME_OVERRIDES[c];
  if (override) return override;
  const name = icuName(c);
  // ICU writes "Trinidad & Tobago"; a role name reads better spelled out.
  return name ? name.replace(/ & /g, ' and ') : null;
}

/** 'CN' -> '🇨🇳', built from the two regional-indicator symbols. */
export function countryFlag(code: string): string {
  return [...code.toUpperCase()]
    .map((ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65))
    .join('');
}

/** 'CN' -> '🇨🇳 China'. Null for anything that is not a country code. */
export function countryRoleName(code: string): string | null {
  const name = countryName(code);
  return name ? `${countryFlag(code)} ${name}` : null;
}

/** Every country code ICU can name, for autocomplete and alias building. */
export function allCountryCodes(): string[] {
  const out: string[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (countryName(code)) out.push(code);
    }
  }
  return out;
}

/* ==================== reading a country from free text ==================== */

/** Lowercase, accents off, and every run of punctuation collapsed to a space. */
export function normalizePlace(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Other ways people write a country, beyond its name.
 *
 * Deliberately excludes bare ISO codes: "IN" is Indiana far more often than
 * India in this data, and "CA" is California. Only the unambiguous
 * abbreviations families actually used are here.
 */
const COUNTRY_ALIASES: Record<string, string[]> = {
  US: [
    'us', 'u s', 'usa', 'u s a', 'america', 'united states of america',
    'the united states', 'united state',
  ],
  GB: [
    'uk', 'u k', 'britain', 'great britain', 'england', 'scotland', 'wales',
    'northern ireland',
  ],
  AE: ['uae', 'u a e', 'emirates'],
  KR: ['korea', 'republic of korea', 's korea'],
  CN: ['prc', 'mainland china', 'p r china', '中国'],
  CZ: ['czechia'],
  TR: ['turkiye', 'türkiye'],
  HK: ['hongkong'],
  MO: ['macao'],
  NL: ['holland', 'the netherlands'],
  BA: ['bosnia'],
  RU: ['russian federation'],
  VN: ['viet nam'],
  MM: ['burma'],
};

/*
 * Places inside a country, for the many applicants who stopped at the state
 * or the city. Only entries that are unambiguous at the level we match them:
 * no "London" (there is one in Ontario), no "Exeter" (the famous school is in
 * New Hampshire). A place missing from here falls through to the time zone,
 * which settles those cases correctly.
 */
const US_STATES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
  'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine',
  'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi',
  'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
  'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
  'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina',
  'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia',
  'washington', 'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
  'washington dc', 'washington d c', 'new york city', 'nyc', 'jersey city',
];

/** Postal codes, trusted only when they are a whole segment on their own. */
const US_STATE_CODES = [
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il',
  'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt',
  'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri',
  'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc',
];

const PLACES: Record<string, string[]> = {
  US: US_STATES,
  CA: [
    'ontario', 'quebec', 'british columbia', 'alberta', 'manitoba',
    'saskatchewan', 'nova scotia', 'new brunswick', 'newfoundland',
    'prince edward island', 'toronto', 'vancouver', 'montreal', 'ottawa',
    'calgary', 'edmonton', 'waterloo ontario',
  ],
  CN: [
    'beijing', 'shanghai', 'shenzhen', 'guangzhou', 'hangzhou', 'nanjing',
    'nanjng', 'suzhou', 'wuxi', 'wuhan', 'chengdu', 'chongqing', 'tianjin',
    'qingdao', 'jinan', 'xi an', 'xian', 'changsha', 'hefei', 'xiamen',
    'dalian', 'shenyang', 'ningbo', 'zhengzhou', 'fuzhou', 'kunming',
    'guangdong', 'jiangsu', 'zhejiang', 'shandong', 'sichuan', 'hubei',
    'hunan', 'fujian', 'henan', 'hebei', 'anhui', 'liaoning', 'shaanxi',
  ],
  IN: [
    'mumbai', 'new delhi', 'delhi', 'bangalore', 'bengaluru', 'hyderabad',
    'chennai', 'kolkata', 'pune', 'ahmedabad', 'thane', 'nashik', 'jammu',
    'noida', 'gurgaon', 'gurugram', 'maharashtra', 'karnataka', 'tamil nadu',
    'uttar pradesh', 'gujarat', 'kerala', 'telangana',
  ],
  KR: ['seoul', 'busan', 'incheon'],
  JP: ['tokyo', 'osaka', 'kyoto'],
  AE: ['dubai', 'abu dhabi', 'sharjah'],
  TR: ['istanbul', 'ankara', 'antalya', 'izmir'],
  EG: ['cairo', 'giza', 'alexandria egypt'],
  TW: ['taipei'],
  AU: ['new south wales', 'victoria australia', 'queensland', 'melbourne'],
};

type Alias = { alias: string; code: string; level: 'country' | 'place' };

let aliasTable: Alias[] | null = null;

/** Every alias, longest first, so "new mexico" wins over "mexico". */
function aliases(): Alias[] {
  if (aliasTable) return aliasTable;
  const out: Alias[] = [];
  for (const code of allCountryCodes()) {
    const names = new Set<string>();
    names.add(normalizePlace(countryName(code)!));
    const icu = icuName(code);
    if (icu) names.add(normalizePlace(icu));
    for (const a of COUNTRY_ALIASES[code] ?? []) names.add(normalizePlace(a));
    for (const n of names) if (n) out.push({ alias: n, code, level: 'country' });
  }
  for (const [code, places] of Object.entries(PLACES)) {
    for (const p of places) out.push({ alias: normalizePlace(p), code, level: 'place' });
  }
  out.sort((a, b) => b.alias.length - a.alias.length);
  aliasTable = out;
  return out;
}

/**
 * The country a location string names, or null.
 *
 * Longest aliases are matched first and consume their span, so "New Jersey"
 * never reads as Jersey and "South Sudan" never as Sudan. A named country
 * beats a place; between two named countries, the last one written wins,
 * because that is where people put the country.
 */
export function countryFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;

  // State postal codes: only a whole segment ("NJ / USA", "CA"), never a word
  // inside one — "Province: Faysal" must not read as Pennsylvania.
  let codeHit: string | null = null;
  for (const seg of location.split(/[,/，、;|\n]+/)) {
    if (US_STATE_CODES.includes(normalizePlace(seg))) codeHit = 'US';
  }

  let text = ` ${normalizePlace(location)} `;
  const found: { code: string; level: Alias['level']; at: number }[] = [];
  for (const { alias, code, level } of aliases()) {
    const needle = ` ${alias} `;
    let at = text.indexOf(needle);
    while (at !== -1) {
      found.push({ code, level, at });
      // Blank the span so a shorter alias cannot match inside it.
      text = text.slice(0, at + 1) + ' '.repeat(alias.length) + text.slice(at + 1 + alias.length);
      at = text.indexOf(needle);
    }
  }

  const countries = found.filter((f) => f.level === 'country').sort((a, b) => a.at - b.at);
  // "Hong Kong, China": the more specific place is the answer. Families wrote
  // it both ways, and the ones who wrote it this way also chose Hong Kong's
  // time zone.
  const special = countries.find((f) => f.code === 'HK' || f.code === 'MO');
  if (special && countries.every((f) => f.code === special.code || f.code === 'CN')) {
    return special.code;
  }
  if (countries.length > 0) return countries[countries.length - 1]!.code;
  const places = found.filter((f) => f.level === 'place').sort((a, b) => a.at - b.at);
  if (places.length > 0) return places[places.length - 1]!.code;
  return codeHit;
}

/*
 * IANA zone -> country, for the zones applicants actually pick.
 *
 * Node has no API for this. A zone missing here simply yields no answer;
 * the location text is always consulted first.
 */
const ZONE_COUNTRY: Record<string, string> = {
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Phoenix': 'US', 'America/Los_Angeles': 'US', 'America/Anchorage': 'US',
  'America/Detroit': 'US', 'America/Boise': 'US', 'America/Juneau': 'US',
  'America/Indiana/Indianapolis': 'US', 'America/Kentucky/Louisville': 'US',
  'Pacific/Honolulu': 'US', 'US/Eastern': 'US', 'US/Central': 'US',
  'US/Mountain': 'US', 'US/Pacific': 'US',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA', 'America/Halifax': 'CA', 'America/Regina': 'CA',
  'America/St_Johns': 'CA', 'America/Montreal': 'CA',
  'America/Mexico_City': 'MX', 'America/Tijuana': 'MX',
  'America/Sao_Paulo': 'BR', 'America/Santo_Domingo': 'DO', 'America/Nassau': 'BS',
  'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Argentina/Buenos_Aires': 'AR',
  'America/Santiago': 'CL',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT',
  'Europe/Lisbon': 'PT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
  'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Prague': 'CZ',
  'Europe/Warsaw': 'PL', 'Europe/Oslo': 'NO', 'Europe/Stockholm': 'SE',
  'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI', 'Europe/Athens': 'GR',
  'Europe/Istanbul': 'TR', 'Europe/Moscow': 'RU', 'Europe/Kiev': 'UA',
  'Europe/Kyiv': 'UA', 'Europe/Bucharest': 'RO', 'Europe/Budapest': 'HU',
  'Europe/Sarajevo': 'BA', 'Europe/Belgrade': 'RS', 'Europe/Sofia': 'BG',
  'Asia/Shanghai': 'CN', 'Asia/Chongqing': 'CN', 'Asia/Harbin': 'CN',
  'Asia/Urumqi': 'CN', 'Asia/Beijing': 'CN', 'Shanghai': 'CN',
  'Asia/Hong_Kong': 'HK', 'Asia/Macau': 'MO', 'Asia/Taipei': 'TW',
  'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Singapore': 'SG',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD', 'Asia/Kathmandu': 'NP', 'Asia/Colombo': 'LK',
  'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN',
  'Asia/Jakarta': 'ID', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Manila': 'PH',
  'Asia/Rangoon': 'MM', 'Asia/Yangon': 'MM', 'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA', 'Asia/Jerusalem': 'IL',
  'Asia/Tehran': 'IR', 'Asia/Almaty': 'KZ', 'Asia/Tashkent': 'UZ',
  'Asia/Chita': 'RU', 'Asia/Yekaterinburg': 'RU', 'Asia/Novosibirsk': 'RU',
  'Asia/Vladivostok': 'RU',
  'Africa/Cairo': 'EG', 'Africa/Lagos': 'NG', 'Africa/Johannesburg': 'ZA',
  'Africa/Nairobi': 'KE', 'Africa/Addis_Ababa': 'ET', 'Africa/Khartoum': 'SD',
  'Africa/Accra': 'GH', 'Africa/Casablanca': 'MA',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU',
  'Pacific/Auckland': 'NZ',
};

export function countryFromTimezone(timezone: string | null | undefined): string | null {
  if (!timezone) return null;
  return ZONE_COUNTRY[timezone.trim()] ?? null;
}

export type ResolvedCountry = {
  code: string;
  source: 'location' | 'timezone';
  /** The time zone points somewhere else — worth a human glance. */
  conflict: string | null;
};

/**
 * The applicant's country: what they wrote first, their time zone second.
 *
 * The time zone is the weaker signal — a quarter of the students who chose
 * Asia/Hong_Kong wrote a mainland city — so it only fills a gap. It does
 * settle "Georgia", which the text alone cannot.
 */
export function resolveCountry(
  location: string | null | undefined,
  timezone: string | null | undefined,
): ResolvedCountry | null {
  const fromText = countryFromLocation(location);
  const fromZone = countryFromTimezone(timezone);

  if (fromText === 'GE' && fromZone === 'US') {
    return { code: 'US', source: 'location', conflict: null };
  }
  if (fromText) {
    return {
      code: fromText,
      source: 'location',
      conflict: fromZone && fromZone !== fromText ? fromZone : null,
    };
  }
  if (fromZone) return { code: fromZone, source: 'timezone', conflict: null };
  return null;
}
