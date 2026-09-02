/*
 * The API version is pinned in three places that must agree:
 *   1. the installed SDK's LatestApiVersion
 *   2. STRIPE_API_VERSION in the integration
 *   3. the version selected on the webhook endpoint in the Stripe dashboard
 *
 * (3) cannot be asserted from here, but (1) and (2) can — and this test is
 * what makes a future `pnpm add stripe@latest` fail loudly instead of silently
 * leaving requests on an old version. That drift is not hypothetical: the pin
 * was one train behind the SDK when this integration was first written.
 */
import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';

process.env.DATABASE_URL = ':memory:';
process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-to-pass-zod';

const { STRIPE_API_VERSION } = await import('../src/integrations/stripe/index.js');

describe('the pinned Stripe API version', () => {
  it('matches the installed SDK, so types describe what we actually receive', () => {
    // Stripe.API_VERSION is the SDK's LatestApiVersion at build time.
    expect(STRIPE_API_VERSION).toBe(Stripe.API_VERSION);
  });

  it('is a real dated version, not a train name or "latest"', () => {
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/);
  });

  it('constructs a live client without the SDK rejecting the version', () => {
    const client = new Stripe('sk_test_notarealkey', {
      apiVersion: STRIPE_API_VERSION,
    });
    expect(client.checkout.sessions).toBeDefined();
    expect(typeof client.webhooks.constructEvent).toBe('function');
  });
});
