/*
 * The term surveys: enrolled students and their guardians answer, admin
 * downloads the answers and emails the families who have not.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { read, utils } from 'xlsx';

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
const { sendEmail } = await import('../src/integrations/email/ses.js');

type App = Awaited<ReturnType<typeof build>>;
let app: App;

const now = () => Math.floor(Date.now() / 1000);

const STUDENT_ANSWERS = {
  section: 'QUADRATIC-2',
  enjoyment: 5,
  pace: 'About right',
  pset_hours: '4–6',
  agree: { psets_discover: 4, meetings_longer: 2, second_course: 5 },
  meeting_time: 'Yes, it works well',
  anything_else: '=HYPERLINK("http://evil")',
};

const GUARDIAN_ANSWERS = {
  child_talks: 'Enthusiastically',
  fit: 'Manageable',
  agree: { learning: 5 },
  concerns: '',
};

/** A family: student, guardian, offer. Enrolled unless told otherwise. */
function seed(over: { email?: string; guardianId?: string; enrolled?: boolean; name?: string } = {}) {
  const enrolled = over.enrolled ?? true;
  const studentId = nanoid();
  const guardianId = over.guardianId ?? nanoid();
  const appId = nanoid();

  db.insert(schema.user)
    .values({ id: studentId, email: over.email ?? `${studentId}@example.com`, createdAt: now() })
    .run();
  db.insert(schema.userRole).values({ userId: studentId, role: 'applicant' }).run();
  if (!over.guardianId) {
    db.insert(schema.user)
      .values({ id: guardianId, email: `parent-${guardianId}@example.com`, createdAt: now() })
      .run();
    db.insert(schema.userRole).values({ userId: guardianId, role: 'guardian' }).run();
  }
  db.insert(schema.application)
    .values({
      id: appId,
      applicantUserId: studentId,
      status: enrolled ? 'enrolled' : 'submitted',
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  db.insert(schema.applicationResponse)
    .values({
      applicationId: appId,
      questionKey: 'student_legal_name',
      value: JSON.stringify(over.name ?? 'Ada Lovelace'),
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
  if (enrolled) {
    db.insert(schema.offer)
      .values({
        id: nanoid(),
        applicationId: appId,
        courseKey: 'quadratic',
        section: 'QUADRATIC-2',
        amountDueCents: 0,
        response: 'accepted',
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
  }
  return { studentId, guardianId, appId };
}

function seedAdmin(): string {
  const id = nanoid();
  db.insert(schema.user).values({ id, email: 'jim@example.com', createdAt: now() }).run();
  db.insert(schema.userRole).values({ userId: id, role: 'admin' }).run();
  return id;
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
  vi.mocked(sendEmail).mockClear();
  db.delete(schema.surveyResponse).run();
  db.delete(schema.offer).run();
  db.delete(schema.applicationResponse).run();
  db.delete(schema.application).run();
  db.delete(schema.guardianLink).run();
  db.delete(schema.session).run();
  db.delete(schema.userRole).run();
  db.delete(schema.user).run();
});

describe('student survey', () => {
  it('prefills the section and records the answers', async () => {
    const s = seed();
    const get = await app.inject({ method: 'GET', url: '/api/survey', headers: { cookie: cookie(s.studentId) } });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ section: 'QUADRATIC-2', answers: null, enrolled: true });

    const post = await app.inject({
      method: 'POST',
      url: '/api/survey',
      headers: { cookie: cookie(s.studentId) },
      payload: { answers: STUDENT_ANSWERS },
    });
    expect(post.statusCode).toBe(200);
    expect(post.json().answers.agree.second_course).toBe(5);
    expect(post.json().submittedAt).toBeGreaterThan(0);
  });

  it('refuses a missing required answer', async () => {
    const s = seed();
    const { pace: _omit, ...rest } = STUDENT_ANSWERS;
    const res = await app.inject({
      method: 'POST',
      url: '/api/survey',
      headers: { cookie: cookie(s.studentId) },
      payload: { answers: rest },
    });
    expect(res.statusCode).toBe(400);
    expect(db.select().from(schema.surveyResponse).all()).toHaveLength(0);
  });

  it('is closed to a student who is not enrolled', async () => {
    const s = seed({ enrolled: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/survey',
      headers: { cookie: cookie(s.studentId) },
      payload: { answers: STUDENT_ANSWERS },
    });
    expect(res.statusCode).toBe(403);
  });

  it('replaces answers on resubmission rather than adding a row', async () => {
    const s = seed();
    const c = cookie(s.studentId);
    await app.inject({ method: 'POST', url: '/api/survey', headers: { cookie: c }, payload: { answers: STUDENT_ANSWERS } });
    await app.inject({
      method: 'POST',
      url: '/api/survey',
      headers: { cookie: c },
      payload: { answers: { ...STUDENT_ANSWERS, pace: 'Too fast' } },
    });
    const rows = db.select().from(schema.surveyResponse).all();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.answers).pace).toBe('Too fast');
  });
});

describe('guardian survey', () => {
  it('lets a linked guardian answer, and nobody else', async () => {
    const s = seed();
    const other = seed();

    const ok = await app.inject({
      method: 'POST',
      url: `/api/parent/applicant/${s.appId}/survey`,
      headers: { cookie: cookie(s.guardianId) },
      payload: { answers: GUARDIAN_ANSWERS },
    });
    expect(ok.statusCode).toBe(200);

    const stranger = await app.inject({
      method: 'POST',
      url: `/api/parent/applicant/${s.appId}/survey`,
      headers: { cookie: cookie(other.guardianId) },
      payload: { answers: GUARDIAN_ANSWERS },
    });
    expect(stranger.statusCode).toBe(404);

    // A student cannot answer the parent survey for their own family.
    const student = await app.inject({
      method: 'POST',
      url: `/api/parent/applicant/${s.appId}/survey`,
      headers: { cookie: cookie(s.studentId) },
      payload: { answers: GUARDIAN_ANSWERS },
    });
    expect(student.statusCode).toBe(403);
  });
});

describe('admin', () => {
  it('exports one row per response, with formulas neutralized', async () => {
    const adminId = seedAdmin();
    const s = seed();
    await app.inject({
      method: 'POST',
      url: '/api/survey',
      headers: { cookie: cookie(s.studentId) },
      payload: { answers: STUDENT_ANSWERS },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/surveys/export?format=xlsx',
      headers: { cookie: cookie(adminId) },
    });
    expect(res.statusCode).toBe(200);
    const wb = read(res.rawPayload);
    expect(wb.SheetNames).toEqual(['Students', 'Parents']);
    const rows = utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Students']!);
    expect(rows).toHaveLength(1);
    expect(rows[0]!['student_name']).toBe('Ada Lovelace');
    expect(rows[0]!['agree: I would be interested in taking a second course in my topic']).toBe(5);
    expect(String(rows[0]!['Is there anything you would like to share about your experience so far?'])).toMatch(/^'=/);

    const csv = await app.inject({
      method: 'GET',
      url: '/api/admin/surveys/export?format=csv&respondent=guardian',
      headers: { cookie: cookie(adminId) },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
  });

  it('is admin-only', async () => {
    const s = seed();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/surveys/export',
      headers: { cookie: cookie(s.studentId) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('previews, then emails only those who have not answered, once per address', async () => {
    const adminId = seedAdmin();
    const a = seed({ name: 'Ada Lovelace' });
    // A sibling sharing a's guardian.
    seed({ name: 'Byron Lovelace', guardianId: a.guardianId });
    const c = seed({ name: 'Carl Gauss' });
    seed({ enrolled: false });

    await app.inject({
      method: 'POST',
      url: '/api/survey',
      headers: { cookie: cookie(c.studentId) },
      payload: { answers: STUDENT_ANSWERS },
    });

    const preview = await app.inject({
      method: 'POST',
      url: '/api/admin/surveys/request',
      headers: { cookie: cookie(adminId) },
      payload: { dryRun: true },
    });
    expect(preview.statusCode).toBe(200);
    const planned = preview.json().planned as { kind: string; students: string[] }[];
    // a and b students, one guardian email for both, c's guardian. Not c.
    expect(planned.filter((p) => p.kind === 'student')).toHaveLength(2);
    expect(planned.filter((p) => p.kind === 'guardian')).toHaveLength(2);
    expect(planned.find((p) => p.students.length === 2)?.students.sort()).toEqual([
      'Ada Lovelace',
      'Byron Lovelace',
    ]);
    expect(sendEmail).not.toHaveBeenCalled();

    const send = await app.inject({
      method: 'POST',
      url: '/api/admin/surveys/request',
      headers: { cookie: cookie(adminId) },
      payload: { dryRun: false },
    });
    expect(send.json()).toMatchObject({ sent: 4, skipped: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(4);
  });
});
