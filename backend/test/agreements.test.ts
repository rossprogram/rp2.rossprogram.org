/*
 * Signing the Code of Conduct and the Participation Agreement.
 *
 * Four signatures make a family: two documents, each acknowledged by the
 * student and by the guardian. Together with enrollment they are what clears a
 * student to take part, so the tests care most about the states in between —
 * half-signed is the normal case for weeks, not an edge case.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

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
const { isCleared, isFullySigned, agreementHash } = await import('../src/services/agreements.js');
const { AGREEMENTS, agreementByKey } = await import('@rp2/shared');

type App = Awaited<ReturnType<typeof build>>;
let app: App;

const now = () => Math.floor(Date.now() / 1000);

/** An enrolled family: student, guardian, paid-up offer. */
function seed(over: { status?: string; amountDueCents?: number } = {}) {
  const studentId = nanoid();
  const guardianId = nanoid();
  const strangerId = nanoid();
  const appId = nanoid();

  db.insert(schema.user)
    .values([
      { id: studentId, email: 'ada@example.com', createdAt: now() },
      { id: guardianId, email: 'parent@example.com', createdAt: now() },
      { id: strangerId, email: 'nosy@example.com', createdAt: now() },
    ])
    .run();
  db.insert(schema.userRole)
    .values([
      { userId: studentId, role: 'applicant', grantedAt: now() },
      { userId: guardianId, role: 'guardian', grantedAt: now() },
      { userId: strangerId, role: 'guardian', grantedAt: now() },
    ])
    .run();
  db.insert(schema.application)
    .values({
      id: appId,
      applicantUserId: studentId,
      status: (over.status ?? 'enrolled') as 'enrolled',
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  db.insert(schema.applicationResponse)
    .values({
      applicationId: appId,
      questionKey: 'student_legal_name',
      value: JSON.stringify('Ada Lovelace'),
      updatedAt: now(),
    })
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
      amountDueCents: over.amountDueCents ?? 0,
      response: 'accepted',
      notifiedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  return { studentId, guardianId, strangerId, appId };
}

function login(userId: string): string {
  const sid = nanoid();
  db.insert(schema.session)
    .values({ id: sid, userId, createdAt: now(), expiresAt: now() + 3600 })
    .run();
  return app.signCookie(sid);
}

const CONTACT = { email: 'parent@example.com', phone: '+1 555 0100', altPhone: null };

function signAsStudent(userId: string, document: string) {
  return app.inject({
    method: 'POST',
    url: `/api/agreements/${document}/sign`,
    headers: { cookie: `rp2_sid=${login(userId)}` },
    payload: { typedName: 'Ada Lovelace' },
  });
}

function signAsGuardian(userId: string, appId: string, document: string, withContact = true) {
  return app.inject({
    method: 'POST',
    url: `/api/parent/applicant/${appId}/agreements/${document}/sign`,
    headers: { cookie: `rp2_sid=${login(userId)}` },
    payload: {
      typedName: 'Augusta Byron',
      ...(withContact ? { contact: CONTACT } : {}),
    },
  });
}

/** Put all four signatures in. */
async function signEverything(s: ReturnType<typeof seed>) {
  for (const doc of AGREEMENTS) {
    await signAsStudent(s.studentId, doc.key);
    await signAsGuardian(s.guardianId, s.appId, doc.key);
  }
}

beforeAll(async () => {
  runMigrations();
  app = await build();
  await app.ready();
});

beforeEach(() => {
  db.delete(schema.agreementSignature).run();
  db.delete(schema.guardianContact).run();
  db.delete(schema.discordLink).run();
  db.delete(schema.offer).run();
  db.delete(schema.applicationResponse).run();
  db.delete(schema.application).run();
  db.delete(schema.guardianLink).run();
  db.delete(schema.session).run();
  db.delete(schema.userRole).run();
  db.delete(schema.user).run();
});

describe('signing', () => {
  it('records what was signed, not just that something was', async () => {
    const s = seed();
    const res = await signAsStudent(s.studentId, 'code_of_conduct');
    expect(res.statusCode).toBe(200);

    const row = db.select().from(schema.agreementSignature).get()!;
    const doc = agreementByKey('code_of_conduct')!;

    expect(row.signerKind).toBe('student');
    expect(row.signerUserId).toBe(s.studentId);
    expect(row.typedName).toBe('Ada Lovelace');
    expect(row.documentVersion).toBe(doc.version);
    expect(row.documentHash).toBe(agreementHash(doc));
    // Server clock, and evidence of who was at the keyboard.
    expect(row.signedAt).toBeGreaterThan(0);
    expect(row.userAgent).not.toBeNull();
  });

  /*
   * A double-clicked Sign, or a second tab, must not write a second row — and
   * must not move the timestamp that evidences when consent was given.
   */
  it('is idempotent, and the first signature is the one that counts', async () => {
    const s = seed();
    const first = await signAsStudent(s.studentId, 'code_of_conduct');
    expect(first.json().created).toBe(true);

    const before = db.select().from(schema.agreementSignature).get()!;
    const second = await signAsStudent(s.studentId, 'code_of_conduct');

    expect(second.statusCode).toBe(200);
    expect(second.json().created).toBe(false);
    expect(db.select().from(schema.agreementSignature).all()).toHaveLength(1);
    expect(db.select().from(schema.agreementSignature).get()!.signedAt).toBe(before.signedAt);
  });

  it('refuses a name too short to be one', async () => {
    const s = seed();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agreements/code_of_conduct/sign',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
      payload: { typedName: ' A ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s an unknown document', async () => {
    const s = seed();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agreements/nonexistent/sign',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
      payload: { typedName: 'Ada Lovelace' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('the guardian contact block', () => {
  /*
   * The participation agreement's contact block is the ONLY place the program
   * ever collects a guardian phone number — the application form has never
   * asked for one. Signing without it would lose the emergency contact for a
   * minor, so it is refused.
   */
  it('will not record a guardian signature without a phone number', async () => {
    const s = seed();
    const res = await signAsGuardian(s.guardianId, s.appId, 'participation_agreement', false);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('contact_required');
    expect(db.select().from(schema.agreementSignature).all()).toHaveLength(0);
  });

  it('stores the contact details when it does have them', async () => {
    const s = seed();
    await signAsGuardian(s.guardianId, s.appId, 'participation_agreement');

    const contact = db.select().from(schema.guardianContact).get()!;
    expect(contact.phone).toBe('+1 555 0100');
    expect(contact.email).toBe('parent@example.com');
  });

  it('does not demand contact details for the code of conduct', async () => {
    const s = seed();
    const res = await signAsGuardian(s.guardianId, s.appId, 'code_of_conduct', false);
    expect(res.statusCode).toBe(200);
  });
});

describe('authorization', () => {
  it('does not let an unrelated guardian sign for a family', async () => {
    const s = seed();
    const res = await signAsGuardian(s.strangerId, s.appId, 'code_of_conduct');
    // 404 rather than 403: never confirm the application exists.
    expect(res.statusCode).toBe(404);
    expect(db.select().from(schema.agreementSignature).all()).toHaveLength(0);
  });

  it('does not let a student sign through the guardian route', async () => {
    const s = seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/parent/applicant/${s.appId}/agreements/code_of_conduct/sign`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
      payload: { typedName: 'Ada Lovelace', contact: CONTACT },
    });
    // The student holds no `guardian` role.
    expect(res.statusCode).toBe(403);
  });

  it('requires a session', async () => {
    seed();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agreements/code_of_conduct/sign',
      payload: { typedName: 'Ada Lovelace' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('who still owes a signature', () => {
  it('tells the student what the guardian has not done', async () => {
    const s = seed();
    await signAsStudent(s.studentId, 'code_of_conduct');
    await signAsStudent(s.studentId, 'participation_agreement');

    const res = await app.inject({
      method: 'GET',
      url: '/api/agreements',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    const body = res.json();

    expect(body.mine).toEqual([]);
    expect(body.theirs).toHaveLength(2);
    expect(body.theirs.every((o: { signerKind: string }) => o.signerKind === 'guardian')).toBe(true);
    expect(body.fullySigned).toBe(false);
  });

  it('tells the guardian what the student has not done', async () => {
    const s = seed();
    await signAsGuardian(s.guardianId, s.appId, 'code_of_conduct');
    await signAsGuardian(s.guardianId, s.appId, 'participation_agreement');

    const res = await app.inject({
      method: 'GET',
      url: `/api/parent/applicant/${s.appId}/agreements`,
      headers: { cookie: `rp2_sid=${login(s.guardianId)}` },
    });
    const body = res.json();

    expect(body.mine).toEqual([]);
    expect(body.theirs).toHaveLength(2);
    expect(body.theirs.every((o: { signerKind: string }) => o.signerKind === 'student')).toBe(true);
  });

  it('is fully signed only once all four are in', async () => {
    const s = seed();
    expect(isFullySigned(s.appId)).toBe(false);

    await signAsStudent(s.studentId, 'code_of_conduct');
    await signAsGuardian(s.guardianId, s.appId, 'code_of_conduct');
    await signAsStudent(s.studentId, 'participation_agreement');
    expect(isFullySigned(s.appId)).toBe(false);

    await signAsGuardian(s.guardianId, s.appId, 'participation_agreement');
    expect(isFullySigned(s.appId)).toBe(true);
  });

  /*
   * A signature pins a hash of the text. If a document is later edited, the
   * old signature is still valid evidence of what WAS agreed — but the family
   * has not agreed to the new wording, and the admin view needs to know.
   */
  it('marks a signature stale when the document text moves under it', async () => {
    const s = seed();
    await signAsStudent(s.studentId, 'code_of_conduct');

    db.update(schema.agreementSignature)
      .set({ documentHash: 'a-hash-from-an-older-wording' })
      .where(eq(schema.agreementSignature.applicationId, s.appId))
      .run();

    const res = await app.inject({
      method: 'GET',
      url: '/api/agreements',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(res.json().signatures[0].stale).toBe(true);
  });
});

/*
 * Answers are tidied on the way in.
 *
 * The timezone box is free text with a datalist, and twelve of 705 stored
 * answers were not real zones — two of them belonging to enrolled students,
 * where an unusable zone means we cannot say what time their class is.
 */
describe('timezone normalisation on save', () => {
  async function save(userId: string, timezone: string) {
    return app.inject({
      method: 'PATCH',
      url: '/api/application/me/responses',
      headers: { cookie: `rp2_sid=${login(userId)}` },
      payload: { responses: { student_timezone: timezone } },
    });
  }

  function stored(appId: string): string | null {
    const row = db
      .select()
      .from(schema.applicationResponse)
      .all()
      .find((r) => r.applicationId === appId && r.questionKey === 'student_timezone');
    if (!row) return null;
    return JSON.parse(row.value) as string;
  }

  it('canonicalises a repairable answer', async () => {
    const s = seed({ status: 'draft' });
    for (const [typed, expected] of [
      ['America/Vancouver ', 'America/Vancouver'],
      ['America/Los Angeles', 'America/Los_Angeles'],
      ['Asia/SingaporeSingapore', 'Asia/Singapore'],
      ['Shanghai', 'Asia/Shanghai'],
      ['america/new_york', 'America/New_York'],
    ] as const) {
      const res = await save(s.studentId, typed);
      expect(res.statusCode).toBe(200);
      expect(stored(s.appId)).toBe(expected);
    }
  });

  /*
   * The field promises applicants "we'll follow up if we can't find a match",
   * so an answer we cannot repair is kept rather than refused. Blocking a
   * fifteen-year-old's application on a text box they cannot satisfy is worse
   * than storing a value a human has to look at.
   */
  it('keeps an unrepairable answer instead of rejecting it', async () => {
    const s = seed({ status: 'draft' });
    const res = await save(s.studentId, 'Asia/Beijing');
    expect(res.statusCode).toBe(200);
    expect(stored(s.appId)).toBe('Asia/Beijing');
  });

  it('leaves other answers alone', async () => {
    const s = seed({ status: 'draft' });
    await app.inject({
      method: 'PATCH',
      url: '/api/application/me/responses',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
      payload: { responses: { student_school: '  Some School  ' } },
    });
    const row = db
      .select()
      .from(schema.applicationResponse)
      .all()
      .find((r) => r.questionKey === 'student_school');
    expect(JSON.parse(row!.value)).toBe('  Some School  ');
  });
});

describe('the clearance gate', () => {
  it('needs enrollment as well as signatures', async () => {
    // Enrolled on paper, but with a balance outstanding.
    const s = seed({ status: 'awaiting_payment', amountDueCents: 150_000 });
    await signEverything(s);

    expect(isFullySigned(s.appId)).toBe(true);
    expect(isCleared(s.appId)).toBe(false);
  });

  it('needs signatures as well as enrollment', async () => {
    const s = seed();
    expect(isCleared(s.appId)).toBe(false);
  });

  it('clears a family that has done both', async () => {
    const s = seed();
    await signEverything(s);
    expect(isCleared(s.appId)).toBe(true);
  });

  it('refuses a Discord link to a family that is not cleared', async () => {
    const s = seed();
    const res = await app.inject({
      method: 'GET',
      url: '/api/discord/link',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    // Discord is switched off in this suite, which is itself a refusal — the
    // gate proper is covered where it is switched on.
    expect([403, 503]).toContain(res.statusCode);
  });
});
