/*
 * Linking a Discord account, and keeping the guild in step.
 *
 * The Discord integration is faked the way the SES module is faked in
 * enrollment.test.ts: a vi.mock recording what the bot would have done, so the
 * gate, the diff, and the revocation path are all exercised without a network.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { nanoid } from 'nanoid';

// Must be set before anything imports env.ts.
process.env.DATABASE_URL = ':memory:';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-pass-zod';
process.env.EMAIL_TRANSPORT = 'console';
process.env.PAYMENTS_ENABLED = 'false';
process.env.DISCORD_ENABLED = 'true';
process.env.DISCORD_CLIENT_ID = 'client-id';
process.env.DISCORD_CLIENT_SECRET = 'client-secret';
process.env.DISCORD_BOT_TOKEN = 'bot-token';
process.env.DISCORD_GUILD_ID = 'guild-id';
process.env.DISCORD_PUBLIC_KEY = 'a'.repeat(64);

/** The fake guild. */
const guild = {
  roles: [] as { id: string; name: string; position: number; managed: boolean }[],
  members: new Map<string, { nick: string | null; roleIds: string[] }>(),
  calls: [] as string[],
};

vi.mock('../src/integrations/discord/index.js', () => ({
  discordEnabled: () => true,
  authorizeUrl: (state: string) => `https://discord.test/authorize?state=${state}`,
  exchangeCode: vi.fn(async () => ({
    accessToken: 'access-token',
    discordUserId: 'discord-ada',
    username: 'ada',
  })),
  addGuildMember: vi.fn(async (p: { discordUserId: string; nick: string; roleIds: string[] }) => {
    guild.calls.push(`add:${p.discordUserId}`);
    if (guild.members.has(p.discordUserId)) return 'already_member';
    guild.members.set(p.discordUserId, { nick: p.nick, roleIds: [...p.roleIds] });
    return 'added';
  }),
  getMember: vi.fn(async (id: string) => {
    const m = guild.members.get(id);
    return m ? { discordUserId: id, nick: m.nick, roleIds: [...m.roleIds] } : null;
  }),
  setMemberNickname: vi.fn(async (id: string, nick: string) => {
    guild.calls.push(`nick:${id}:${nick}`);
    const m = guild.members.get(id);
    if (m) m.nick = nick;
  }),
  addMemberRole: vi.fn(async (id: string, roleId: string) => {
    guild.calls.push(`+role:${id}:${roleId}`);
    guild.members.get(id)?.roleIds.push(roleId);
  }),
  removeMemberRole: vi.fn(async (id: string, roleId: string) => {
    guild.calls.push(`-role:${id}:${roleId}`);
    const m = guild.members.get(id);
    if (m) m.roleIds = m.roleIds.filter((r) => r !== roleId);
  }),
  removeGuildMember: vi.fn(async (id: string) => {
    guild.calls.push(`remove:${id}`);
    guild.members.delete(id);
  }),
  listGuildRoles: vi.fn(async () => guild.roles),
  createGuildRole: vi.fn(async (name: string) => {
    const role = { id: `role-${guild.roles.length + 1}`, name, position: 1, managed: false };
    guild.roles.push(role);
    guild.calls.push(`create-role:${name}`);
    return { id: role.id };
  }),
  verifyInteraction: () => true,
  DiscordError: class DiscordError extends Error {},
}));

vi.mock('../src/integrations/email/ses.js', () => ({ sendEmail: vi.fn(async () => {}) }));

const { db } = await import('../src/db/client.js');
const schema = await import('../src/db/schema.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { build } = await import('../src/server.js');
const { ensureRoles, reconcileAll, revokeMember, syncMember, saveLink } = await import(
  '../src/services/discord-sync.js'
);
const { AGREEMENTS } = await import('@rp2/shared');

type App = Awaited<ReturnType<typeof build>>;
let app: App;

const now = () => Math.floor(Date.now() / 1000);

function seed(
  over: {
    courseKey?: string;
    section?: string;
    cohort?: string;
    amountDueCents?: number;
  } = {},
) {
  const studentId = nanoid();
  const guardianId = nanoid();
  const appId = nanoid();

  db.insert(schema.user)
    .values([
      { id: studentId, email: `s-${studentId}@example.com`, createdAt: now() },
      { id: guardianId, email: `g-${guardianId}@example.com`, createdAt: now() },
    ])
    .run();
  db.insert(schema.userRole)
    .values([
      { userId: studentId, role: 'applicant', grantedAt: now() },
      { userId: guardianId, role: 'guardian', grantedAt: now() },
    ])
    .run();
  db.insert(schema.application)
    .values({
      id: appId,
      applicantUserId: studentId,
      status: 'enrolled',
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  db.insert(schema.applicationResponse)
    .values([
      {
        applicationId: appId,
        questionKey: 'student_legal_name',
        value: JSON.stringify('Alexander Sheng'),
        updatedAt: now(),
      },
      {
        applicationId: appId,
        questionKey: 'student_preferred_name',
        value: JSON.stringify('Alex'),
        updatedAt: now(),
      },
    ])
    .run();
  db.insert(schema.guardianLink)
    .values({
      id: nanoid(),
      applicantUserId: studentId,
      guardianUserId: guardianId,
      relationship: 'parent',
      createdAt: now(),
      acceptedAt: now(),
    })
    .run();
  db.insert(schema.offer)
    .values({
      id: nanoid(),
      applicationId: appId,
      courseKey: over.courseKey ?? 'quadratic',
      section: over.section ?? 'QUADRATIC-2',
      cohort: over.cohort ?? '3',
      amountDueCents: over.amountDueCents ?? 0,
      response: 'accepted',
      notifiedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  return { studentId, guardianId, appId };
}

/** All four signatures, written straight in — the flow is tested elsewhere. */
function signEverything(s: { appId: string; studentId: string; guardianId: string }) {
  for (const doc of AGREEMENTS) {
    for (const signer of doc.signers) {
      db.insert(schema.agreementSignature)
        .values({
          id: nanoid(),
          applicationId: s.appId,
          document: doc.key,
          signerKind: signer,
          signerUserId: signer === 'student' ? s.studentId : s.guardianId,
          typedName: 'Someone',
          documentVersion: doc.version,
          documentHash: 'hash',
          signedAt: now(),
        })
        .run();
    }
  }
}

function login(userId: string): string {
  const sid = nanoid();
  db.insert(schema.session)
    .values({ id: sid, userId, createdAt: now(), expiresAt: now() + 3600 })
    .run();
  return app.signCookie(sid);
}

beforeAll(async () => {
  runMigrations();
  app = await build();
  await app.ready();
});

beforeEach(() => {
  guild.roles = [];
  guild.members.clear();
  guild.calls = [];

  db.delete(schema.discordLink).run();
  db.delete(schema.discordRole).run();
  db.delete(schema.agreementSignature).run();
  db.delete(schema.offer).run();
  db.delete(schema.applicationResponse).run();
  db.delete(schema.application).run();
  db.delete(schema.guardianLink).run();
  db.delete(schema.session).run();
  db.delete(schema.userRole).run();
  db.delete(schema.user).run();
});

describe('the gate', () => {
  it('refuses an enrolled student who has not signed', async () => {
    const s = seed();
    const res = await app.inject({
      method: 'GET',
      url: '/api/discord/link',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('not_cleared');
  });

  it('refuses a fully-signed student who has not paid', async () => {
    const s = seed({ amountDueCents: 150_000 });
    signEverything(s);
    const res = await app.inject({
      method: 'GET',
      url: '/api/discord/link',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('sends a cleared student to Discord', async () => {
    const s = seed();
    signEverything(s);
    const res = await app.inject({
      method: 'GET',
      url: '/api/discord/link',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('discord.test/authorize');
  });

  it('requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/discord/link' });
    expect(res.statusCode).toBe(401);
  });
});

describe('roles', () => {
  it('creates a role per section and per group', async () => {
    const a = seed({ section: 'QUADRATIC-2', cohort: '3' });
    signEverything(a);
    const b = seed({ section: 'QUADRATIC-2', cohort: '4' });
    signEverything(b);

    const result = await ensureRoles({ allowCreate: true });
    expect(result.created.sort()).toEqual(['QF-2-Group-3', 'QF-2-Group-4', 'Quadratic-Forms-2']);

    // Idempotent: a second run creates nothing.
    const again = await ensureRoles({ allowCreate: true });
    expect(again.created).toEqual([]);
  });

  /*
   * If someone has already made `Quadratic-Forms-2` by hand, adopt it. Making
   * a second role with the same name is how a server ends up with two roles
   * nobody can tell apart.
   */
  it('adopts a matching role that already exists in the guild', async () => {
    const s = seed();
    signEverything(s);
    guild.roles.push({ id: 'preexisting', name: 'Quadratic-Forms-2', position: 5, managed: false });

    const result = await ensureRoles();
    expect(result.adopted).toContain('Quadratic-Forms-2');
    expect(result.created).not.toContain('Quadratic-Forms-2');

    const row = db.select().from(schema.discordRole).all().find((r) => r.kind === 'section');
    expect(row?.roleId).toBe('preexisting');
  });

  /*
   * Roles come from the cohort's STRUCTURE, not from who has signed — so the
   * server can be built out in full before a single student arrives. Creating
   * a role grants nobody anything; assigning one is what the gate covers.
   */
  it('provisions roles for the whole enrolled cohort, signed or not', async () => {
    seed({ courseKey: 'topology', section: 'TOPOLOGY-1', cohort: '2' }); // enrolled, unsigned
    const result = await ensureRoles({ allowCreate: true });
    expect(result.created.sort()).toEqual(['Topology-1', 'Topology-1-Group-2']);
  });

  /*
   * The server is set up by hand first: roles carry channel permissions, and a
   * duplicate created under the same name would carry none while looking
   * identical in the member list. So a name we cannot find is reported, never
   * invented.
   */
  it('does not create a role by default — it reports the mismatch', async () => {
    const s = seed();
    signEverything(s);

    const result = await ensureRoles();
    expect(result.created).toEqual([]);
    expect(result.missing.sort()).toEqual(['QF-2-Group-3', 'Quadratic-Forms-2']);
    expect(guild.calls).toEqual([]);
    expect(db.select().from(schema.discordRole).all()).toHaveLength(0);
  });

  it('adopts every role that does exist, and reports only the rest', async () => {
    const s = seed();
    signEverything(s);
    guild.roles.push({ id: 'sec', name: 'Quadratic-Forms-2', position: 5, managed: false });

    const result = await ensureRoles();
    expect(result.adopted).toEqual(['Quadratic-Forms-2']);
    expect(result.missing).toEqual(['QF-2-Group-3']);
    expect(result.created).toEqual([]);
  });

  it('ignores applications that are not enrolled at all', async () => {
    const s = seed();
    db.update(schema.application).set({ status: 'waitlisted' }).run();
    signEverything(s);

    const result = await ensureRoles();
    expect(result.created).toEqual([]);
  });
});

describe('syncing a member', () => {
  /*
   * The production failure of 2026-09-22. Nine students linked their accounts
   * before any reconcile had recorded the guild's role ids, so every sync bailed
   * out with roles_not_created — and the callback told them they had joined a
   * server they were never added to. A link must resolve the roles it needs.
   */
  it('resolves guild roles on demand rather than skipping the join', async () => {
    const s = seed();
    signEverything(s);
    // The roles exist in the guild, but nothing has recorded their ids yet.
    guild.roles.push(
      { id: 'sec', name: 'Quadratic-Forms-2', position: 5, managed: false },
      { id: 'grp', name: 'QF-2-Group-3', position: 4, managed: false },
    );
    expect(db.select().from(schema.discordRole).all()).toHaveLength(0);

    saveLink({ userId: s.studentId, discordUserId: 'discord-ada', username: 'ada' });
    const outcome = await syncMember(s.appId, { accessToken: 'access-token' });

    expect(outcome.status).toBe('joined');
    expect(guild.members.get('discord-ada')!.roleIds.sort()).toEqual(['grp', 'sec']);
    // It adopted, and did not invent duplicates.
    expect(guild.calls.filter((c) => c.startsWith('create-role'))).toEqual([]);
  });

  it('still refuses when the roles genuinely are not in the guild', async () => {
    const s = seed();
    signEverything(s);
    saveLink({ userId: s.studentId, discordUserId: 'discord-ada', username: 'ada' });

    const outcome = await syncMember(s.appId, { accessToken: 'access-token' });
    expect(outcome).toEqual({ status: 'skipped', reason: 'roles_not_created' });
    expect(guild.members.has('discord-ada')).toBe(false);
  });

  it('joins a cleared student named and roled, in one call', async () => {
    const s = seed();
    signEverything(s);
    await ensureRoles({ allowCreate: true });
    saveLink({ userId: s.studentId, discordUserId: 'discord-ada', username: 'ada' });

    const outcome = await syncMember(s.appId, { accessToken: 'access-token' });
    expect(outcome.status).toBe('joined');

    const member = guild.members.get('discord-ada')!;
    expect(member.nick).toBe('Alex (Alexander Sheng)');
    expect(member.roleIds).toHaveLength(2);

    // The join carried the name and roles — no follow-up calls needed.
    expect(guild.calls.filter((c) => c.startsWith('nick:'))).toHaveLength(0);
  });

  it('moves roles when a later import changes the section', async () => {
    const s = seed();
    signEverything(s);
    await ensureRoles({ allowCreate: true });
    saveLink({ userId: s.studentId, discordUserId: 'discord-ada', username: 'ada' });
    await syncMember(s.appId, { accessToken: 'access-token' });

    const oldRoles = [...guild.members.get('discord-ada')!.roleIds];

    db.update(schema.offer)
      .set({ section: 'QUADRATIC-1', cohort: '5' })
      .run();
    await ensureRoles({ allowCreate: true });
    const outcome = await syncMember(s.appId);

    expect(outcome.status).toBe('updated');
    const nowRoles = guild.members.get('discord-ada')!.roleIds;
    expect(nowRoles).toHaveLength(2);
    expect(nowRoles.some((r) => oldRoles.includes(r))).toBe(false);
  });

  /*
   * The bot manages its own roles and nothing else. A staff-assigned role must
   * survive a sync, or the first reconcile strips every mentor of their badge.
   */
  it('leaves roles it does not manage alone', async () => {
    const s = seed();
    signEverything(s);
    await ensureRoles({ allowCreate: true });
    saveLink({ userId: s.studentId, discordUserId: 'discord-ada', username: 'ada' });
    await syncMember(s.appId, { accessToken: 'access-token' });

    guild.members.get('discord-ada')!.roleIds.push('some-staff-role');
    await syncMember(s.appId);

    expect(guild.members.get('discord-ada')!.roleIds).toContain('some-staff-role');
  });

  it('is a no-op when everything already matches', async () => {
    const s = seed();
    signEverything(s);
    await ensureRoles({ allowCreate: true });
    saveLink({ userId: s.studentId, discordUserId: 'discord-ada', username: 'ada' });
    await syncMember(s.appId, { accessToken: 'access-token' });

    const outcome = await syncMember(s.appId);
    expect(outcome.status).toBe('unchanged');
  });

  it('refuses to sync a student who is no longer cleared', async () => {
    const s = seed();
    signEverything(s);
    await ensureRoles({ allowCreate: true });
    saveLink({ userId: s.studentId, discordUserId: 'discord-ada', username: 'ada' });

    db.delete(schema.agreementSignature).run();
    const outcome = await syncMember(s.appId, { accessToken: 'access-token' });
    expect(outcome).toEqual({ status: 'skipped', reason: 'not_cleared' });
    expect(guild.members.has('discord-ada')).toBe(false);
  });
});

describe('one account, one student', () => {
  it('will not let a second student claim a linked Discord account', () => {
    const a = seed();
    const b = seed();
    expect(saveLink({ userId: a.studentId, discordUserId: 'shared', username: 'x' })).toBe('linked');
    expect(saveLink({ userId: b.studentId, discordUserId: 'shared', username: 'x' })).toBe('taken');
  });

  it('lets the same student re-link the same account', () => {
    const a = seed();
    expect(saveLink({ userId: a.studentId, discordUserId: 'mine', username: 'x' })).toBe('linked');
    expect(saveLink({ userId: a.studentId, discordUserId: 'mine', username: 'y' })).toBe('linked');
  });
});

describe('revocation', () => {
  /*
   * The participation agreement promises access ends immediately on dismissal.
   * Stripping roles is not enough — a roleless member still reads @everyone.
   */
  it('removes a dismissed student from the guild entirely', async () => {
    const s = seed();
    signEverything(s);
    await ensureRoles({ allowCreate: true });
    saveLink({ userId: s.studentId, discordUserId: 'discord-ada', username: 'ada' });
    await syncMember(s.appId, { accessToken: 'access-token' });
    expect(guild.members.has('discord-ada')).toBe(true);

    expect(await revokeMember(s.studentId)).toBe('removed');
    expect(guild.members.has('discord-ada')).toBe(false);
    expect(guild.calls).toContain('remove:discord-ada');
  });

  it('is harmless for a student who never linked', async () => {
    const s = seed();
    expect(await revokeMember(s.studentId)).toBe('not_linked');
  });
});

describe('reconcile', () => {
  it('reports without touching anything on a dry run', async () => {
    const s = seed();
    signEverything(s);
    saveLink({ userId: s.studentId, discordUserId: 'discord-ada', username: 'ada' });

    const report = await reconcileAll({ dryRun: true });
    expect(report.cleared).toBe(1);
    expect(report.linked).toBe(1);
    // With creation off by default, an absent role is reported, not planned.
    expect(report.rolesCreated).toEqual([]);
    expect(report.rolesMissing).toContain('Quadratic-Forms-2');
    // Nothing was actually created.
    expect(guild.calls).toEqual([]);
    expect(db.select().from(schema.discordRole).all()).toHaveLength(0);
  });

  it('counts a cleared student who has not linked as outstanding', async () => {
    const s = seed();
    signEverything(s);
    const report = await reconcileAll({ dryRun: true });
    expect(report.cleared).toBe(1);
    expect(report.linked).toBe(0);
    expect(report.results[0]!.outcome).toEqual({
      status: 'skipped',
      reason: 'no_discord_link',
    });
  });

  it('skips students who are not cleared', async () => {
    seed();
    const report = await reconcileAll({ dryRun: true });
    expect(report.cleared).toBe(0);
  });
});
