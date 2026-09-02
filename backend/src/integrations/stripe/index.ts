import { env } from '../../env.js';

/*
 * Stripe, behind a narrow interface.
 *
 * Per CLAUDE.md, route handlers never touch the SDK. Nothing outside this
 * directory imports a Stripe.* type — StripeEventLite is our own narrowed
 * shape carrying only the fields the webhook handler actually reads.
 *
 * Hosted Checkout is a plain redirect, so there is no publishable key and no
 * Stripe.js on the page.
 */

export type CheckoutSessionInput = {
  applicationId: string;
  amountCents: number;
  customerEmail: string;
  description: string;
  idempotencyKey: string;
};

export type StripeEventLite = {
  id: string;
  type: string;
  raw: string;
  session: {
    id: string;
    paymentStatus: string | null;
    paymentIntentId: string | null;
    amountTotal: number | null;
    clientReferenceId: string | null;
  } | null;
};

/*
 * Pin the API version explicitly rather than inheriting the account default,
 * so nobody upgrading the version in the Stripe dashboard can change response
 * or event shapes under a running server.
 *
 * This MUST match two things: the installed SDK's LatestApiVersion, and the
 * version selected on the webhook endpoint in the dashboard. Requests and
 * events then speak one version. When bumping the `stripe` package, update
 * this and the dashboard endpoint together.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';

export function paymentsEnabled(): boolean {
  return env.PAYMENTS_ENABLED;
}

type StripeLike = {
  checkout: {
    sessions: {
      create: (params: unknown, opts: unknown) => Promise<{ id: string; url: string | null }>;
    };
  };
  webhooks: {
    constructEvent: (body: Buffer, sig: string, secret: string) => unknown;
  };
};

let client: StripeLike | null = null;

async function stripe(): Promise<StripeLike> {
  if (client) return client;
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured (PAYMENTS_ENABLED is false)');
  }
  const mod = await import('stripe');
  const Ctor = (mod.default ?? mod) as unknown as new (key: string, cfg: unknown) => StripeLike;
  // Pin explicitly rather than inheriting the account default, so upgrading
  // the account's version in the dashboard cannot change response shapes under
  // us. Keep this matched to the installed SDK's LatestApiVersion when bumping
  // the `stripe` package.
  client = new Ctor(env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
  return client;
}

/**
 * Create a hosted Checkout session.
 *
 * The amount comes from the caller reading the offer row server-side — the
 * browser never sends a price. The idempotency key means a double-clicked Pay
 * button returns the same session rather than creating a second one.
 */
export async function createCheckoutSession(
  input: CheckoutSessionInput,
): Promise<{ sessionId: string; url: string }> {
  const s = await stripe();
  const session = await s.checkout.sessions.create(
    {
      mode: 'payment',
      // Card only: no async_payment_succeeded/failed branch to handle.
      payment_method_types: ['card'],
      client_reference_id: input.applicationId,
      customer_email: input.customerEmail,
      metadata: { applicationId: input.applicationId, appEnv: env.NODE_ENV },
      // Metadata on the intent survives to the charge, for disputes and refunds.
      payment_intent_data: { metadata: { applicationId: input.applicationId } },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: input.amountCents,
            product_data: { name: input.description },
          },
        },
      ],
      success_url: `${env.APP_URL}/status?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.APP_URL}/status?canceled=1`,
    },
    { idempotencyKey: input.idempotencyKey },
  );

  if (!session.url) throw new Error('Stripe returned a session with no URL');
  return { sessionId: session.id, url: session.url };
}

/** Verify a webhook signature and narrow the event. Throws if invalid. */
export function verifyWebhook(rawBody: Buffer, signature: string): StripeEventLite {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  if (!client) {
    throw new Error('Stripe client not initialized');
  }
  const ev = client.webhooks.constructEvent(
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  ) as {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };
  return narrow(ev, rawBody.toString('utf8'));
}

/** Split out so tests can build an event without a signature. */
export function narrow(
  ev: { id: string; type: string; data: { object: Record<string, unknown> } },
  raw: string,
): StripeEventLite {
  const o = ev.data.object;
  const isSession = ev.type.startsWith('checkout.session.');
  return {
    id: ev.id,
    type: ev.type,
    raw,
    session: isSession
      ? {
          id: String(o.id ?? ''),
          paymentStatus: typeof o.payment_status === 'string' ? o.payment_status : null,
          paymentIntentId:
            typeof o.payment_intent === 'string' ? o.payment_intent : null,
          amountTotal: typeof o.amount_total === 'number' ? o.amount_total : null,
          clientReferenceId:
            typeof o.client_reference_id === 'string' ? o.client_reference_id : null,
        }
      : null,
  };
}

/** Warm the SDK so verifyWebhook can run synchronously inside the handler. */
export async function initStripe(): Promise<void> {
  if (env.PAYMENTS_ENABLED) await stripe();
}
