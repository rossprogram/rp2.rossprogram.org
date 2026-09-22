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
const { isCleared, isFullySigned, agreementHash, suspectSignatures } = await import(
  '../src/services/agreements.js'
);
const { AGREEMENTS, agreementByKey } = await import('@rp2/shared');

type App = Awaited<ReturnType<typeof build>>;
let app: App;

const now = () => Math.floor(Date.now() / 1000);

/** An enrolled family: student, guardian, paid-up offer. */
function seed(
  over: { status?: string; amountDueCents?: number; guardianName?: string } = {},
) {
  const studentId = nanoid();
  const guardianId = nanoid();
  const strangerId = nanoid();
  const adminId = nanoid();
  const appId = nanoid();

  db.insert(schema.user)
    .values([
      { id: studentId, email: 'ada@example.com', createdAt: now() },
      { id: guardianId, email: 'parent@example.com', createdAt: now() },
      { id: strangerId, email: 'nosy@example.com', createdAt: now() },
      { id: adminId, email: 'jim@example.com', createdAt: now() },
    ])
    .run();
  db.insert(schema.userRole)
    .values([
      { userId: studentId, role: 'applicant', grantedAt: now() },
      { userId: guardianId, role: 'guardian', grantedAt: now() },
      { userId: strangerId, role: 'guardian', grantedAt: now() },
      { userId: adminId, role: 'admin', grantedAt: now() },
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
    .values([
      {
        applicationId: appId,
        questionKey: 'student_legal_name',
        value: JSON.stringify('Ada Lovelace'),
        updatedAt: now(),
      },
      // Both names, because the signing guard compares them: a family where
      // the application carries no guardian name is the unusual case, not the
      // default one.
      {
        applicationId: appId,
        questionKey: 'guardian_name',
        value: JSON.stringify(over.guardianName ?? 'Augusta Byron'),
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
      amountDueCents: over.amountDueCents ?? 0,
      response: 'accepted',
      notifiedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  return { studentId, guardianId, strangerId, adminId, appId };
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
  db.delete(schema.agreementSignatureVoid).run();
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

/*
 * The wrong person at the keyboard.
 *
 * The participation agreement is written in the guardian's voice — "I, the
 * undersigned, as parent or guardian..." — and the participant's line sits
 * directly beneath it. Read aloud in a living room, on whichever browser is
 * already logged in, the parent types their own name into the student's box.
 * Nine enrolled families did exactly that, and none could undo it: signing is
 * idempotent, so signing again changed nothing.
 */
describe('signing as the wrong person', () => {
  it('refuses the guardian’s name on the participant’s line', async () => {
    const s = seed();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agreements/participation_agreement/sign',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
      payload: { typedName: 'Augusta Byron' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('wrong_person');
    expect(db.select().from(schema.agreementSignature).all()).toHaveLength(0);
  });

  it('refuses the participant’s name on the guardian’s line', async () => {
    const s = seed();
    const res = await app.inject({
      method: 'POST',
      url: `/api/parent/applicant/${s.appId}/agreements/participation_agreement/sign`,
      headers: { cookie: `rp2_sid=${login(s.guardianId)}` },
      payload: { typedName: 'Ada Lovelace', contact: CONTACT },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('wrong_person');
    expect(db.select().from(schema.agreementSignature).all()).toHaveLength(0);
  });

  it('applies to the code of conduct too', async () => {
    const s = seed();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agreements/code_of_conduct/sign',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
      payload: { typedName: 'Augusta Byron' },
    });
    expect(res.statusCode).toBe(409);
  });

  /*
   * Spelling drift is normal and must not block a family. The comparison
   * ignores case, accents, punctuation, word order, and whether the name was
   * written solid — all of which appear in the real data.
   */
  it('recognises the other party’s name however it is spelled', async () => {
    for (const typed of ['augusta byron', 'Byron Augusta', 'AugustaByron', 'Augusta  Byron.']) {
      db.delete(schema.agreementSignature).run();
      db.delete(schema.applicationResponse).run();
      db.delete(schema.offer).run();
      db.delete(schema.application).run();
      db.delete(schema.guardianLink).run();
      db.delete(schema.session).run();
      db.delete(schema.userRole).run();
      db.delete(schema.user).run();

      const s = seed();
      const res = await app.inject({
        method: 'POST',
        url: '/api/agreements/code_of_conduct/sign',
        headers: { cookie: `rp2_sid=${login(s.studentId)}` },
        payload: { typedName: typed },
      });
      expect(res.json().error, typed).toBe('wrong_person');
    }
  });

  it('allows a name that is neither party’s — a nickname is not a forgery', async () => {
    const s = seed();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agreements/code_of_conduct/sign',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
      payload: { typedName: 'Ada King' },
    });
    expect(res.statusCode).toBe(200);
  });

  /*
   * Some applications carry the same name for both parties — a parent who
   * filled the whole form in under their own name. There is nothing to tell
   * apart there, and that family must still be able to sign.
   */
  it('does not lock out a family recorded under one name', async () => {
    const s = seed({ guardianName: 'Ada Lovelace' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/agreements/code_of_conduct/sign',
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
      payload: { typedName: 'Ada Lovelace' },
    });
    expect(res.statusCode).toBe(200);
  });
});

/*
 * Voiding.
 *
 * The only way to undo a signature. Admin-only, requires a reason, and keeps
 * the whole of the original row — a consent record you can quietly erase is
 * not a consent record.
 */
describe('voiding a signature', () => {
  function voidIt(
    userId: string,
    appId: string,
    body: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: `/api/admin/agreements/${appId}/void`,
      headers: { cookie: `rp2_sid=${login(userId)}` },
      payload: {
        document: 'participation_agreement',
        signerKind: 'student',
        reason: 'Parent signed the participant line by mistake; family emailed.',
        ...body,
      },
    });
  }

  /** The student signs their own line, wrongly, before the guard existed. */
  function forceWrongSignature(s: ReturnType<typeof seed>) {
    db.insert(schema.agreementSignature)
      .values({
        id: nanoid(),
        applicationId: s.appId,
        document: 'participation_agreement',
        signerKind: 'student',
        signerUserId: s.studentId,
        typedName: 'Augusta Byron',
        documentVersion: agreementByKey('participation_agreement')!.version,
        documentHash: agreementHash(agreementByKey('participation_agreement')!),
        signedAt: now(),
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      })
      .run();
  }

  it('keeps the whole of the voided signature, plus who and why', async () => {
    const s = seed();
    forceWrongSignature(s);

    const res = await voidIt(s.adminId, s.appId);
    expect(res.statusCode).toBe(200);

    expect(db.select().from(schema.agreementSignature).all()).toHaveLength(0);

    const tomb = db.select().from(schema.agreementSignatureVoid).get()!;
    expect(tomb.typedName).toBe('Augusta Byron');
    expect(tomb.signerKind).toBe('student');
    expect(tomb.signerUserId).toBe(s.studentId);
    expect(tomb.ip).toBe('203.0.113.7');
    expect(tomb.userAgent).toBe('Mozilla/5.0');
    expect(tomb.documentHash).toBe(agreementHash(agreementByKey('participation_agreement')!));
    expect(tomb.voidedByUserId).toBe(s.adminId);
    expect(tomb.reason).toContain('Parent signed the participant line');
  });

  it('puts the slot back to outstanding, and un-clears the student', async () => {
    const s = seed();
    await signEverything(s);
    expect(isCleared(s.appId)).toBe(true);

    const res = await voidIt(s.adminId, s.appId);
    expect(res.statusCode).toBe(200);
    expect(res.json().fullySigned).toBe(false);
    expect(res.json().outstanding).toEqual([
      { document: 'participation_agreement', signerKind: 'student' },
    ]);
    expect(isCleared(s.appId)).toBe(false);
  });

  /*
   * The whole point. Before voiding, re-signing is an idempotent no-op that
   * leaves the wrong name in place — which is why the nine families could not
   * fix this themselves.
   */
  it('lets the right person sign afterwards', async () => {
    const s = seed();
    forceWrongSignature(s);

    const blocked = await signAsStudent(s.studentId, 'participation_agreement');
    expect(blocked.json().created).toBe(false);
    expect(db.select().from(schema.agreementSignature).get()!.typedName).toBe('Augusta Byron');

    await voidIt(s.adminId, s.appId);

    const after = await signAsStudent(s.studentId, 'participation_agreement');
    expect(after.json().created).toBe(true);
    expect(db.select().from(schema.agreementSignature).get()!.typedName).toBe('Ada Lovelace');
  });

  it('demands a reason', async () => {
    const s = seed();
    forceWrongSignature(s);

    const res = await voidIt(s.adminId, s.appId, { reason: 'oops' });
    expect(res.statusCode).toBe(400);
    expect(db.select().from(schema.agreementSignature).all()).toHaveLength(1);
    expect(db.select().from(schema.agreementSignatureVoid).all()).toHaveLength(0);
  });

  it('404s an empty slot rather than writing an empty tombstone', async () => {
    const s = seed();
    const res = await voidIt(s.adminId, s.appId);
    expect(res.statusCode).toBe(404);
    expect(db.select().from(schema.agreementSignatureVoid).all()).toHaveLength(0);
  });

  it('is admin-only — a guardian cannot void their own signature', async () => {
    const s = seed();
    forceWrongSignature(s);

    for (const userId of [s.guardianId, s.studentId]) {
      const res = await voidIt(userId, s.appId);
      expect(res.statusCode).toBe(403);
    }
    expect(db.select().from(schema.agreementSignature).all()).toHaveLength(1);
  });
});

/*
 * The backwards-looking half of the same rule.
 *
 * The signing guard only helps from the day it ships. The nine families who
 * already tripped over it are not outstanding — they read as fully signed —
 * so nothing else on the admin screen would ever surface them.
 */
describe('finding signatures the wrong person made', () => {
  it('flags the guardian’s name on the participant’s line', async () => {
    const s = seed();
    db.insert(schema.agreementSignature)
      .values({
        id: nanoid(),
        applicationId: s.appId,
        document: 'participation_agreement',
        signerKind: 'student',
        signerUserId: s.studentId,
        typedName: 'Augusta Byron',
        documentVersion: '2026-09-04',
        documentHash: 'x',
        signedAt: now(),
      })
      .run();

    const found = suspectSignatures();
    expect(found).toHaveLength(1);
    expect(found[0]!.typedName).toBe('Augusta Byron');
    expect(found[0]!.signerKind).toBe('student');
    expect(found[0]!.studentName).toBe('Ada Lovelace');
    expect(found[0]!.guardianName).toBe('Augusta Byron');
    // The telling detail: it came from the student's own portal account.
    expect(found[0]!.signedFromEmail).toBe('ada@example.com');
  });

  it('leaves correctly signed families alone', async () => {
    const s = seed();
    await signEverything(s);
    expect(suspectSignatures()).toEqual([]);
  });

  it('says nothing about a family recorded under one name', async () => {
    const s = seed({ guardianName: 'Ada Lovelace' });
    await signAsStudent(s.studentId, 'code_of_conduct');
    expect(suspectSignatures()).toEqual([]);
  });

  it('ignores a family that is not enrolled', async () => {
    const s = seed({ status: 'withdrawn' });
    db.insert(schema.agreementSignature)
      .values({
        id: nanoid(),
        applicationId: s.appId,
        document: 'code_of_conduct',
        signerKind: 'student',
        signerUserId: s.studentId,
        typedName: 'Augusta Byron',
        documentVersion: '2026-09-21',
        documentHash: 'x',
        signedAt: now(),
      })
      .run();
    expect(suspectSignatures()).toEqual([]);
  });

  it('shows a void on the admin list once one has happened', async () => {
    const s = seed();
    await signEverything(s);
    await app.inject({
      method: 'POST',
      url: `/api/admin/agreements/${s.appId}/void`,
      headers: { cookie: `rp2_sid=${login(s.adminId)}` },
      payload: {
        document: 'code_of_conduct',
        signerKind: 'student',
        reason: 'Signed by the parent in error, confirmed by email.',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/agreements',
      headers: { cookie: `rp2_sid=${login(s.adminId)}` },
    });
    const body = res.json();

    expect(body.voids).toHaveLength(1);
    expect(body.voids[0].voidedByEmail).toBe('jim@example.com');
    expect(body.voids[0].studentName).toBe('Ada Lovelace');
    expect(body.voids[0].reason).toContain('Signed by the parent in error');
    // And the family is back on the chase list.
    expect(body.outstandingCount).toBe(1);
  });
});

/*
 * The second detection rule.
 *
 * The first one leans on the guardian name recorded on the application, and in
 * the real data that name is sometimes an English name the parent never signs
 * with ("Rachel Gu" on file, "YANWEN GU" typed) or simply misspelled
 * ("JIOAJIOA HU" against "Jiaojiao Hu"). One name standing in both halves of a
 * document two different people are supposed to sign needs none of that.
 */
describe('one name in both halves of a document', () => {
  function put(
    s: ReturnType<typeof seed>,
    signerKind: 'student' | 'guardian',
    typedName: string,
    document = 'code_of_conduct' as const,
  ) {
    db.insert(schema.agreementSignature)
      .values({
        id: nanoid(),
        applicationId: s.appId,
        document,
        signerKind,
        signerUserId: signerKind === 'student' ? s.studentId : s.guardianId,
        typedName,
        documentVersion: '2026-09-21',
        documentHash: 'x',
        signedAt: now(),
      })
      .run();
  }

  /*
   * The case rule one cannot see: the shared name matches neither party on
   * file, so nothing says which half is wrong. Both go on the list.
   */
  it('lists both halves when the shared name matches neither party', () => {
    const s = seed();
    put(s, 'student', 'Yanwen Gu');
    put(s, 'guardian', 'Yanwen Gu');

    const found = suspectSignatures();
    expect(found).toHaveLength(2);
    expect(found.every((f) => f.reason === 'duplicate_of_other_slot')).toBe(true);
    expect(found.map((f) => f.signerKind).sort()).toEqual(['guardian', 'student']);
  });

  it('lists only the student’s half when the shared name is the guardian’s', () => {
    const s = seed();
    put(s, 'student', 'Augusta Byron');
    put(s, 'guardian', 'Augusta Byron');

    const found = suspectSignatures();
    expect(found).toHaveLength(1);
    expect(found[0]!.signerKind).toBe('student');
    // Rule one saw this first and is the more specific explanation.
    expect(found[0]!.reason).toBe('other_partys_name');
  });

  it('lists only the guardian’s half when the shared name is the student’s', () => {
    const s = seed();
    put(s, 'student', 'Ada Lovelace');
    put(s, 'guardian', 'Ada Lovelace');

    const found = suspectSignatures();
    expect(found).toHaveLength(1);
    expect(found[0]!.signerKind).toBe('guardian');
  });

  it('says nothing when the two halves carry different names', async () => {
    const s = seed();
    await signEverything(s);
    expect(suspectSignatures()).toEqual([]);
  });

  it('does not flag a family recorded under one name', () => {
    const s = seed({ guardianName: 'Ada Lovelace' });
    put(s, 'student', 'Ada Lovelace');
    put(s, 'guardian', 'Ada Lovelace');
    expect(suspectSignatures()).toEqual([]);
  });

  /* Each document stands alone — a name shared across two documents by the
   * same person is just that person signing twice. */
  it('compares within a document, not across them', () => {
    const s = seed();
    put(s, 'student', 'Ada Lovelace', 'code_of_conduct');
    put(s, 'guardian', 'Augusta Byron', 'participation_agreement');
    expect(suspectSignatures()).toEqual([]);
  });

  it('does not report the same signature twice when both rules fire', () => {
    const s = seed();
    put(s, 'student', 'Augusta Byron', 'participation_agreement');
    put(s, 'guardian', 'Augusta Byron', 'participation_agreement');

    const found = suspectSignatures();
    const slots = found.map((f) => `${f.document}:${f.signerKind}`);
    expect(new Set(slots).size).toBe(slots.length);
  });
});
