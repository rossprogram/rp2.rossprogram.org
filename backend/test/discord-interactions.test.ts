/*
 * The Discord interactions endpoint: signature verification and /whois.
 *
 * The signature check is the whole security boundary here — this route has no
 * session and no auth guard, because Discord calls it. So the tests sign real
 * payloads with a real ed25519 key rather than mocking the verifier.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto';
import { nanoid } from 'nanoid';

// A keypair standing in for the Discord application's. The public half goes
// into the env as 64 hex characters, exactly as the dashboard presents it.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_HEX = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');

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
process.env.DISCORD_PUBLIC_KEY = PUBLIC_HEX;
process.env.DISCORD_STAFF_ROLE_ID = 'staff-role-id';

const { db } = await import('../src/db/client.js');
const schema = await import('../src/db/schema.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { build } = await import('../src/server.js');

type App = Awaited<ReturnType<typeof build>>;
let app: App;

const now = () => Math.floor(Date.now() / 1000);

function signed(body: unknown, opts: { timestamp?: string; key?: KeyObject } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = opts.timestamp ?? String(now());
  const signature = edSign(
    null,
    Buffer.from(timestamp + raw),
    opts.key ?? privateKey,
  ).toString('hex');
  return {
    payload: raw,
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': signature,
      'x-signature-timestamp': timestamp,
    },
  };
}

function post(body: unknown, opts?: { timestamp?: string; key?: KeyObject }) {
  const { payload, headers } = signed(body, opts);
  return app.inject({ method: 'POST', url: '/api/discord/interactions', headers, payload });
}

/** One enrolled, fully-signed student with a linked Discord account. */
function seedStudent(discordUserId: string) {
  const studentId = nanoid();
  const guardianId = nanoid();
  const appId = nanoid();

  db.insert(schema.user)
    .values([
      { id: studentId, email: 'ada@example.com', createdAt: now() },
      { id: guardianId, email: 'parent@example.com', createdAt: now() },
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
      courseKey: 'quadratic',
      section: 'QUADRATIC-2',
      cohort: '3',
      amountDueCents: 0,
      response: 'accepted',
      notifiedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  db.insert(schema.guardianContact)
    .values({
      applicationId: appId,
      email: 'parent@example.com',
      phone: '+1 555 0100',
      altPhone: null,
      updatedAt: now(),
    })
    .run();
  db.insert(schema.discordLink)
    .values({ userId: studentId, discordUserId, linkedAt: now() })
    .run();

  return { studentId, guardianId, appId };
}

function whois(target: string, opts: { staff?: boolean } = {}) {
  return post({
    type: 2,
    data: { name: 'whois', options: [{ name: 'member', value: target }] },
    member: { user: { id: 'caller' }, roles: opts.staff ? ['staff-role-id'] : [] },
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
  db.delete(schema.guardianContact).run();
  db.delete(schema.agreementSignature).run();
  db.delete(schema.offer).run();
  db.delete(schema.applicationResponse).run();
  db.delete(schema.application).run();
  db.delete(schema.guardianLink).run();
  db.delete(schema.user).run();
});

describe('signature verification', () => {
  it('answers a correctly signed PING with a PONG', async () => {
    const res = await post({ type: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ type: 1 });
  });

  /*
   * Discord requires 401 specifically, and checks it by sending a deliberately
   * bad signature when you save the endpoint URL. A 400 here means the
   * dashboard refuses the URL.
   */
  it('rejects a tampered body with 401', async () => {
    const { headers } = signed({ type: 1 });
    const res = await app.inject({
      method: 'POST',
      url: '/api/discord/interactions',
      headers,
      payload: JSON.stringify({ type: 2 }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a signature from the wrong key', async () => {
    const other = generateKeyPairSync('ed25519');
    const res = await post({ type: 1 }, { key: other.privateKey });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a replayed request with a stale timestamp', async () => {
    const res = await post({ type: 1 }, { timestamp: String(now() - 3600) });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a request with no signature headers at all', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/discord/interactions',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 1 }),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('/whois', () => {
  it('tells a student the name, course, section and group — and nothing else', async () => {
    seedStudent('discord-1');
    const res = await whois('discord-1');
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.type).toBe(4);
    const content: string = body.data.content;

    expect(content).toContain('Alex (Alexander Sheng)');
    expect(content).toContain('Quadratic Forms');
    expect(content).toContain('QUADRATIC-2');
    expect(content).toContain('Group 3');

    // The whole point of the tier: no contact details reach another minor.
    expect(content).not.toContain('ada@example.com');
    expect(content).not.toContain('parent@example.com');
    expect(content).not.toContain('555');
  });

  it('gives staff the contact details', async () => {
    seedStudent('discord-1');
    const res = await whois('discord-1', { staff: true });
    const content: string = res.json().data.content;

    expect(content).toContain('Alex (Alexander Sheng)');
    expect(content).toContain('ada@example.com');
    expect(content).toContain('parent@example.com');
    expect(content).toContain('555 0100');
    expect(content).toContain('enrolled');
  });

  it('always replies ephemerally, so a lookup is never broadcast', async () => {
    seedStudent('discord-1');
    for (const staff of [false, true]) {
      const res = await whois('discord-1', { staff });
      expect(res.json().data.flags).toBe(64);
    }
  });

  it('says nothing useful about an unlinked member', async () => {
    seedStudent('discord-1');
    const res = await whois('somebody-else');
    const content: string = res.json().data.content;
    expect(content).toContain('not a linked student');
  });

  it('does not treat an arbitrary role as the staff role', async () => {
    seedStudent('discord-1');
    const res = await post({
      type: 2,
      data: { name: 'whois', options: [{ name: 'member', value: 'discord-1' }] },
      member: { user: { id: 'caller' }, roles: ['some-other-role', 'another'] },
    });
    expect(res.json().data.content).not.toContain('ada@example.com');
  });

  it('acknowledges an unknown command rather than failing', async () => {
    const res = await post({
      type: 2,
      data: { name: 'nonsense' },
      member: { user: { id: 'caller' }, roles: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().type).toBe(4);
  });
});
