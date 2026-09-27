/*
 * Country roles: "🇨🇳 China", "🇮🇳 India", "🇺🇸 United States".
 *
 * Self-service and purely decorative. A student types /role and gets the
 * country from their application; /role country:<name> picks another; running
 * it again for the role they already hold takes it off. At most one country
 * role per member.
 *
 * Unlike section and group roles, nothing here is desired state. The sync
 * never adds or removes a country role, because where a student says they
 * are from is theirs to say — the application's free-text location is only
 * the default.
 *
 * The roles themselves are created ahead of time by the discord-country-roles
 * script, never on demand: a chat command that can mint roles is one typo away
 * from a server with "🇺🇸 Untied States" in it.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  countryRoleName,
  normalizePlace,
  resolveCountry,
  type ResolvedCountry,
} from '@rp2/shared';
import { db } from '../db/client.js';
import { application, applicationResponse, discordRole } from '../db/schema.js';
import {
  addMemberRole,
  createGuildRole,
  listGuildRoles,
  removeMemberRole,
} from '../integrations/discord/index.js';
import { applicationForDiscordUser } from './discord-sync.js';

const now = (): number => Math.floor(Date.now() / 1000);

const LOCATION_KEY = 'student_location';
const TIMEZONE_KEY = 'student_timezone';

/** Responses are JSON-encoded strings; anything else is no answer. */
function readString(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'string' ? v.trim() || null : null;
  } catch {
    return null;
  }
}

type Place = { applicationId: string; location: string | null; timezone: string | null };

function placesFor(applicationIds: string[]): Place[] {
  if (applicationIds.length === 0) return [];
  const out = new Map<string, Place>(
    applicationIds.map((id) => [id, { applicationId: id, location: null, timezone: null }]),
  );
  const rows = db
    .select({
      applicationId: applicationResponse.applicationId,
      key: applicationResponse.questionKey,
      value: applicationResponse.value,
    })
    .from(applicationResponse)
    .where(
      and(
        inArray(applicationResponse.applicationId, applicationIds),
        inArray(applicationResponse.questionKey, [LOCATION_KEY, TIMEZONE_KEY]),
      ),
    )
    .all();
  for (const r of rows) {
    const p = out.get(r.applicationId);
    if (!p) continue;
    if (r.key === LOCATION_KEY) p.location = readString(r.value);
    else p.timezone = readString(r.value);
  }
  return [...out.values()];
}

export function countryForApplication(applicationId: string): ResolvedCountry | null {
  const [p] = placesFor([applicationId]);
  return p ? resolveCountry(p.location, p.timezone) : null;
}

/* ==================== creating the roles ==================== */

/** Which applications count as "represented". */
export type CountryScope = 'enrolled' | 'applicants';

/** Statuses that mean someone actually applied, rather than started a draft. */
const APPLIED = [
  'submitted',
  'under_review',
  'accepted',
  'awaiting_payment',
  'enrolled',
  'declined',
  'waitlisted',
  'rejected',
  'withdrawn',
] as const;

export type CountryRolePlan = {
  considered: number;
  /** ISO code -> how many applications resolve to it. */
  tally: Map<string, number>;
  unresolved: Place[];
  /** Location and time zone disagree — resolved by location, worth a glance. */
  conflicts: (Place & { code: string; zoneCode: string })[];
  /** Resolved by time zone alone, because the text named nowhere we know. */
  byTimezone: (Place & { code: string })[];
  created: string[];
  adopted: string[];
  existing: string[];
};

/**
 * Make sure every country represented has a role, and that we know its id.
 *
 * Adopts a role that already exists under the same name rather than making
 * a duplicate, exactly as the section roles do. Unlike those, creating is the
 * normal case here: a country role carries no channel permissions, so a fresh
 * one is not a trap.
 */
export async function ensureCountryRoles(
  opts: { dryRun?: boolean; scope?: CountryScope } = {},
): Promise<CountryRolePlan> {
  const statuses = opts.scope === 'applicants' ? [...APPLIED] : (['enrolled'] as const);
  const ids = db
    .select({ id: application.id })
    .from(application)
    .where(inArray(application.status, [...statuses]))
    .all()
    .map((r) => r.id);

  const plan: CountryRolePlan = {
    considered: ids.length,
    tally: new Map(),
    unresolved: [],
    conflicts: [],
    byTimezone: [],
    created: [],
    adopted: [],
    existing: [],
  };

  for (const p of placesFor(ids)) {
    const c = resolveCountry(p.location, p.timezone);
    if (!c) {
      plan.unresolved.push(p);
      continue;
    }
    plan.tally.set(c.code, (plan.tally.get(c.code) ?? 0) + 1);
    if (c.conflict) plan.conflicts.push({ ...p, code: c.code, zoneCode: c.conflict });
    if (c.source === 'timezone') plan.byTimezone.push({ ...p, code: c.code });
  }

  const known = new Map(countryRoles().map((r) => [r.code, r]));
  const needed = [...plan.tally.keys()].filter((code) => {
    if (known.has(code)) {
      plan.existing.push(known.get(code)!.name);
      return false;
    }
    return true;
  });
  if (needed.length === 0) return plan;

  const byName = new Map((await listGuildRoles()).map((r) => [r.name.toLowerCase(), r]));

  for (const code of needed.sort()) {
    const name = countryRoleName(code);
    if (!name) continue;
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      plan.adopted.push(name);
      if (!opts.dryRun) recordCountryRole(code, existing.id, name);
      continue;
    }
    plan.created.push(name);
    if (!opts.dryRun) {
      // Not mentionable: "@🇨🇳 China" would ping a hundred minors at once.
      const role = await createGuildRole(name, { mentionable: false });
      recordCountryRole(code, role.id, name);
    }
  }
  return plan;
}

function recordCountryRole(code: string, roleId: string, name: string): void {
  db.insert(discordRole)
    .values({ id: nanoid(), kind: 'country', key: code, roleId, name, createdAt: now() })
    .onConflictDoNothing()
    .run();
}

export type CountryRole = { code: string; roleId: string; name: string };

export function countryRoles(): CountryRole[] {
  return db
    .select({ code: discordRole.key, roleId: discordRole.roleId, name: discordRole.name })
    .from(discordRole)
    .where(eq(discordRole.kind, 'country'))
    .all()
    .sort((a, b) => countrySortKey(a.name).localeCompare(countrySortKey(b.name)));
}

/** Sort by the name, not by the flag's code points. */
function countrySortKey(roleName: string): string {
  return roleName.replace(/^\S+\s+/, '');
}

/* ==================== /role ==================== */

/** Discord caps autocomplete at 25 choices. */
const MAX_CHOICES = 25;

/** Autocomplete for /role country: every country role we have, filtered. */
export function countryChoices(typed: string): { name: string; value: string }[] {
  const q = normalizePlace(typed);
  return countryRoles()
    .filter((r) => !q || normalizePlace(countrySortKey(r.name)).includes(q))
    .slice(0, MAX_CHOICES)
    .map((r) => ({ name: r.name, value: r.code }));
}

/**
 * Give a member their country role, or take it away.
 *
 * `memberRoleIds` comes from the interaction payload itself, which Discord
 * fills in with the caller's current roles — so there is no GET, and the
 * reply stays well inside the three seconds Discord allows.
 *
 * Returns the message to show the caller. Never throws for a user mistake;
 * only a Discord API failure escapes.
 */
export async function toggleCountryRole(input: {
  discordUserId: string;
  memberRoleIds: string[];
  /** What they picked, or null for "the one on my application". */
  requested: string | null;
}): Promise<string> {
  const roles = countryRoles();
  if (roles.length === 0) return 'Country roles have not been set up yet.';

  let target: CountryRole | undefined;
  if (input.requested) {
    // Autocomplete sends the code; a member who ignores the suggestions and
    // types a name should still get what they meant.
    const q = normalizePlace(input.requested);
    target =
      roles.find((r) => r.code.toLowerCase() === q) ??
      roles.find((r) => normalizePlace(countrySortKey(r.name)) === q);
    if (!target) {
      return `There is no role for "${input.requested}". Start typing and pick from the list.`;
    }
  } else {
    const found = applicationForDiscordUser(input.discordUserId);
    const resolved = found ? countryForApplication(found.applicationId) : null;
    target = resolved ? roles.find((r) => r.code === resolved.code) : undefined;
    if (!target) {
      return "We couldn't tell your country from your application. Use `/role country:` and pick one from the list.";
    }
  }

  const has = new Set(input.memberRoleIds);

  // Running it again for the role you already hold is how you take it off.
  if (has.has(target.roleId)) {
    await removeMemberRole(input.discordUserId, target.roleId);
    return `Removed ${target.name}. Run \`/role\` again any time to add it back.`;
  }

  // One country at a time: swapping replaces rather than accumulates.
  for (const other of roles) {
    if (other.roleId !== target.roleId && has.has(other.roleId)) {
      await removeMemberRole(input.discordUserId, other.roleId);
    }
  }
  await addMemberRole(input.discordUserId, target.roleId);

  const hint = input.requested ? '' : ' Not right? Use `/role country:` to pick another.';
  return `You now have ${target.name}.${hint}`;
}
