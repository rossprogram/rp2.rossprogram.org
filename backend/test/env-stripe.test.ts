/*
 * Stripe key prefixes. DEPLOY.md recommends a RESTRICTED key (rk_) because
 * this app only needs Checkout Sessions: write — so the validation must accept
 * one. It previously demanded sk_, which rejected the very key the docs told
 * you to create, and the server refused to boot on deploy.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

/** Mirrors the STRIPE_SECRET_KEY rule in src/env.ts. */
const KeySchema = z
  .string()
  .regex(/^(sk|rk)_/, 'must be a Stripe secret (sk_) or restricted (rk_) key');

describe('STRIPE_SECRET_KEY', () => {
  it('accepts restricted keys, live and test', () => {
    expect(KeySchema.safeParse('rk_live_abc123').success).toBe(true);
    expect(KeySchema.safeParse('rk_test_abc123').success).toBe(true);
  });

  it('accepts standard secret keys', () => {
    expect(KeySchema.safeParse('sk_live_abc123').success).toBe(true);
    expect(KeySchema.safeParse('sk_test_abc123').success).toBe(true);
  });

  it('still rejects a publishable key or junk', () => {
    // pk_ is the browser-side key and must never be used as the server secret.
    expect(KeySchema.safeParse('pk_live_abc123').success).toBe(false);
    expect(KeySchema.safeParse('whsec_abc').success).toBe(false);
    expect(KeySchema.safeParse('oops').success).toBe(false);
    expect(KeySchema.safeParse('').success).toBe(false);
  });
});
