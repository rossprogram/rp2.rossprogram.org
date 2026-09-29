/*
 * With APPLICATIONS_OPEN false, nobody can start or finish an application,
 * but anyone already submitted — including a family still waiting on the
 * guardian's signature — carries on as before.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { nanoid } from 'nanoid';

// Must be set before anything imports env.ts.
process.env.DATABASE_URL = ':memory:';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-pass-zod';
process.env.EMAIL_TRANSPORT = 'console';
process.env.PAYMENTS_ENABLED = 'false';
process.env.DISCORD_ENABLED = 'false';

vi.mock('../src/integrations/email/ses.js', () => ({
  sendEmail: vi.fn(async () => {}),
}));

const { db } = await import('../src/db/client.js');
const schema = await import('../src/db/schema.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { build } = await import('../src/server.js');
const { APPLICATIONS_OPEN } = await import('@rp2/shared');

type App = Awaited<ReturnType<typeof build>>;
let app: App;

const now = () => Math.floor(Date.now() / 1000);

function seed(status: 'draft' | 'awaiting_guardian', role = 'applicant') {
  const userId = nanoid();
  const appId = nanoid();
  db.insert(schema.user).values({ id: userId, email: `${userId}@example.com`, createdAt: now() }).run();
  db.insert(schema.userRole).values({ userId, role: role as 'applicant', grantedAt: now() }).run();
  db.insert(schema.application)
    .values({ id: appId, applicantUserId: userId, status, createdAt: now(), updatedAt: now() })
    .run();
  return { userId, appId };
}

function cookie(userId: string): string {
  const sid = nanoid();
  db.insert(schema.session)
    .values({ id: sid, userId, createdAt: now(), expiresAt: now() + 3600 })
    .run();
  return `rp2_sid=${app.signCookie(sid)}`;
}

beforeAll(async () => {
  runMigrations();
  app = await build();
  await app.ready();
});

beforeEach(() => {
  db.delete(schema.applicationResponse).run();
  db.delete(schema.application).run();
  db.delete(schema.session).run();
  db.delete(schema.userRole).run();
  db.delete(schema.user).run();
});

describe.runIf(!APPLICATIONS_OPEN)('applications closed', () => {
  it('refuses to save a draft', async () => {
    const s = seed('draft');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/application/me/responses',
      headers: { cookie: cookie(s.userId) },
      payload: { responses: { student_school: 'Some School' } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('applications_closed');
    expect(db.select().from(schema.applicationResponse).all()).toHaveLength(0);
  });

  it('refuses to submit a draft', async () => {
    const s = seed('draft');
    const res = await app.inject({
      method: 'POST',
      url: '/api/application/me/submit',
      headers: { cookie: cookie(s.userId) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('applications_closed');
    expect(db.select().from(schema.application).get()!.status).toBe('draft');
  });

  it('refuses a draft upload', async () => {
    const s = seed('draft');
    const res = await app.inject({
      method: 'POST',
      url: '/api/uploads/sign',
      headers: { cookie: cookie(s.userId) },
      payload: { kind: 'transcript', filename: 't.pdf', contentType: 'application/pdf', size: 100 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('applications_closed');
  });

  it('still lets an application awaiting its guardian be edited', async () => {
    const s = seed('awaiting_guardian');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/application/me/responses',
      headers: { cookie: cookie(s.userId) },
      payload: { responses: { student_school: 'Some School' } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a parent inviting a new student', async () => {
    const parent = nanoid();
    db.insert(schema.user).values({ id: parent, email: 'p@example.com', createdAt: now() }).run();
    db.insert(schema.userRole).values({ userId: parent, role: 'guardian', grantedAt: now() }).run();
    const res = await app.inject({
      method: 'POST',
      url: '/api/parent/invite-applicant',
      headers: { cookie: cookie(parent) },
      payload: { applicantEmail: 'kid@example.com', relationship: 'parent' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('applications_closed');
    expect(db.select().from(schema.user).all()).toHaveLength(1);
  });
});
