/*
 * End-to-end integration test for the offer lifecycle, via app.inject().
 *
 * No browser: seed -> publish -> notify -> accept -> checkout -> webhook ->
 * enrolled. This covers the ground a Playwright test would, in about a second,
 * and it does not have to survive a redirect to Stripe's hosted page.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

// Must be set before anything imports env.ts.
process.env.DATABASE_URL = ':memory:';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-pass-zod';
process.env.EMAIL_TRANSPORT = 'console';
process.env.PAYMENTS_ENABLED = 'false';

const sentEmails: { to: string; subject: string }[] = [];
/** Addresses the fake transport should reject, to test per-send isolation. */
const failFor = new Set<string>();
vi.mock('../src/integrations/email/ses.js', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string }) => {
    if (failFor.has(p.to)) throw new Error('simulated SES failure');
    sentEmails.push({ to: p.to, subject: p.subject });
  }),
}));

const { db } = await import('../src/db/client.js');
const schema = await import('../src/db/schema.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { build } = await import('../src/server.js');
const { handleStripeEvent } = await import('../src/services/payments.js');
const { narrow } = await import('../src/integrations/stripe/index.js');
const { utils, write } = await import('xlsx');

type App = Awaited<ReturnType<typeof build>>;
let app: App;

const now = () => Math.floor(Date.now() / 1000);

/** Seed one submitted application with a student, guardian, and admin. */
function seed(over: { amountDue?: string } = {}) {
  const studentId = nanoid();
  const guardianId = nanoid();
  const adminId = nanoid();
  const appId = nanoid();

  db.insert(schema.user)
    .values([
      { id: studentId, email: 'student@example.com', createdAt: now() },
      { id: guardianId, email: 'parent@example.com', createdAt: now() },
      { id: adminId, email: 'admin@example.com', createdAt: now() },
    ])
    .run();

  db.insert(schema.userRole)
    .values([
      { userId: studentId, role: 'applicant', grantedAt: now() },
      { userId: guardianId, role: 'guardian', grantedAt: now() },
      { userId: adminId, role: 'admin', grantedAt: now() },
    ])
    .run();

  db.insert(schema.application)
    .values({
      id: appId,
      applicantUserId: studentId,
      status: 'submitted',
      createdAt: now(),
      updatedAt: now(),
      submittedAt: now(),
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

  return { studentId, guardianId, adminId, appId, amountDue: over.amountDue ?? '750' };
}

/** Mint a session cookie the way the real login flow would. */
function login(userId: string): string {
  const sid = nanoid();
  db.insert(schema.session)
    .values({
      id: sid,
      userId,
      createdAt: now(),
      expiresAt: now() + 3600,
    })
    .run();
  return app.signCookie(sid);
}

function sheetOf(rows: Record<string, string>[]): Buffer {
  const ws = utils.json_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'offers');
  return Buffer.from(write(wb, { type: 'buffer', bookType: 'csv' }) as Uint8Array);
}

async function publishOffer(s: ReturnType<typeof seed>, over: Record<string, string> = {}) {
  const cookie = login(s.adminId);
  const buf = sheetOf([
    {
      app_id: s.appId,
      student_email: 'student@example.com',
      status: 'accepted',
      course: 'topology',
      section: 'TOPOLOGY-1',
      group: '5',
      problem_session: 'Sun 09:00',
      office_hours: 'Sat 09:00',
      aid_amount: String(1500 - Number(s.amountDue)),
      amount_due: s.amountDue,
      enrollment_deadline: '2099-01-01',
      notes: 'Welcome aboard.',
      ...over,
    },
  ]);

  const preview = await app.inject({
    method: 'POST',
    url: '/api/admin/offers/preview?filename=offers.csv',
    headers: { 'content-type': 'application/octet-stream', cookie: `rp2_sid=${cookie}` },
    payload: buf,
  });
  expect(preview.statusCode).toBe(200);
  const { preview: p } = preview.json();

  const importId = nanoid();
  const publish = await app.inject({
    method: 'POST',
    url: '/api/admin/offers/publish?filename=offers.csv',
    headers: {
      'content-type': 'application/octet-stream',
      cookie: `rp2_sid=${cookie}`,
      'x-import-id': importId,
      'x-file-hash': p.fileHash,
    },
    payload: buf,
  });
  expect(publish.statusCode).toBe(200);

  const notify = await app.inject({
    method: 'POST',
    url: `/api/admin/offers/imports/${importId}/notify`,
    headers: { cookie: `rp2_sid=${cookie}` },
  });
  expect(notify.statusCode).toBe(200);

  return { preview: p, publish: publish.json(), notify: notify.json(), importId };
}

beforeAll(async () => {
  runMigrations();
  app = await build();
  await app.ready();
});

beforeEach(() => {
  sentEmails.length = 0;
  // Order matters: children before parents.
  db.delete(schema.payment).run();
  db.delete(schema.offer).run();
  db.delete(schema.offerImport).run();
  db.delete(schema.stripeEvent).run();
  db.delete(schema.applicationResponse).run();
  db.delete(schema.application).run();
  db.delete(schema.guardianLink).run();
  db.delete(schema.session).run();
  db.delete(schema.userRole).run();
  db.delete(schema.user).run();
});

describe('import and notify', () => {
  it('publishes an offer and emails both student and guardian', async () => {
    const s = seed();
    const { publish, notify } = await publishOffer(s);

    expect(publish.applied).toBe(1);
    expect(notify.sent).toBe(2);
    expect(notify.recipients.sort()).toEqual(['parent@example.com', 'student@example.com']);

    const row = db.select().from(schema.application).get()!;
    expect(row.status).toBe('accepted');
  });

  it('is idempotent on a re-published import id', async () => {
    const s = seed();
    const { importId } = await publishOffer(s);
    const cookie = login(s.adminId);
    const buf = sheetOf([{ app_id: s.appId, status: 'waitlisted' }]);

    const again = await app.inject({
      method: 'POST',
      url: '/api/admin/offers/publish?filename=offers.csv',
      headers: {
        'content-type': 'application/octet-stream',
        cookie: `rp2_sid=${cookie}`,
        'x-import-id': importId,
      },
      payload: buf,
    });
    expect(again.json().alreadyPublished).toBe(true);
    // The second sheet must not have been applied.
    expect(db.select().from(schema.application).get()!.status).toBe('accepted');
  });

  it('refuses a file that differs from the previewed one', async () => {
    const s = seed();
    const cookie = login(s.adminId);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/offers/publish?filename=offers.csv',
      headers: {
        'content-type': 'application/octet-stream',
        cookie: `rp2_sid=${cookie}`,
        'x-import-id': nanoid(),
        'x-file-hash': 'a-hash-from-some-other-file',
      },
      payload: sheetOf([{ app_id: s.appId, status: 'waitlisted' }]),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('file_changed');
  });

  it('refuses to publish a sheet with row errors', async () => {
    const s = seed();
    const cookie = login(s.adminId);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/offers/publish?filename=offers.csv',
      headers: {
        'content-type': 'application/octet-stream',
        cookie: `rp2_sid=${cookie}`,
        'x-import-id': nanoid(),
      },
      payload: sheetOf([{ app_id: s.appId, status: 'accepted', course: 'nonsense' }]),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('row_errors');
  });

  it('requires an admin', async () => {
    const s = seed();
    const cookie = login(s.studentId);
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/offers/template',
      headers: { cookie: `rp2_sid=${cookie}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('the family side', () => {
  it('hides an offer until it has been notified', async () => {
    const s = seed();
    const cookie = login(s.adminId);
    const buf = sheetOf([
      {
        app_id: s.appId, student_email: 'student@example.com', status: 'accepted',
        course: 'topology', amount_due: '750', aid_amount: '750',
      },
    ]);
    await app.inject({
      method: 'POST',
      url: '/api/admin/offers/publish?filename=o.csv',
      headers: {
        'content-type': 'application/octet-stream',
        cookie: `rp2_sid=${cookie}`,
        'x-import-id': nanoid(),
      },
      payload: buf,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/offer/${s.appId}`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(res.json().offer).toBeNull();
  });

  it('lets the student see and accept, moving to awaiting_payment', async () => {
    const s = seed();
    await publishOffer(s);

    const view = await app.inject({
      method: 'GET',
      url: `/api/offer/${s.appId}`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(view.json().offer).toMatchObject({
      courseLabel: 'Point-Set Topology',
      amountDueCents: 75_000,
      aidAmountCents: 75_000,
      tuitionCents: 150_000,
      response: null,
    });

    const accept = await app.inject({
      method: 'POST',
      url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(accept.json().status).toBe('awaiting_payment');
  });

  /*
   * A full scholarship is still an OFFER. It must be affirmatively accepted:
   * the student has a seat held for them, not a seat they have been signed up
   * for. deriveStatus() checks `response` BEFORE comparing money, which is
   * what stops `0 >= 0` from auto-enrolling everyone on full aid.
   */
  it('does not auto-enroll a $0 offer — it waits for an answer', async () => {
    const s = seed({ amountDue: '0' });
    await publishOffer(s);

    expect(db.select().from(schema.application).get()!.status).toBe('accepted');

    const view = await app.inject({
      method: 'GET',
      url: `/api/offer/${s.appId}`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    const env = view.json();
    // Still awaiting an answer, and the panel will render the buttons.
    expect(env.status).toBe('accepted');
    expect(env.offer.response).toBeNull();
    expect(env.offer.amountDueCents).toBe(0);
    expect(env.offer.aidAmountCents).toBe(150_000);
  });

  it('lets a full-scholarship family decline', async () => {
    const s = seed({ amountDue: '0' });
    await publishOffer(s);

    const res = await app.inject({
      method: 'POST',
      url: `/api/offer/${s.appId}/decline`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(res.json().status).toBe('declined');
    expect(db.select().from(schema.application).get()!.status).toBe('declined');
  });

  it('sends no thank-you until a $0 offer is actually accepted', async () => {
    const s = seed({ amountDue: '0' });
    await publishOffer(s);
    await new Promise((r) => setTimeout(r, 20));
    // The only mail so far is the two "check the portal" notices.
    expect(sentEmails.filter((e) => e.subject.includes('enrolled'))).toHaveLength(0);
  });

  it('enrolls immediately on a $0 balance and sends the thank-you', async () => {
    const s = seed({ amountDue: '0' });
    await publishOffer(s);
    sentEmails.length = 0;

    const accept = await app.inject({
      method: 'POST',
      url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.guardianId)}` },
    });
    expect(accept.json().status).toBe('enrolled');

    await new Promise((r) => setTimeout(r, 20));
    expect(sentEmails.map((e) => e.to).sort()).toEqual([
      'parent@example.com',
      'student@example.com',
    ]);
    expect(sentEmails[0]!.subject).toContain('enrolled');
  });

  it('lets the guardian act, and records which of them did', async () => {
    const s = seed();
    await publishOffer(s);

    await app.inject({
      method: 'POST',
      url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.guardianId)}` },
    });

    const view = await app.inject({
      method: 'GET',
      url: `/api/offer/${s.appId}`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(view.json().offer.respondedByKind).toBe('guardian');
  });

  it('treats a double-clicked accept as idempotent, not an error', async () => {
    const s = seed();
    await publishOffer(s);
    const cookie = login(s.studentId);

    const first = await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${cookie}` },
    });
    const second = await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${cookie}` },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotent).toBe(true);
    expect(first.json().status).toBe(second.json().status);
  });

  it('refuses to flip an accept into a decline', async () => {
    const s = seed();
    await publishOffer(s);
    const cookie = login(s.studentId);

    await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${cookie}` },
    });
    const decline = await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/decline`,
      headers: { cookie: `rp2_sid=${cookie}` },
    });
    expect(decline.statusCode).toBe(409);
    expect(decline.json().error).toBe('already_responded');
  });

  it('declines cleanly', async () => {
    const s = seed();
    await publishOffer(s);
    const res = await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/decline`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(res.json().status).toBe('declined');
  });

  it('hides buttons past the deadline by refusing the response', async () => {
    const s = seed();
    await publishOffer(s, { enrollment_deadline: '2020-01-01' });
    const res = await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('deadline_passed');
  });

  it('404s for an unrelated user, without confirming the id exists', async () => {
    const s = seed();
    await publishOffer(s);
    const strangerId = nanoid();
    db.insert(schema.user)
      .values({ id: strangerId, email: 'nosy@example.com', createdAt: now() })
      .run();
    db.insert(schema.userRole)
      .values({ userId: strangerId, role: 'applicant', grantedAt: now() })
      .run();

    const real = await app.inject({
      method: 'GET', url: `/api/offer/${s.appId}`,
      headers: { cookie: `rp2_sid=${login(strangerId)}` },
    });
    const fake = await app.inject({
      method: 'GET', url: `/api/offer/does-not-exist`,
      headers: { cookie: `rp2_sid=${login(strangerId)}` },
    });
    expect(real.statusCode).toBe(404);
    expect(fake.statusCode).toBe(404);
    expect(real.json()).toEqual(fake.json());
  });

  it('refuses checkout while payments are disabled', async () => {
    const s = seed();
    await publishOffer(s);
    await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    const res = await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/checkout-session`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(res.statusCode).toBe(503);
  });
});

describe('the stripe webhook', () => {
  /** Build the event the SDK would hand us, skipping signature verification. */
  function completedEvent(sessionId: string, amount: number, id = nanoid()) {
    return narrow(
      {
        id,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: sessionId,
            payment_status: 'paid',
            payment_intent: 'pi_test_1',
            amount_total: amount,
            client_reference_id: 'unused',
          },
        },
      },
      '{}',
    );
  }

  /** Accept the offer, then stand in for startCheckout by inserting a payment. */
  async function acceptAndQuote(s: ReturnType<typeof seed>, amount = 75_000) {
    await publishOffer(s);
    await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    const sessionId = `cs_test_${nanoid()}`;
    db.insert(schema.payment)
      .values({
        id: nanoid(),
        applicationId: s.appId,
        stripeCheckoutSessionId: sessionId,
        amountCents: amount,
        status: 'created',
        createdAt: now(),
      })
      .run();
    return sessionId;
  }

  it('enrolls on a completed session', async () => {
    const s = seed();
    const sessionId = await acceptAndQuote(s);

    const { result, enrolled } = handleStripeEvent(completedEvent(sessionId, 75_000));
    expect(result.status).toBe('applied:enrolled');
    expect(enrolled).toBe(s.appId);
    expect(db.select().from(schema.application).get()!.status).toBe('enrolled');
    expect(db.select().from(schema.payment).get()!.status).toBe('paid');
  });

  it('ignores a replayed event', async () => {
    const s = seed();
    const sessionId = await acceptAndQuote(s);
    const ev = completedEvent(sessionId, 75_000);

    expect(handleStripeEvent(ev).result.status).toBe('applied:enrolled');
    const replay = handleStripeEvent(ev);
    expect(replay.result.status).toBe('duplicate');
    expect(replay.enrolled).toBeNull();
    expect(db.select().from(schema.stripeEvent).all()).toHaveLength(1);
  });

  it('refuses to enroll on an amount we never quoted', async () => {
    const s = seed();
    const sessionId = await acceptAndQuote(s, 75_000);

    const { result } = handleStripeEvent(completedEvent(sessionId, 100));
    expect(result.status).toBe('amount_mismatch');
    expect(db.select().from(schema.application).get()!.status).toBe('awaiting_payment');
  });

  it('ignores a session it never created', async () => {
    const s = seed();
    await acceptAndQuote(s);
    const { result } = handleStripeEvent(completedEvent('cs_test_forged', 75_000));
    expect(result.status).toBe('unknown_session');
    expect(db.select().from(schema.application).get()!.status).toBe('awaiting_payment');
  });

  it('rejects a bad signature at the route, recording nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'garbage' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(400);
    expect(db.select().from(schema.stripeEvent).all()).toHaveLength(0);
  });

  it('records an unhandled event type without acting on it', async () => {
    const s = seed();
    await acceptAndQuote(s);
    const ev = narrow(
      { id: nanoid(), type: 'charge.refunded', data: { object: {} } },
      '{}',
    );
    expect(handleStripeEvent(ev).result.status).toBe('unhandled');
    expect(db.select().from(schema.application).get()!.status).toBe('awaiting_payment');
  });
});

describe('what publish actually writes', () => {
  it('routes internal_notes to the application, never to the offer', async () => {
    const s = seed();
    await publishOffer(s, { internal_notes: 'weak recs, marginal admit' });

    expect(db.select().from(schema.application).get()!.decisionNotes).toBe(
      'weak recs, marginal admit',
    );
    expect(db.select().from(schema.offer).get()!.notes).toBe('Welcome aboard.');
  });

  /*
   * The privacy invariant that motivated splitting the two note columns: an
   * admin's candid assessment must never be reachable by the family.
   */
  it('never exposes internal notes to the student or the guardian', async () => {
    const s = seed();
    await publishOffer(s, { internal_notes: 'weak recs, marginal admit' });

    for (const who of [s.studentId, s.guardianId]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/offer/${s.appId}`,
        headers: { cookie: `rp2_sid=${login(who)}` },
      });
      expect(res.body).not.toContain('marginal admit');
      expect(res.json().offer).not.toHaveProperty('internalNotes');
      expect(res.json()).not.toHaveProperty('decisionNotes');
    }
  });

  it('clears a field when its cell is emptied', async () => {
    const s = seed();
    await publishOffer(s);
    expect(db.select().from(schema.offer).get()!.section).toBe('TOPOLOGY-1');

    const cookie = login(s.adminId);
    const buf = sheetOf([{ app_id: s.appId, section: '', notes: '' }]);
    const prev = await app.inject({
      method: 'POST',
      url: '/api/admin/offers/preview?filename=clear.csv',
      headers: { 'content-type': 'application/octet-stream', cookie: `rp2_sid=${cookie}` },
      payload: buf,
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/offers/publish?filename=clear.csv',
      headers: {
        'content-type': 'application/octet-stream',
        cookie: `rp2_sid=${cookie}`,
        'x-import-id': nanoid(),
        'x-file-hash': prev.json().preview.fileHash,
      },
      payload: buf,
    });

    const row = db.select().from(schema.offer).get()!;
    expect(row.section).toBeNull();
    expect(row.notes).toBeNull();
    // Columns absent from that sheet are untouched.
    expect(row.problemSession).toBe('Sun 09:00');
    expect(row.amountDueCents).toBe(75_000);
  });

  it('does not erase a family answer when the offer is re-imported', async () => {
    const s = seed();
    await publishOffer(s);
    await app.inject({
      method: 'POST',
      url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });

    const cookie = login(s.adminId);
    const buf = sheetOf([{ app_id: s.appId, problem_session: 'Wed 20:00' }]);
    const prev = await app.inject({
      method: 'POST',
      url: '/api/admin/offers/preview?filename=r.csv',
      headers: { 'content-type': 'application/octet-stream', cookie: `rp2_sid=${cookie}` },
      payload: buf,
    });
    // The admin is warned that this rewrites an answered offer.
    expect(
      prev.json().preview.warningRows[0].warnings.map((w: { code: string }) => w.code),
    ).toContain('rewrites_answered_offer');

    await app.inject({
      method: 'POST',
      url: '/api/admin/offers/publish?filename=r.csv',
      headers: {
        'content-type': 'application/octet-stream',
        cookie: `rp2_sid=${cookie}`,
        'x-import-id': nanoid(),
        'x-file-hash': prev.json().preview.fileHash,
      },
      payload: buf,
    });

    const row = db.select().from(schema.offer).get()!;
    expect(row.problemSession).toBe('Wed 20:00');
    expect(row.response).toBe('accepted');
    expect(row.respondedAt).not.toBeNull();
    expect(db.select().from(schema.application).get()!.status).toBe('awaiting_payment');
  });

  it('leaves drafts out of the template entirely', async () => {
    const s = seed();
    db.update(schema.application)
      .set({ status: 'draft' })
      .where(eq(schema.application.id, s.appId))
      .run();

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/offers/template?format=csv',
      headers: { cookie: `rp2_sid=${login(s.adminId)}` },
    });
    expect(res.body).not.toContain(s.appId);
  });
});

describe('notification', () => {
  it('still reaches the student when the guardian address fails', async () => {
    const s = seed();
    const cookie = login(s.adminId);
    const buf = sheetOf([
      {
        app_id: s.appId, student_email: 'student@example.com', status: 'accepted',
        course: 'topology', aid_amount: '750', amount_due: '750',
      },
    ]);
    const prev = await app.inject({
      method: 'POST',
      url: '/api/admin/offers/preview?filename=n.csv',
      headers: { 'content-type': 'application/octet-stream', cookie: `rp2_sid=${cookie}` },
      payload: buf,
    });
    const importId = nanoid();
    await app.inject({
      method: 'POST',
      url: '/api/admin/offers/publish?filename=n.csv',
      headers: {
        'content-type': 'application/octet-stream',
        cookie: `rp2_sid=${cookie}`,
        'x-import-id': importId,
        'x-file-hash': prev.json().preview.fileHash,
      },
      payload: buf,
    });

    failFor.add('parent@example.com');
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/offers/imports/${importId}/notify`,
      headers: { cookie: `rp2_sid=${cookie}` },
    });
    failFor.clear();

    expect(res.json()).toMatchObject({ sent: 1, skipped: 1 });
    expect(res.json().recipients).toEqual(['student@example.com']);
    // The offer is still visible — a bounced email must not hide it.
    const view = await app.inject({
      method: 'GET',
      url: `/api/offer/${s.appId}`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(view.json().offer).not.toBeNull();
  });
});

describe('partial payments', () => {
  /** Insert a quoted payment the way startCheckout would. */
  function quote(appId: string, amount: number) {
    const sessionId = `cs_test_${nanoid()}`;
    db.insert(schema.payment)
      .values({
        id: nanoid(), applicationId: appId, stripeCheckoutSessionId: sessionId,
        amountCents: amount, status: 'created', createdAt: now(),
      })
      .run();
    return sessionId;
  }

  function completed(sessionId: string, amount: number) {
    return narrow(
      {
        id: nanoid(),
        type: 'checkout.session.completed',
        data: {
          object: {
            id: sessionId, payment_status: 'paid', payment_intent: 'pi_1',
            amount_total: amount, client_reference_id: 'x',
          },
        },
      },
      '{}',
    );
  }

  /*
   * deriveStatus sums ALL paid payments rather than looking at one. That is
   * what makes a half payment leave the family short rather than enrolled,
   * and the second payment complete it — with no installment feature built.
   */
  it('does not enroll on a payment that only covers half the balance', async () => {
    const s = seed();
    await publishOffer(s);
    await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });

    const half = quote(s.appId, 37_500);
    const { result, enrolled } = handleStripeEvent(completed(half, 37_500));

    expect(result.status).toBe('applied:awaiting_payment');
    expect(enrolled).toBeNull();
    expect(db.select().from(schema.application).get()!.status).toBe('awaiting_payment');
  });

  it('enrolls once the payments together cover the balance', async () => {
    const s = seed();
    await publishOffer(s);
    await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });

    handleStripeEvent(completed(quote(s.appId, 37_500), 37_500));
    const { result, enrolled } = handleStripeEvent(completed(quote(s.appId, 37_500), 37_500));

    expect(result.status).toBe('applied:enrolled');
    expect(enrolled).toBe(s.appId);
  });

  it('shows the family what they have paid so far', async () => {
    const s = seed();
    await publishOffer(s);
    await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    handleStripeEvent(completed(quote(s.appId, 37_500), 37_500));

    const view = await app.inject({
      method: 'GET', url: `/api/offer/${s.appId}`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(view.json().offer.paidCents).toBe(37_500);
    expect(view.json().offer.amountDueCents).toBe(75_000);
  });

  it('marks an abandoned session expired without touching the application', async () => {
    const s = seed();
    await publishOffer(s);
    await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    const sessionId = quote(s.appId, 75_000);

    const ev = narrow(
      {
        id: nanoid(),
        type: 'checkout.session.expired',
        data: { object: { id: sessionId, payment_status: 'unpaid' } },
      },
      '{}',
    );
    expect(handleStripeEvent(ev).result.status).toBe('expired');
    expect(db.select().from(schema.payment).get()!.status).toBe('expired');
    expect(db.select().from(schema.application).get()!.status).toBe('awaiting_payment');
  });

  it('ignores a completed event whose payment_status is not paid', async () => {
    const s = seed();
    await publishOffer(s);
    const sessionId = quote(s.appId, 75_000);
    const ev = narrow(
      {
        id: nanoid(),
        type: 'checkout.session.completed',
        data: { object: { id: sessionId, payment_status: 'unpaid', amount_total: 75_000 } },
      },
      '{}',
    );
    expect(handleStripeEvent(ev).result.status).toBe('not_paid');
    expect(db.select().from(schema.payment).get()!.status).toBe('created');
  });
});

describe('authorization', () => {
  /** A second family, to prove guardians are scoped to their own student. */
  function seedOther() {
    const uid = nanoid();
    const gid = nanoid();
    const aid = nanoid();
    db.insert(schema.user)
      .values([
        { id: uid, email: 'other-student@example.com', createdAt: now() },
        { id: gid, email: 'other-parent@example.com', createdAt: now() },
      ])
      .run();
    db.insert(schema.userRole)
      .values([
        { userId: uid, role: 'applicant', grantedAt: now() },
        { userId: gid, role: 'guardian', grantedAt: now() },
      ])
      .run();
    db.insert(schema.application)
      .values({
        id: aid, applicantUserId: uid, status: 'submitted',
        createdAt: now(), updatedAt: now(), submittedAt: now(),
      })
      .run();
    db.insert(schema.guardianLink)
      .values({
        id: nanoid(), applicantUserId: uid, guardianUserId: gid,
        relationship: 'parent', createdAt: now(), acceptedAt: now(),
      })
      .run();
    return { uid, gid, aid };
  }

  it('does not let one family read another family offer', async () => {
    const s = seed();
    await publishOffer(s);
    const other = seedOther();

    for (const who of [other.uid, other.gid]) {
      const res = await app.inject({
        method: 'GET', url: `/api/offer/${s.appId}`,
        headers: { cookie: `rp2_sid=${login(who)}` },
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('does not let another family accept an offer', async () => {
    const s = seed();
    await publishOffer(s);
    const other = seedOther();

    const res = await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(other.gid)}` },
    });
    expect(res.statusCode).toBe(404);
    expect(db.select().from(schema.offer).get()!.response).toBeNull();
  });

  it('requires a session at all', async () => {
    const s = seed();
    await publishOffer(s);
    for (const url of [`/api/offer/${s.appId}`, `/api/offer/${s.appId}/accept`]) {
      const res = await app.inject({
        method: url.endsWith('accept') ? 'POST' : 'GET',
        url,
      });
      expect(res.statusCode).toBe(401);
    }
  });

  // Admin is not automatically a party to the offer; acting on a family's
  // behalf is deliberately not a thing an admin can do by accident.
  it('does not give an admin the family accept button', async () => {
    const s = seed();
    await publishOffer(s);
    const res = await app.inject({
      method: 'POST', url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.adminId)}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

/*
 * Regression, from a real family in September 2026: they accepted a $1,500
 * offer, then an import granted them a full scholarship. The offer went to
 * $0 but application.status stayed awaiting_payment, because applyRow() only
 * wrote a status when the sheet carried a status cell. They could not pay
 * (Checkout refuses a $0 balance), could not enroll, and did not appear in the
 * enrolled count — while their seat and breakout group were already assigned.
 */
describe('a money change re-derives status', () => {
  /** Publish a sheet exactly as given — unlike publishOffer(), no status cell. */
  async function publishSheet(adminId: string, rows: Record<string, string>[]) {
    const cookie = login(adminId);
    const buf = sheetOf(rows);

    const prev = await app.inject({
      method: 'POST',
      url: '/api/admin/offers/preview?filename=amend.csv',
      headers: { 'content-type': 'application/octet-stream', cookie: `rp2_sid=${cookie}` },
      payload: buf,
    });
    expect(prev.statusCode).toBe(200);
    const { preview } = prev.json();

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/offers/publish?filename=amend.csv',
      headers: {
        'content-type': 'application/octet-stream',
        cookie: `rp2_sid=${cookie}`,
        'x-import-id': nanoid(),
        'x-file-hash': preview.fileHash,
      },
      payload: buf,
    });
    expect(res.statusCode).toBe(200);
    return { preview, publish: res.json() };
  }

  const statusOf = () => db.select().from(schema.application).get()!.status;

  it('enrolls a family whose balance a later import zeroes', async () => {
    const s = seed();
    await publishOffer(s);
    await app.inject({
      method: 'POST',
      url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(statusOf()).toBe('awaiting_payment');

    const { preview } = await publishSheet(s.adminId, [
      {
        app_id: s.appId,
        student_email: 'student@example.com',
        aid_amount: '1500',
        amount_due: '0',
      },
    ]);

    // The admin saw the transition in the preview before it was written.
    expect(preview.changedRows[0].changes).toContainEqual({
      field: 'status',
      column: 'status',
      before: 'awaiting_payment',
      after: 'enrolled',
    });
    expect(statusOf()).toBe('enrolled');
  });

  it('leaves an enrolled family alone when only the notes change', async () => {
    const s = seed({ amountDue: '0' });
    await publishOffer(s);
    await app.inject({
      method: 'POST',
      url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(statusOf()).toBe('enrolled');

    const { preview } = await publishSheet(s.adminId, [
      { app_id: s.appId, student_email: 'student@example.com', notes: 'Bring a notebook.' },
    ]);

    expect(preview.changedRows[0].changes.map((c: { field: string }) => c.field)).toEqual([
      'notes',
    ]);
    expect(statusOf()).toBe('enrolled');
  });

  /*
   * The admin's own status cell still wins. Derivation would read the stale
   * response and push a reopened offer straight back to declined.
   */
  it('does not undo an admin reopening a declined offer', async () => {
    const s = seed({ amountDue: '0' });
    await publishOffer(s);
    await app.inject({
      method: 'POST',
      url: `/api/offer/${s.appId}/decline`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });
    expect(statusOf()).toBe('declined');

    await publishSheet(s.adminId, [
      {
        app_id: s.appId,
        student_email: 'student@example.com',
        status: 'accepted',
        course: 'topology',
        aid_amount: '750',
        amount_due: '750',
      },
    ]);
    expect(statusOf()).toBe('accepted');
  });

  it('keeps a non-payer rejection rejected', async () => {
    const s = seed();
    await publishOffer(s);
    await app.inject({
      method: 'POST',
      url: `/api/offer/${s.appId}/accept`,
      headers: { cookie: `rp2_sid=${login(s.studentId)}` },
    });

    await publishSheet(s.adminId, [
      { app_id: s.appId, student_email: 'student@example.com', status: 'rejected' },
    ]);
    expect(statusOf()).toBe('rejected');
  });
});
