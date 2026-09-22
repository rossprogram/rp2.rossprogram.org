/*
 * Keeping the guild in step with the portal.
 *
 * Desired state is a pure function of the offers: a student's section and
 * group determine their two roles, and their names determine their nickname.
 * Actual state is whatever Discord reports. Everything here is that diff.
 *
 * The bot manages ONLY students it can match to an enrolled, fully-signed
 * application. Staff roles are assigned by hand, and a member the bot does not
 * recognize is left completely alone — never renamed, never kicked. A bot that
 * removes people it does not understand is a bot that eventually removes a
 * mentor mid-session.
 */

import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  discordNickname,
  groupRoleKey,
  groupRoleName,
  sectionRoleKey,
  sectionRoleName,
} from '@rp2/shared';
import { db } from '../db/client.js';
import { application, discordLink, discordRole, offer, user } from '../db/schema.js';
import {
  addGuildMember,
  addMemberRole,
  createGuildRole,
  getMember,
  listGuildRoles,
  removeGuildMember,
  removeMemberRole,
  setMemberNickname,
} from '../integrations/discord/index.js';
import { isCleared } from './agreements.js';
import { studentNamesFor } from './names.js';

const now = (): number => Math.floor(Date.now() / 1000);

export type DesiredState = {
  applicationId: string;
  nickname: string;
  /** [sectionRoleName, groupRoleName] — names, not ids. */
  roleNames: string[];
  roleKeys: { kind: 'section' | 'group'; key: string; name: string }[];
};

/**
 * What this student's membership should look like.
 *
 * Returns null when the offer cannot produce role names — a missing course
 * key, or a section that does not parse. Better to sync nothing than to invent
 * a role called `null-Group-3`.
 */
export function desiredStateFor(applicationId: string): DesiredState | null {
  const o = db.select().from(offer).where(eq(offer.applicationId, applicationId)).get();
  if (!o || !o.section || !o.cohort) return null;

  const sectionName = sectionRoleName(o.courseKey, o.section);
  const groupName = groupRoleName(o.courseKey, o.section, o.cohort);
  if (!sectionName || !groupName) return null;

  const names = studentNamesFor(applicationId);
  if (!names.legal && !names.preferred) return null;

  return {
    applicationId,
    nickname: discordNickname(names.preferred, names.legal),
    roleNames: [sectionName, groupName],
    roleKeys: [
      { kind: 'section', key: sectionRoleKey(o.section), name: sectionName },
      { kind: 'group', key: groupRoleKey(o.section, o.cohort), name: groupName },
    ],
  };
}

/**
 * Make sure every role the current cohort needs exists in the guild, and that
 * we know its snowflake.
 *
 * Matches existing roles by NAME on first run, so a guild where someone
 * created `Quadratic-Forms-2` by hand adopts that role rather than making a
 * confusing duplicate. After that, ids are identity.
 */
export async function ensureRoles(
  opts: { dryRun?: boolean; allowCreate?: boolean } = {},
): Promise<{
  created: string[];
  adopted: string[];
  /** Wanted, absent from the guild, and NOT created. A naming mismatch. */
  missing: string[];
  existing: number;
}> {
  const wanted = new Map<string, { kind: 'section' | 'group'; key: string; name: string }>();
  for (const row of enrolledApplicationIds()) {
    const desired = desiredStateFor(row);
    if (!desired) continue;
    for (const r of desired.roleKeys) wanted.set(`${r.kind}:${r.key}`, r);
  }

  const known = db.select().from(discordRole).all();
  const knownBy = new Set(known.map((r) => `${r.kind}:${r.key}`));

  const unrecorded = [...wanted.values()].filter((r) => !knownBy.has(`${r.kind}:${r.key}`));
  if (unrecorded.length === 0) {
    return { created: [], adopted: [], missing: [], existing: known.length };
  }

  const guildRoles = await listGuildRoles();
  const byName = new Map(guildRoles.map((r) => [r.name.toLowerCase(), r]));

  const created: string[] = [];
  const adopted: string[] = [];
  const missing: string[] = [];

  for (const want of unrecorded) {
    const existing = byName.get(want.name.toLowerCase());
    if (existing) {
      adopted.push(want.name);
      if (!opts.dryRun) recordRole(want, existing.id);
      continue;
    }

    /*
     * The role does not exist under the name we derive.
     *
     * Creating one is almost always the WRONG repair: the roles in a set-up
     * server already carry channel permissions, and a fresh role with the
     * same purpose but no permissions looks identical in the member list
     * while granting access to nothing. The likelier truth is that our
     * naming constants disagree with what a human typed — so say so, and
     * let a person decide. Creation is opt-in.
     */
    if (!opts.allowCreate) {
      missing.push(want.name);
      continue;
    }
    created.push(want.name);
    if (!opts.dryRun) {
      const role = await createGuildRole(want.name);
      recordRole(want, role.id);
    }
  }

  return { created, adopted, missing, existing: known.length };
}

function recordRole(
  want: { kind: 'section' | 'group'; key: string; name: string },
  roleId: string,
): void {
  db.insert(discordRole)
    .values({
      id: nanoid(),
      kind: want.kind,
      key: want.key,
      roleId,
      name: want.name,
      createdAt: now(),
    })
    .onConflictDoNothing()
    .run();
}

function roleIdsFor(desired: DesiredState): string[] | null {
  const rows = db.select().from(discordRole).all();
  const ids: string[] = [];
  for (const want of desired.roleKeys) {
    const hit = rows.find((r) => r.kind === want.kind && r.key === want.key);
    if (!hit) return null;
    ids.push(hit.roleId);
  }
  return ids;
}

/**
 * Role ids read live from the guild, without recording anything.
 *
 * Only a dry run needs this: it must reach the same verdict as a real sync
 * while leaving the database untouched.
 */
async function resolveRoleIdsFromGuild(desired: DesiredState): Promise<string[] | null> {
  const guildRoles = await listGuildRoles();
  const byName = new Map(guildRoles.map((r) => [r.name.toLowerCase(), r.id]));
  const ids: string[] = [];
  for (const want of desired.roleKeys) {
    const id = byName.get(want.name.toLowerCase());
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}

/** Every role id the bot manages — used to tell "ours" from "theirs". */
function managedRoleIds(): Set<string> {
  return new Set(db.select({ roleId: discordRole.roleId }).from(discordRole).all().map((r) => r.roleId));
}

export type SyncOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'joined' }
  | { status: 'updated'; changes: string[] }
  | { status: 'unchanged' };

/**
 * Bring one student's membership in line, whatever state it is currently in.
 *
 * Safe to call repeatedly — it is a diff, not a sequence of commands. The
 * first call after linking usually joins; later calls after a section change
 * move roles.
 */
export async function syncMember(
  applicationId: string,
  opts: { accessToken?: string; dryRun?: boolean } = {},
): Promise<SyncOutcome> {
  // A dry run asks Discord the same questions and reaches the same verdict —
  // it simply does not write. Preview and action share this one path on
  // purpose: when they were separate, the preview reported "unchanged" for
  // nine students who were not in the guild at all.
  const dry = opts.dryRun === true;
  if (!isCleared(applicationId)) {
    return { status: 'skipped', reason: 'not_cleared' };
  }
  const desired = desiredStateFor(applicationId);
  if (!desired) return { status: 'skipped', reason: 'no_placement' };

  const link = linkForApplication(applicationId);
  if (!link) return { status: 'skipped', reason: 'no_discord_link' };

  let roleIds = roleIdsFor(desired);
  if (!roleIds) {
    /*
     * We know the role NAMES but not yet their snowflakes, because nothing has
     * resolved them against the guild yet. Do it now rather than skipping:
     * a student linking their account is the moment this has to work, and
     * waiting for an admin to run a reconcile first is how nine students got
     * told they had joined a server they were never added to.
     *
     * Adopts by name only — never creates. A name we cannot find is still a
     * mismatch for a human to resolve.
     */
    await ensureRoles({ dryRun: dry });
    roleIds = roleIdsFor(desired);
    // A dry run records nothing, so ask the guild directly for this run.
    if (!roleIds && dry) roleIds = await resolveRoleIdsFromGuild(desired);
  }
  if (!roleIds) return { status: 'skipped', reason: 'roles_not_created' };

  const member = await getMember(link.discordUserId);

  // Not in the guild yet: one call joins them named and roled. Needs the
  // OAuth access token, which we only hold during the link callback.
  if (!member) {
    // Adding somebody needs their OAuth token, which exists only during the
    // link callback. Outside it, the honest answer is that they have to click
    // again — not that everything is fine.
    if (!opts.accessToken) return { status: 'skipped', reason: 'not_a_member' };
    if (dry) return { status: 'joined' };
    await addGuildMember({
      discordUserId: link.discordUserId,
      accessToken: opts.accessToken,
      nick: desired.nickname,
      roleIds,
    });
    markSynced(link.userId, { joined: true });
    return { status: 'joined' };
  }

  const changes: string[] = [];

  if (member.nick !== desired.nickname) {
    if (!dry) await setMemberNickname(link.discordUserId, desired.nickname);
    changes.push(`nickname -> ${desired.nickname}`);
  }

  const managed = managedRoleIds();
  const has = new Set(member.roleIds);
  for (const id of roleIds) {
    if (!has.has(id)) {
      if (!dry) await addMemberRole(link.discordUserId, id);
      changes.push(`+role ${id}`);
    }
  }
  // Remove only roles WE manage. A staff-assigned role, or a decoration
  // someone picked up, is none of the bot's business.
  for (const id of member.roleIds) {
    if (managed.has(id) && !roleIds.includes(id)) {
      if (!dry) await removeMemberRole(link.discordUserId, id);
      changes.push(`-role ${id}`);
    }
  }

  if (!dry) markSynced(link.userId, { joined: false });
  return changes.length > 0 ? { status: 'updated', changes } : { status: 'unchanged' };
}

/**
 * End a student's access: remove them from the guild outright.
 *
 * Called on withdrawal or dismissal. The participation agreement promises
 * access ends immediately, and a roleless member can still read @everyone
 * channels, so this removes rather than demotes.
 */
export async function revokeMember(userId: string): Promise<'removed' | 'not_linked'> {
  const link = db.select().from(discordLink).where(eq(discordLink.userId, userId)).get();
  if (!link) return 'not_linked';
  await removeGuildMember(link.discordUserId);
  db.update(discordLink)
    .set({ joinedGuildAt: null, lastSyncAt: now(), lastSyncError: null })
    .where(eq(discordLink.userId, userId))
    .run();
  return 'removed';
}

export type ReconcileReport = {
  cleared: number;
  linked: number;
  rolesCreated: string[];
  rolesAdopted: string[];
  /** Derived names with no matching role in the guild — a naming mismatch. */
  rolesMissing: string[];
  results: { applicationId: string; outcome: SyncOutcome }[];
  /** Members in the guild the bot manages roles for but cannot place. */
  orphans: string[];
};

/**
 * Sweep every enrolled student.
 *
 * Sequential on purpose: a few hundred calls that finish in order are easier
 * to reason about — and to rate-limit — than a burst, and this runs at human
 * cadence from an admin button.
 */
export async function reconcileAll(
  opts: { dryRun?: boolean; allowCreate?: boolean } = {},
): Promise<ReconcileReport> {
  const roles = await ensureRoles(opts);

  const appIds = enrolledApplicationIds();
  const cleared = appIds.filter((id) => isCleared(id));

  const results: ReconcileReport['results'] = [];
  let linked = 0;

  for (const id of cleared) {
    const link = linkForApplication(id);
    if (link) linked += 1;
    try {
      results.push({
        applicationId: id,
        outcome: await syncMember(id, { dryRun: opts.dryRun === true }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const link2 = linkForApplication(id);
      if (link2 && !opts.dryRun) markSyncError(link2.userId, message);
      results.push({ applicationId: id, outcome: { status: 'skipped', reason: message } });
    }
  }

  return {
    cleared: cleared.length,
    linked,
    rolesCreated: roles.created,
    rolesAdopted: roles.adopted,
    rolesMissing: roles.missing,
    results,
    orphans: [],
  };
}

/* ==================== small queries ==================== */

function enrolledApplicationIds(): string[] {
  return db
    .select({ id: application.id })
    .from(application)
    .where(eq(application.status, 'enrolled'))
    .all()
    .map((r) => r.id);
}

export type LinkRow = { userId: string; discordUserId: string };

export function linkForApplication(applicationId: string): LinkRow | null {
  const row = db
    .select({ userId: discordLink.userId, discordUserId: discordLink.discordUserId })
    .from(discordLink)
    .innerJoin(application, eq(application.applicantUserId, discordLink.userId))
    .where(eq(application.id, applicationId))
    .get();
  return row ?? null;
}

/** The application a Discord account belongs to — the /whois lookup. */
export function applicationForDiscordUser(discordUserId: string): {
  applicationId: string;
  userId: string;
  email: string;
} | null {
  const row = db
    .select({
      applicationId: application.id,
      userId: discordLink.userId,
      email: user.email,
    })
    .from(discordLink)
    .innerJoin(application, eq(application.applicantUserId, discordLink.userId))
    .innerJoin(user, eq(user.id, discordLink.userId))
    .where(eq(discordLink.discordUserId, discordUserId))
    .get();
  return row ?? null;
}

function markSynced(userId: string, opts: { joined: boolean }): void {
  db.update(discordLink)
    .set({
      lastSyncAt: now(),
      lastSyncError: null,
      ...(opts.joined ? { joinedGuildAt: now() } : {}),
    })
    .where(eq(discordLink.userId, userId))
    .run();
}

function markSyncError(userId: string, message: string): void {
  db.update(discordLink)
    .set({ lastSyncAt: now(), lastSyncError: message.slice(0, 500) })
    .where(eq(discordLink.userId, userId))
    .run();
}

/**
 * Claim a Discord account for a portal user.
 *
 * The unique index on discord_user_id is what stops two students sharing one
 * account; losing that race is a clean error rather than a silent overwrite.
 */
export function saveLink(input: {
  userId: string;
  discordUserId: string;
  username: string;
}): 'linked' | 'taken' {
  const existing = db
    .select()
    .from(discordLink)
    .where(eq(discordLink.discordUserId, input.discordUserId))
    .get();
  if (existing && existing.userId !== input.userId) return 'taken';

  db.insert(discordLink)
    .values({
      userId: input.userId,
      discordUserId: input.discordUserId,
      discordUsername: input.username,
      linkedAt: now(),
    })
    .onConflictDoUpdate({
      target: discordLink.userId,
      set: { discordUserId: input.discordUserId, discordUsername: input.username },
    })
    .run();
  return 'linked';
}

export function linkFor(userId: string): {
  discordUserId: string;
  discordUsername: string | null;
  joinedGuildAt: number | null;
} | null {
  const row = db.select().from(discordLink).where(eq(discordLink.userId, userId)).get();
  if (!row) return null;
  return {
    discordUserId: row.discordUserId,
    discordUsername: row.discordUsername,
    joinedGuildAt: row.joinedGuildAt,
  };
}
