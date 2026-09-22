/*
 * The mentor portal.
 *
 * The guard under test is scoping. Until now the only tier above "the family"
 * was a binary admin, so this is the first code in the system that shows one
 * adult some minors' details and not others'. A leak here is not a bug, it is
 * an incident — so most of these tests are about what a mentor CANNOT see.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { nanoid } from 'nanoid';

process.env.DATABASE_URL = ':memory:';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-pass-zod';
process.env.EMAIL_TRANSPORT = 'console';
process.env.PAYMENTS_ENABLED = 'false';
process.env.DISCORD_ENABLED = 'false';

vi.mock('../src/integrations/email/ses.js', () => ({ sendEmail: vi.fn(async () => {}) }));

const { db } = await import('../src/db/client.js');
const schema = await import('../src/db/schema.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { build } = await import('../src/server.js');
const { TERM_KEY, AGREEMENTS } = await import('@rp2/shared');

type App = Awaited<ReturnType<typeof build>>;
let app: App;

const now = () => Math.floor(Date.now() / 1000);

function makeSection(label: string, courseKey: string, number: number): string {
  const id = nanoid();
  db.insert(schema.section)
    .values({
      id,
      term: TERM_KEY,
      courseKey,
      number,
      label,
      problemWeekday: 0,
      problemMinute: 9 * 60,
      officeWeekday: 6,
      officeMinute: 9 * 60,
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  return id;
}

function makeStaff(email: string, role: 'mentor' | 'assistant' | 'admin'): string {
  const id = nanoid();
  db.insert(schema.user).values({ id, email, createdAt: now() }).run();
  db.insert(schema.userRole).values({ userId: id, role, grantedAt: now() }).run();
  return id;
}

function assign(sectionId: string, userId: string, role: 'mentor' | 'assistant') {
  db.insert(schema.sectionStaff)
    .values({ sectionId, userId, role, assignedAt: now() })
    .run();
}

/** One enrolled student in a given section. */
function makeStudent(opts: {
  label: string;
  cohort: string;
  name: string;
  signed?: number;
  discord?: 'joined' | 'linked' | 'none';
}): string {
  const studentId = nanoid();
  const guardianId = nanoid();
  const appId = nanoid();

  db.insert(schema.user)
    .values([
      { id: studentId, email: `${opts.name.toLowerCase().replace(/\W/g, '')}@example.com`, createdAt: now() },
      { id: guardianId, email: `g-${studentId}@example.com`, createdAt: now() },
    ])
    .run();
  db.insert(schema.application)
    .values({ id: appId, applicantUserId: studentId, status: 'enrolled', createdAt: now(), updatedAt: now() })
    .run();
  db.insert(schema.applicationResponse)
    .values([
      { applicationId: appId, questionKey: 'student_legal_name', value: JSON.stringify(opts.name), updatedAt: now() },
      { applicationId: appId, questionKey: 'student_timezone', value: JSON.stringify('America/New_York'), updatedAt: now() },
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
      courseKey: 'cgt',
      section: opts.label,
      cohort: opts.cohort,
      amountDueCents: 0,
      response: 'accepted',
      notifiedAt: now(),
      createdAt: now(),
      updatedAt: now(),
    })
    .run();

  let written = 0;
  for (const doc of AGREEMENTS) {
    for (const signer of doc.signers) {
      if (written >= (opts.signed ?? 0)) break;
      db.insert(schema.agreementSignature)
        .values({
          id: nanoid(),
          applicationId: appId,
          document: doc.key,
          signerKind: signer,
          signerUserId: signer === 'student' ? studentId : guardianId,
          typedName: opts.name,
          documentVersion: doc.version,
          documentHash: 'h',
          signedAt: now(),
        })
        .run();
      written += 1;
    }
  }

  if (opts.discord && opts.discord !== 'none') {
    db.insert(schema.discordLink)
      .values({
        userId: studentId,
        discordUserId: `d-${studentId}`,
        linkedAt: now(),
        joinedGuildAt: opts.discord === 'joined' ? now() : null,
      })
      .run();
  }
  return appId;
}

function login(userId: string): string {
  const sid = nanoid();
  db.insert(schema.session)
    .values({ id: sid, userId, createdAt: now(), expiresAt: now() + 3600 })
    .run();
  return app.signCookie(sid);
}

function get(userId: string) {
  return app.inject({
    method: 'GET',
    url: '/api/mentor/me',
    headers: { cookie: `rp2_sid=${login(userId)}` },
  });
}

beforeAll(async () => {
  runMigrations();
  app = await build();
  await app.ready();
});

beforeEach(() => {
  db.delete(schema.sectionStaff).run();
  db.delete(schema.sessionOccurrence).run();
  db.delete(schema.section).run();
  db.delete(schema.discordLink).run();
  db.delete(schema.agreementSignature).run();
  db.delete(schema.offer).run();
  db.delete(schema.applicationResponse).run();
  db.delete(schema.application).run();
  db.delete(schema.guardianLink).run();
  db.delete(schema.session).run();
  db.delete(schema.userRole).run();
  db.delete(schema.user).run();
});

describe('scoping', () => {
  /* The one that matters. */
  it('shows a mentor their own section and nobody else', async () => {
    const mine = makeSection('CGT-1', 'cgt', 1);
    makeSection('CGT-2', 'cgt', 2);
    const may = makeStaff('may@example.com', 'mentor');
    assign(mine, may, 'mentor');

    makeStudent({ label: 'CGT-1', cohort: '1', name: 'Mine Student' });
    makeStudent({ label: 'CGT-2', cohort: '1', name: 'Other Student' });

    const res = await get(may);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].label).toBe('CGT-1');
    const everyone = JSON.stringify(body);
    expect(everyone).toContain('Mine Student');
    expect(everyone).not.toContain('Other Student');
  });

  it('gives a mentor both sections when they hold two', async () => {
    const a = makeSection('GGT-2', 'ggt', 2);
    const b = makeSection('TOPOLOGY-2', 'topology', 2);
    const blaze = makeStaff('blaze@example.com', 'mentor');
    assign(a, blaze, 'mentor');
    assign(b, blaze, 'mentor');

    const res = await get(blaze);
    expect(res.json().sections.map((s: { label: string }) => s.label)).toEqual([
      'GGT-2',
      'TOPOLOGY-2',
    ]);
  });

  it('shows an admin every section', async () => {
    makeSection('CGT-1', 'cgt', 1);
    makeSection('CGT-2', 'cgt', 2);
    const jim = makeStaff('jim@example.com', 'admin');

    const res = await get(jim);
    expect(res.json().sections).toHaveLength(2);
    expect(res.json().viewingAs).toBe('admin');
  });

  it('shows an unassigned assistant nothing rather than everything', async () => {
    makeSection('CGT-1', 'cgt', 1);
    makeStudent({ label: 'CGT-1', cohort: '1', name: 'Some Student' });
    const emma = makeStaff('emma@example.com', 'assistant');

    const res = await get(emma);
    expect(res.statusCode).toBe(200);
    expect(res.json().sections).toEqual([]);
    expect(res.json().viewingAs).toBe('assistant');
  });

  it('refuses a student outright', async () => {
    makeSection('CGT-1', 'cgt', 1);
    const studentUser = nanoid();
    db.insert(schema.user).values({ id: studentUser, email: 's@example.com', createdAt: now() }).run();
    db.insert(schema.userRole)
      .values({ userId: studentUser, role: 'applicant', grantedAt: now() })
      .run();

    const res = await get(studentUser);
    expect(res.statusCode).toBe(403);
  });

  it('refuses a guardian outright', async () => {
    const g = makeStaff('parent@example.com', 'assistant');
    db.delete(schema.userRole).run();
    db.insert(schema.userRole).values({ userId: g, role: 'guardian', grantedAt: now() }).run();

    expect((await get(g)).statusCode).toBe(403);
  });

  it('requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/mentor/me' });
    expect(res.statusCode).toBe(401);
  });

  /*
   * Three course assistants also hold `applicant` from abandoned applications
   * of their own. Holding an extra role must not cost them staff access.
   */
  it('lets staff who also hold applicant through', async () => {
    const s = makeSection('CGT-1', 'cgt', 1);
    const emma = makeStaff('emma@example.com', 'assistant');
    db.insert(schema.userRole).values({ userId: emma, role: 'applicant', grantedAt: now() }).run();
    assign(s, emma, 'assistant');

    const res = await get(emma);
    expect(res.statusCode).toBe(200);
    expect(res.json().sections).toHaveLength(1);
  });
});

describe('the roster', () => {
  it('reports what each student still owes', async () => {
    const s = makeSection('CGT-1', 'cgt', 1);
    const may = makeStaff('may@example.com', 'mentor');
    assign(s, may, 'mentor');

    makeStudent({ label: 'CGT-1', cohort: '1', name: 'All Done', signed: 4, discord: 'joined' });
    makeStudent({ label: 'CGT-1', cohort: '2', name: 'Half Way', signed: 2, discord: 'linked' });
    makeStudent({ label: 'CGT-1', cohort: '3', name: 'Not Started', signed: 0, discord: 'none' });

    const students = (await get(may)).json().sections[0].students;
    const by = (n: string) => students.find((x: { legalName: string }) => x.legalName === n);

    expect(by('All Done').fullySigned).toBe(true);
    expect(by('All Done').outstandingSignatures).toBe(0);
    expect(by('All Done').discord).toBe('joined');

    expect(by('Half Way').fullySigned).toBe(false);
    expect(by('Half Way').outstandingSignatures).toBe(2);
    expect(by('Half Way').discord).toBe('linked');

    expect(by('Not Started').outstandingSignatures).toBe(4);
    expect(by('Not Started').discord).toBe('none');
  });

  it('sorts by breakout group, the way a mentor thinks', async () => {
    const s = makeSection('CGT-1', 'cgt', 1);
    const may = makeStaff('may@example.com', 'mentor');
    assign(s, may, 'mentor');

    makeStudent({ label: 'CGT-1', cohort: '3', name: 'Cee' });
    makeStudent({ label: 'CGT-1', cohort: '1', name: 'Aay' });
    makeStudent({ label: 'CGT-1', cohort: '2', name: 'Bee' });

    const students = (await get(may)).json().sections[0].students;
    expect(students.map((s2: { cohort: string }) => s2.cohort)).toEqual(['1', '2', '3']);
  });

  it('carries the contact details a mentor needs to chase someone', async () => {
    const s = makeSection('CGT-1', 'cgt', 1);
    const may = makeStaff('may@example.com', 'mentor');
    assign(s, may, 'mentor');
    makeStudent({ label: 'CGT-1', cohort: '1', name: 'Ada Lovelace' });

    const student = (await get(may)).json().sections[0].students[0];
    expect(student.email).toContain('@example.com');
    expect(student.guardianEmail).toContain('@example.com');
    expect(student.timezone).toBe('America/New_York');
  });

  it('reports the schedule and the next session', async () => {
    const s = makeSection('CGT-1', 'cgt', 1);
    const may = makeStaff('may@example.com', 'mentor');
    assign(s, may, 'mentor');
    db.insert(schema.sessionOccurrence)
      .values([
        { id: nanoid(), sectionId: s, kind: 'problem_session', date: '2099-01-04', startsAt: 4070000000, createdAt: now() },
        { id: nanoid(), sectionId: s, kind: 'office_hours', date: '2099-01-10', startsAt: 4070500000, createdAt: now() },
      ])
      .run();

    const section = (await get(may)).json().sections[0];
    expect(section.schedule.find((x: { kind: string }) => x.kind === 'problem_session').when).toContain('Sun 09:00');
    // The nearer of the two, not merely the first row.
    expect(section.nextSession.date).toBe('2099-01-04');
  });

  it('ignores sessions that have already happened', async () => {
    const s = makeSection('CGT-1', 'cgt', 1);
    const may = makeStaff('may@example.com', 'mentor');
    assign(s, may, 'mentor');
    db.insert(schema.sessionOccurrence)
      .values({ id: nanoid(), sectionId: s, kind: 'problem_session', date: '2020-01-05', startsAt: 1578225600, createdAt: now() })
      .run();

    expect((await get(may)).json().sections[0].nextSession).toBeNull();
  });

  it('leaves out students who are not enrolled', async () => {
    const s = makeSection('CGT-1', 'cgt', 1);
    const may = makeStaff('may@example.com', 'mentor');
    assign(s, may, 'mentor');
    const appId = makeStudent({ label: 'CGT-1', cohort: '1', name: 'Withdrawn Person' });
    db.update(schema.application).set({ status: 'withdrawn' }).run();

    expect(appId).toBeTruthy();
    expect((await get(may)).json().sections[0].students).toEqual([]);
  });
});
