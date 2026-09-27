/*
 * /role: a student picks up a flag role for their country.
 *
 * Signature verification is covered in discord-interactions.test.ts; here the
 * verifier is stubbed so the tests can speak about roles, and the guild is a
 * fake that records what the bot would have done.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { nanoid } from 'nanoid';

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

const guild = {
  roles: [] as { id: string; name: string; position: number; managed: boolean }[],
  created: [] as { name: string; mentionable: boolean | undefined }[],
  calls: [] as string[],
};

vi.mock('../src/integrations/discord/index.js', () => ({
  discordEnabled: () => true,
  addMemberRole: vi.fn(async (id: string, roleId: string) => {
    guild.calls.push(`+${id}:${roleId}`);
  }),
  removeMemberRole: vi.fn(async (id: string, roleId: string) => {
    guild.calls.push(`-${id}:${roleId}`);
  }),
  listGuildRoles: vi.fn(async () => guild.roles),
  createGuildRole: vi.fn(async (name: string, opts?: { mentionable?: boolean }) => {
    const role = { id: `role-${guild.roles.length + 1}`, name, position: 1, managed: false };
    guild.roles.push(role);
    guild.created.push({ name, mentionable: opts?.mentionable });
    return { id: role.id };
  }),
  verifyInteraction: () => true,
  DiscordError: class DiscordError extends Error {},
}));

const { db } = await import('../src/db/client.js');
const schema = await import('../src/db/schema.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { build } = await import('../src/server.js');
const { ensureCountryRoles } = await import('../src/services/discord-country.js');

type App = Awaited<ReturnType<typeof build>>;
let app: App;

const now = () => Math.floor(Date.now() / 1000);

function seed(opts: {
  location: string;
  timezone?: string;
  status?: 'enrolled' | 'rejected';
  discordUserId?: string;
}) {
  const studentId = nanoid();
  const appId = nanoid();
  db.insert(schema.user)
    .values({ id: studentId, email: `${studentId}@example.com`, createdAt: now() })
    .run();
  db.insert(schema.application)
    .values({
      id: appId,
      applicantUserId: studentId,
      status: opts.status ?? 'enrolled',
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  db.insert(schema.applicationResponse)
    .values([
      {
        applicationId: appId,
        questionKey: 'student_location',
        value: JSON.stringify(opts.location),
        updatedAt: now(),
      },
      {
        applicationId: appId,
        questionKey: 'student_timezone',
        value: JSON.stringify(opts.timezone ?? ''),
        updatedAt: now(),
      },
    ])
    .run();
  if (opts.discordUserId) {
    db.insert(schema.discordLink)
      .values({ userId: studentId, discordUserId: opts.discordUserId, linkedAt: now() })
      .run();
  }
  return { studentId, appId };
}

function roleIdFor(code: string): string {
  const row = db.select().from(schema.discordRole).all().find((r) => r.key === code);
  if (!row) throw new Error(`no role for ${code}`);
  return row.roleId;
}

function role(caller: string, roles: string[], country?: string) {
  return app.inject({
    method: 'POST',
    url: '/api/discord/interactions',
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': '00',
      'x-signature-timestamp': String(now()),
    },
    payload: JSON.stringify({
      type: 2,
      data: {
        name: 'role',
        ...(country ? { options: [{ name: 'country', value: country }] } : {}),
      },
      member: { user: { id: caller }, roles },
    }),
  });
}

function autocomplete(typed: string) {
  return app.inject({
    method: 'POST',
    url: '/api/discord/interactions',
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': '00',
      'x-signature-timestamp': String(now()),
    },
    payload: JSON.stringify({
      type: 4,
      data: { name: 'role', options: [{ name: 'country', value: typed, focused: true }] },
      member: { user: { id: 'caller' }, roles: [] },
    }),
  });
}

beforeAll(async () => {
  runMigrations();
  app = await build();
  await app.ready();
});

beforeEach(() => {
  db.delete(schema.discordLink).run();
  db.delete(schema.discordRole).run();
  db.delete(schema.applicationResponse).run();
  db.delete(schema.application).run();
  db.delete(schema.user).run();
  guild.roles = [];
  guild.created = [];
  guild.calls = [];
});

describe('creating country roles', () => {
  it('makes one flag role per country among enrolled students', async () => {
    seed({ location: 'Shanghai/China' });
    seed({ location: 'Beijing' });
    seed({ location: 'NJ / USA' });
    seed({ location: 'Mumbai/India' });

    const plan = await ensureCountryRoles();
    expect(plan.created.sort()).toEqual(['🇨🇳 China', '🇮🇳 India', '🇺🇸 United States']);
    expect(plan.tally.get('CN')).toBe(2);
  });

  it('makes them unmentionable, so nobody can ping a whole country of minors', async () => {
    seed({ location: 'China' });
    await ensureCountryRoles();
    expect(guild.created).toEqual([{ name: '🇨🇳 China', mentionable: false }]);
  });

  it('counts only enrolled students unless asked for every applicant', async () => {
    seed({ location: 'China' });
    seed({ location: 'Norway', status: 'rejected' });

    const enrolled = await ensureCountryRoles({ dryRun: true });
    expect(enrolled.created).toEqual(['🇨🇳 China']);

    const all = await ensureCountryRoles({ dryRun: true, scope: 'applicants' });
    expect(all.created.sort()).toEqual(['🇨🇳 China', '🇳🇴 Norway']);
  });

  it('writes nothing on a dry run', async () => {
    seed({ location: 'China' });
    await ensureCountryRoles({ dryRun: true });
    expect(guild.created).toEqual([]);
    expect(db.select().from(schema.discordRole).all()).toEqual([]);
  });

  it('adopts a role someone already made by hand', async () => {
    guild.roles.push({ id: 'hand-made', name: '🇨🇳 China', position: 3, managed: false });
    seed({ location: 'China' });

    const plan = await ensureCountryRoles();
    expect(plan.adopted).toEqual(['🇨🇳 China']);
    expect(guild.created).toEqual([]);
    expect(roleIdFor('CN')).toBe('hand-made');
  });

  it('is a no-op the second time', async () => {
    seed({ location: 'China' });
    await ensureCountryRoles();
    const again = await ensureCountryRoles();
    expect(again.created).toEqual([]);
    expect(again.existing).toEqual(['🇨🇳 China']);
  });

  it('reports what it could not place, rather than guessing', async () => {
    const { appId } = seed({ location: 'Province: Faysal' });
    const plan = await ensureCountryRoles({ dryRun: true });
    expect(plan.unresolved.map((p) => p.applicationId)).toEqual([appId]);
    expect(plan.created).toEqual([]);
  });
});

describe('/role', () => {
  beforeEach(async () => {
    seed({ location: 'Shanghai/China', discordUserId: 'discord-ada' });
    seed({ location: 'Mumbai/India' });
    await ensureCountryRoles();
  });

  it('gives a student the country on their application', async () => {
    const res = await role('discord-ada', []);
    expect(res.json().data.content).toContain('🇨🇳 China');
    expect(res.json().data.flags).toBe(64);
    expect(guild.calls).toEqual([`+discord-ada:${roleIdFor('CN')}`]);
  });

  it('takes it off when they run it again', async () => {
    const res = await role('discord-ada', [roleIdFor('CN')]);
    expect(res.json().data.content).toContain('Removed');
    expect(guild.calls).toEqual([`-discord-ada:${roleIdFor('CN')}`]);
  });

  it('lets them pick another, and swaps rather than stacking', async () => {
    const res = await role('discord-ada', [roleIdFor('CN'), 'section-role'], 'IN');
    expect(res.json().data.content).toContain('🇮🇳 India');
    expect(guild.calls).toEqual([
      `-discord-ada:${roleIdFor('CN')}`,
      `+discord-ada:${roleIdFor('IN')}`,
    ]);
  });

  it('accepts a typed name as well as the autocompleted code', async () => {
    await role('discord-ada', [], 'india');
    expect(guild.calls).toEqual([`+discord-ada:${roleIdFor('IN')}`]);
  });

  it('will not invent a role for a country nobody resolved to', async () => {
    const res = await role('discord-ada', [], 'Norway');
    expect(res.json().data.content).toContain('no role');
    expect(guild.calls).toEqual([]);
    expect(guild.created.map((r) => r.name)).not.toContain('🇳🇴 Norway');
  });

  it('asks an unlinked member to pick, rather than guessing', async () => {
    const res = await role('staff-member', []);
    expect(res.json().data.content).toContain('/role country:');
    expect(guild.calls).toEqual([]);
  });

  it('lets an unlinked member pick explicitly', async () => {
    await role('staff-member', [], 'CN');
    expect(guild.calls).toEqual([`+staff-member:${roleIdFor('CN')}`]);
  });

  it('autocompletes from the roles that exist', async () => {
    const res = await autocomplete('ind');
    expect(res.json()).toEqual({
      type: 8,
      data: { choices: [{ name: '🇮🇳 India', value: 'IN' }] },
    });

    const all = await autocomplete('');
    expect(all.json().data.choices.map((c: { value: string }) => c.value)).toEqual(['CN', 'IN']);
  });
});
