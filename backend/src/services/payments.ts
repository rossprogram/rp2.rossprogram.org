import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { isPastDeadline } from '@rp2/shared';
import { db } from '../db/client.js';
import {
  application,
  applicationResponse,
  guardianLink,
  offer,
  payment,
  stripeEvent,
  user,
} from '../db/schema.js';
import { createCheckoutSession, paymentsEnabled } from '../integrations/stripe/index.js';
import type { StripeEventLite } from '../integrations/stripe/index.js';
import { sendEmail } from '../integrations/email/ses.js';
import { renderEnrolledEmail } from '../integrations/email/templates.js';
import { env } from '../env.js';
import {
  OfferError,
  deriveStatus,
  offerSummaryFor,
  paidCentsFor,
  type OfferActor,
} from './offers.js';

const now = (): number => Math.floor(Date.now() / 1000);

/**
 * Start a Checkout session for an accepted offer.
 *
 * The deadline is enforced here, at session creation — not at payment. If a
 * session is created in time but paid a few minutes late, the webhook still
 * enrolls: never hold captured money without delivering the seat.
 */
export async function startCheckout(
  applicationId: string,
  actor: OfferActor,
): Promise<{ url: string }> {
  if (!paymentsEnabled()) {
    throw new OfferError('payments_disabled', 'Online payment is not available yet.', 503);
  }

  const o = db.select().from(offer).where(eq(offer.applicationId, applicationId)).get();
  if (!o || o.notifiedAt === null) {
    throw new OfferError('no_offer', 'There is no offer to pay for.', 404);
  }
  if (o.response !== 'accepted') {
    throw new OfferError('not_accepted', 'Accept the offer before paying.');
  }
  if (isPastDeadline(o.enrollmentDeadline)) {
    throw new OfferError(
      'deadline_passed',
      `This offer expired on ${o.enrollmentDeadline}. Please email us.`,
    );
  }

  const outstanding = o.amountDueCents - paidCentsFor(applicationId);
  if (outstanding <= 0) {
    throw new OfferError('nothing_due', 'There is no balance to pay.');
  }

  const summary = offerSummaryFor(applicationId);
  const { sessionId, url } = await createCheckoutSession({
    applicationId,
    amountCents: outstanding,
    customerEmail: actor.email,
    description: `ℝℙ² tuition — ${summary?.courseLabel ?? 'Fall 2026'}`,
    // Stable for a given offer version and price, so a double-click reuses
    // the same session rather than opening a second one.
    idempotencyKey: `checkout:${applicationId}:${o.updatedAt}:${outstanding}`,
  });

  db.insert(payment)
    .values({
      id: nanoid(),
      applicationId,
      stripeCheckoutSessionId: sessionId,
      amountCents: outstanding,
      status: 'created',
      createdByUserId: actor.userId,
      createdAt: now(),
    })
    .onConflictDoNothing()
    .run();

  return { url };
}

export type HandlerResult = { status: string };

/**
 * Apply a Stripe webhook event.
 *
 * Deliberately synchronous and free of `await`: better-sqlite3 is synchronous
 * and Node is single-threaded, so this whole body is atomic against other
 * requests. The event insert and the state change share one transaction, so a
 * crash between them rolls back both and Stripe's retry re-processes cleanly.
 *
 * Emails are sent by the caller, after the transaction commits.
 */
export function handleStripeEvent(ev: StripeEventLite): {
  result: HandlerResult;
  enrolled: string | null;
} {
  let enrolled: string | null = null;

  const result = db.transaction((tx): HandlerResult => {
    const ins = tx
      .insert(stripeEvent)
      .values({ id: ev.id, type: ev.type, payload: ev.raw, receivedAt: now() })
      .onConflictDoNothing()
      .run();

    // Lost the insert race: this event was already processed.
    if (ins.changes === 0) return { status: 'duplicate' };

    const outcome = applyEvent(tx, ev);
    if (outcome.enrolled) enrolled = outcome.enrolled;

    tx.update(stripeEvent)
      .set({ handledAt: now(), handlerResult: outcome.status })
      .where(eq(stripeEvent.id, ev.id))
      .run();

    return { status: outcome.status };
  });

  return { result, enrolled };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function applyEvent(tx: Tx, ev: StripeEventLite): { status: string; enrolled: string | null } {
  if (ev.type === 'checkout.session.completed') {
    const s = ev.session;
    if (!s) return { status: 'no_session', enrolled: null };
    if (s.paymentStatus !== 'paid') return { status: 'not_paid', enrolled: null };

    const row = tx
      .select()
      .from(payment)
      .where(eq(payment.stripeCheckoutSessionId, s.id))
      .get();

    // A session we never created. Do not invent a payment from webhook data.
    if (!row) return { status: 'unknown_session', enrolled: null };

    // Never enroll on an amount we did not quote.
    if (s.amountTotal !== null && s.amountTotal !== row.amountCents) {
      return { status: 'amount_mismatch', enrolled: null };
    }

    tx.update(payment)
      .set({
        status: 'paid',
        paidAt: now(),
        ...(s.paymentIntentId ? { stripePaymentIntentId: s.paymentIntentId } : {}),
      })
      .where(eq(payment.id, row.id))
      .run();

    const o = tx.select().from(offer).where(eq(offer.applicationId, row.applicationId)).get();
    if (!o) return { status: 'no_offer', enrolled: null };

    // Recompute from the full paid total, not this one payment.
    const paid = tx
      .select({ amount: payment.amountCents })
      .from(payment)
      .where(and(eq(payment.applicationId, row.applicationId), eq(payment.status, 'paid')))
      .all()
      .reduce((n, p) => n + p.amount, 0);

    const status = deriveStatus(o, paid);
    tx.update(application)
      .set({ status, updatedAt: now() })
      .where(eq(application.id, row.applicationId))
      .run();

    return {
      status: `applied:${status}`,
      enrolled: status === 'enrolled' ? row.applicationId : null,
    };
  }

  if (ev.type === 'checkout.session.expired') {
    const s = ev.session;
    if (!s) return { status: 'no_session', enrolled: null };
    tx.update(payment)
      .set({ status: 'expired' })
      .where(
        and(
          eq(payment.stripeCheckoutSessionId, s.id),
          eq(payment.status, 'created'),
        ),
      )
      .run();
    return { status: 'expired', enrolled: null };
  }

  // charge.refunded and everything else: recorded, never acted on
  // automatically. Un-enrolling a student is a human decision.
  return { status: 'unhandled', enrolled: null };
}

/** Fire-and-forget, called after the webhook transaction commits. */
export async function sendEnrolledEmails(applicationId: string): Promise<void> {
  const summary = offerSummaryFor(applicationId);
  const name = studentNameFor(applicationId);

  const mail = renderEnrolledEmail({
    studentName: name,
    courseLabel: summary?.courseLabel ?? null,
    section: summary?.section ?? null,
    cohort: summary?.cohort ?? null,
    problemSession: summary?.problemSession ?? null,
    officeHours: summary?.officeHours ?? null,
    portalUrl: `${env.APP_URL}/status`,
  });

  for (const to of recipientsFor(applicationId)) {
    try {
      await sendEmail({ to, ...mail });
    } catch {
      // Logged by the caller's error handler; a failed thank-you must never
      // roll back an enrollment.
    }
  }
}

export function studentNameFor(applicationId: string): string | null {
  const row = db
    .select({ value: applicationResponse.value })
    .from(applicationResponse)
    .where(
      and(
        eq(applicationResponse.applicationId, applicationId),
        eq(applicationResponse.questionKey, 'student_legal_name'),
      ),
    )
    .get();
  if (!row) return null;
  try {
    const v: unknown = JSON.parse(row.value);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Student and guardian addresses for one application, deduplicated. */
export function recipientsFor(applicationId: string): string[] {
  const app = db
    .select({ applicantUserId: application.applicantUserId, email: user.email })
    .from(application)
    .innerJoin(user, eq(user.id, application.applicantUserId))
    .where(eq(application.id, applicationId))
    .get();
  if (!app) return [];

  const guardian = db
    .select({ email: user.email })
    .from(guardianLink)
    .innerJoin(user, eq(user.id, guardianLink.guardianUserId))
    .where(eq(guardianLink.applicantUserId, app.applicantUserId))
    .get();

  const out = [app.email];
  if (guardian && guardian.email.toLowerCase() !== app.email.toLowerCase()) {
    out.push(guardian.email);
  }
  return out;
}
