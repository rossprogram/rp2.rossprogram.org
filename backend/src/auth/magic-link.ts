import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { magicLinkToken, session, user } from '../db/schema.js';
import { sendEmail } from '../integrations/email/ses.js';
import { env } from '../env.js';
import { sessionTtlSeconds } from './session.js';

const TOKEN_TTL_SECONDS = 15 * 60;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function requestMagicLink(email: string, requestIp?: string | undefined): Promise<void> {
  const normalized = email.trim().toLowerCase();

  let userId: string;
  const existing = db.select().from(user).where(eq(user.email, normalized)).get();
  if (existing) {
    userId = existing.id;
  } else {
    userId = nanoid();
    db.insert(user).values({ id: userId, email: normalized }).run();
  }

  const token = newToken();
  const expiresAt = nowSeconds() + TOKEN_TTL_SECONDS;
  db.insert(magicLinkToken)
    .values({
      token,
      userId,
      expiresAt,
      requestIp: requestIp ?? null,
    })
    .run();

  const link = `${env.APP_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: normalized,
    subject: 'Your ℝℙ² sign-in link',
    text: [
      'Hello,',
      '',
      'Follow this link to sign in to your ℝℙ² application:',
      link,
      '',
      'This link expires in 15 minutes and can only be used once.',
      '',
      "If you didn't request this, you can ignore this email.",
    ].join('\n'),
    html: `
      <p>Hello,</p>
      <p>Follow this link to sign in to your ℝℙ² application:</p>
      <p><a href="${link}">${link}</a></p>
      <p>This link expires in 15 minutes and can only be used once.</p>
      <p>If you didn't request this, you can ignore this email.</p>
    `,
  });
}

export type TokenFailure = 'invalid' | 'expired' | 'used';

export type PreviewResult =
  | { ok: true; email: string; expiresAt: number; needsDob: boolean }
  | { ok: false; reason: TokenFailure };

/*
 * Read-only lookup of a token. Does NOT consume — safe to call on GETs that
 * an email scanner (Microsoft ATP, Mimecast, Proofpoint, etc.) may prefetch
 * before a human ever clicks. Consume the token via consumeToken() only
 * after an explicit human action (POST from the interstitial page).
 */
export function previewToken(token: string): PreviewResult {
  const now = nowSeconds();
  const row = db
    .select({
      token: magicLinkToken.token,
      userId: magicLinkToken.userId,
      expiresAt: magicLinkToken.expiresAt,
      usedAt: magicLinkToken.usedAt,
      email: user.email,
      dob: user.dob,
    })
    .from(magicLinkToken)
    .innerJoin(user, eq(user.id, magicLinkToken.userId))
    .where(eq(magicLinkToken.token, token))
    .get();
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.usedAt !== null) return { ok: false, reason: 'used' };
  if (row.expiresAt <= now) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    email: row.email,
    expiresAt: row.expiresAt,
    needsDob: row.dob === null,
  };
}

export const MINIMUM_AGE_YEARS = 13;

export function ageInYears(dobIso: string, at: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobIso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dob = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(dob.getTime())) return null;
  let age = at.getUTCFullYear() - y;
  const cm = at.getUTCMonth() + 1;
  const cd = at.getUTCDate();
  if (cm < mo || (cm === mo && cd < d)) age--;
  return age;
}

export type ConsumeResult =
  | { ok: true; sessionId: string; userId: string }
  | { ok: false; reason: TokenFailure | 'dob_required' | 'too_young' | 'invalid_dob' };

/*
 * Atomically mark a token used and mint a session. Called from POST-only
 * routes; a scanner following the interstitial page will not fire this.
 *
 * If the user's DOB is not yet set, `dob` must be provided (YYYY-MM-DD).
 * Enforces MINIMUM_AGE_YEARS at sign-in time; under-age users are rejected
 * and their user record is deleted to avoid retaining any personal info.
 */
export function consumeToken(
  token: string,
  meta: { userAgent?: string | undefined; ip?: string | undefined; dob?: string | undefined },
): ConsumeResult {
  const now = nowSeconds();
  const row = db
    .select({
      token: magicLinkToken.token,
      userId: magicLinkToken.userId,
      expiresAt: magicLinkToken.expiresAt,
      usedAt: magicLinkToken.usedAt,
      dob: user.dob,
    })
    .from(magicLinkToken)
    .innerJoin(user, eq(user.id, magicLinkToken.userId))
    .where(eq(magicLinkToken.token, token))
    .get();
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.usedAt !== null) return { ok: false, reason: 'used' };
  if (row.expiresAt <= now) return { ok: false, reason: 'expired' };

  let dobToStore: string | null = row.dob;
  if (row.dob === null) {
    if (!meta.dob) return { ok: false, reason: 'dob_required' };
    const age = ageInYears(meta.dob);
    if (age === null) return { ok: false, reason: 'invalid_dob' };
    if (age < MINIMUM_AGE_YEARS) {
      // Consume the token first so it can't be retried with a different DOB,
      // then delete the user record entirely (cascades to token + session +
      // any partial application data). We keep no personal info about the
      // rejected under-13.
      db.update(magicLinkToken)
        .set({ usedAt: now })
        .where(eq(magicLinkToken.token, token))
        .run();
      db.delete(user).where(eq(user.id, row.userId)).run();
      return { ok: false, reason: 'too_young' };
    }
    dobToStore = meta.dob;
  }

  const updated = db
    .update(magicLinkToken)
    .set({ usedAt: now })
    .where(and(eq(magicLinkToken.token, token), isNull(magicLinkToken.usedAt)))
    .run();
  if (updated.changes === 0) return { ok: false, reason: 'used' };

  const sessionId = nanoid(32);
  db.insert(session)
    .values({
      id: sessionId,
      userId: row.userId,
      expiresAt: now + sessionTtlSeconds(),
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    })
    .run();
  db.update(user)
    .set({ lastLoginAt: now, dob: dobToStore })
    .where(eq(user.id, row.userId))
    .run();

  return { ok: true, sessionId, userId: row.userId };
}

export function destroySession(sessionId: string): void {
  db.delete(session).where(eq(session.id, sessionId)).run();
}

export function purgeExpired(): void {
  const now = nowSeconds();
  db.delete(magicLinkToken).where(lt(magicLinkToken.expiresAt, now)).run();
  db.delete(session).where(lt(session.expiresAt, now)).run();
}
