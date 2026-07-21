import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { and, eq, isNull, gt } from 'drizzle-orm';
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

  let existing = db.select().from(user).where(eq(user.email, normalized)).get();
  if (!existing) {
    const id = nanoid();
    db.insert(user).values({ id, email: normalized }).run();
    existing = { id, email: normalized, createdAt: nowSeconds(), lastLoginAt: null };
  }

  const token = newToken();
  const expiresAt = nowSeconds() + TOKEN_TTL_SECONDS;
  db.insert(magicLinkToken)
    .values({
      token,
      userId: existing.id,
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

export type VerifyResult =
  | { ok: true; sessionId: string; userId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' };

export function verifyToken(
  token: string,
  meta: { userAgent?: string | undefined; ip?: string | undefined },
): VerifyResult {
  const now = nowSeconds();
  const row = db
    .select()
    .from(magicLinkToken)
    .where(eq(magicLinkToken.token, token))
    .get();
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.usedAt !== null) return { ok: false, reason: 'used' };
  if (row.expiresAt <= now) return { ok: false, reason: 'expired' };

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
  db.update(user).set({ lastLoginAt: now }).where(eq(user.id, row.userId)).run();

  return { ok: true, sessionId, userId: row.userId };
}

export function destroySession(sessionId: string): void {
  db.delete(session).where(eq(session.id, sessionId)).run();
}

export function purgeExpired(): void {
  const now = nowSeconds();
  db.delete(magicLinkToken).where(gt(magicLinkToken.expiresAt, now)).run();
  db.delete(session).where(gt(session.expiresAt, now)).run();
}
