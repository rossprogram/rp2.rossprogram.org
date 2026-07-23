import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { guardianLink, magicLinkToken, session, user, userRole } from '../db/schema.js';
import { sendEmail } from '../integrations/email/ses.js';
import {
  renderApplicantInviteEmail,
  renderGuardianInviteEmail,
} from '../integrations/email/templates.js';
import { env } from '../env.js';
import { sessionTtlSeconds } from './session.js';

export type MagicLinkPurpose = 'applicant_signin' | 'guardian_invite' | 'guardian_signin';
export type SignInRole = 'applicant' | 'guardian';

const TOKEN_TTL_SECONDS = 15 * 60;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/*
 * Canonical role of an existing user, based on explicit user_role rows.
 * Returns null for a "ghost" record (email exists but the user has never
 * completed sign-in and has no application data). Guardian wins if both are
 * present — a rare case, but the parent role is more restrictive.
 */
export function canonicalRoleForEmail(email: string): SignInRole | null {
  const normalized = email.trim().toLowerCase();
  const u = db.select({ id: user.id }).from(user).where(eq(user.email, normalized)).get();
  if (!u) return null;
  return canonicalRole(u.id);
}

function canonicalRole(userId: string): SignInRole | null {
  const roles = db
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, userId))
    .all()
    .map((r) => r.role);
  if (roles.includes('guardian')) return 'guardian';
  if (roles.includes('applicant')) return 'applicant';
  return null;
}

export type RequestLinkFailure = { reason: 'role_mismatch'; registeredAs: SignInRole };
export type RequestLinkResult = { ok: true } | ({ ok: false } & RequestLinkFailure);

export async function requestMagicLink(
  email: string,
  role: SignInRole,
  requestIp?: string | undefined,
): Promise<RequestLinkResult> {
  const normalized = email.trim().toLowerCase();
  const userId = upsertUser(normalized);
  const canonical = canonicalRole(userId);
  if (canonical !== null && canonical !== role) {
    return { ok: false, reason: 'role_mismatch', registeredAs: canonical };
  }
  const purpose: MagicLinkPurpose =
    role === 'guardian' ? 'guardian_signin' : 'applicant_signin';
  const token = issueToken(userId, purpose, requestIp);
  const link = `${env.APP_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
  const forParent = role === 'guardian';
  await sendEmail({
    to: normalized,
    subject: forParent
      ? 'Your ℝℙ² parent-portal sign-in link'
      : 'Your ℝℙ² sign-in link',
    text: [
      'Hello,',
      '',
      forParent
        ? 'Follow this link to sign in to the ℝℙ² parent portal:'
        : 'Follow this link to sign in to your ℝℙ² application:',
      link,
      '',
      'This link expires in 15 minutes and can only be used once.',
      '',
      "If you didn't request this, you can ignore this email.",
    ].join('\n'),
    html: `
      <p>Hello,</p>
      <p>${
        forParent
          ? 'Follow this link to sign in to the ℝℙ² parent portal:'
          : 'Follow this link to sign in to your ℝℙ² application:'
      }</p>
      <p><a href="${link}">${link}</a></p>
      <p>This link expires in 15 minutes and can only be used once.</p>
      <p>If you didn't request this, you can ignore this email.</p>
    `,
  });
  return { ok: true };
}

/*
 * Sends a `guardian_invite` magic link. Called from the applications service
 * when the applicant first saves guardian_email (and rate-limited resends
 * afterward). The token's `purpose='guardian_invite'` causes the interstitial
 * to skip DOB collection and consumeToken to grant the `guardian` role +
 * flip `guardian_link.acceptedAt`.
 */
/*
 * Sends an `applicant_signin` magic link to a student the parent invited from
 * their portal. Parallel of requestGuardianInvite: creates the user record if
 * new, but the email is the parent-invites-student template rather than the
 * plain sign-in one, so the recipient knows why they're being invited.
 */
export async function requestApplicantInvite(
  applicantEmail: string,
  guardianName: string,
): Promise<{ applicantUserId: string }> {
  const normalized = applicantEmail.trim().toLowerCase();
  const applicantUserId = upsertUser(normalized);
  const token = issueToken(applicantUserId, 'applicant_signin');
  const link = `${env.APP_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
  const rendered = renderApplicantInviteEmail({ guardianName, magicLinkUrl: link });
  await sendEmail({
    to: normalized,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
  return { applicantUserId };
}

export async function requestGuardianInvite(
  guardianEmail: string,
  applicantName: string,
): Promise<{ guardianUserId: string }> {
  const normalized = guardianEmail.trim().toLowerCase();
  const guardianUserId = upsertUser(normalized);
  const token = issueToken(guardianUserId, 'guardian_invite');
  const link = `${env.APP_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
  const rendered = renderGuardianInviteEmail({ applicantName, magicLinkUrl: link });
  await sendEmail({
    to: normalized,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
  return { guardianUserId };
}

function upsertUser(normalizedEmail: string): string {
  const existing = db.select().from(user).where(eq(user.email, normalizedEmail)).get();
  if (existing) return existing.id;
  const id = nanoid();
  db.insert(user).values({ id, email: normalizedEmail }).run();
  return id;
}

function issueToken(
  userId: string,
  purpose: MagicLinkPurpose,
  requestIp?: string | undefined,
): string {
  const token = newToken();
  const expiresAt = nowSeconds() + TOKEN_TTL_SECONDS;
  db.insert(magicLinkToken)
    .values({
      token,
      userId,
      purpose,
      expiresAt,
      requestIp: requestIp ?? null,
    })
    .run();
  return token;
}

export type TokenFailure = 'invalid' | 'expired' | 'used';

export type PreviewResult =
  | {
      ok: true;
      email: string;
      expiresAt: number;
      needsDob: boolean;
      purpose: MagicLinkPurpose;
    }
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
      purpose: magicLinkToken.purpose,
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
  // Guardians don't go through the DOB gate — parents are adults, and we
  // never ask for their DOB.
  const needsDob = row.purpose === 'applicant_signin' && row.dob === null;
  return {
    ok: true,
    email: row.email,
    expiresAt: row.expiresAt,
    needsDob,
    purpose: row.purpose,
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
  | { ok: true; sessionId: string; userId: string; purpose: MagicLinkPurpose }
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
      purpose: magicLinkToken.purpose,
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

  const isApplicant = row.purpose === 'applicant_signin';

  let dobToStore: string | null = row.dob;
  if (isApplicant && row.dob === null) {
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

  // Grant the appropriate explicit role. Applicant is normally implicit at
  // read time, but persisting it here lets requestMagicLink detect
  // cross-role conflicts on future sign-in attempts.
  const grantedRole: 'applicant' | 'guardian' =
    row.purpose === 'applicant_signin' ? 'applicant' : 'guardian';
  db.insert(userRole)
    .values({ userId: row.userId, role: grantedRole })
    .onConflictDoNothing()
    .run();

  // Guardian-invite acceptance also flips any pending guardian_link rows.
  // Idempotent — safe on re-entry via a fresh sign-in link later.
  if (row.purpose === 'guardian_invite') {
    db.update(guardianLink)
      .set({ acceptedAt: now })
      .where(
        and(
          eq(guardianLink.guardianUserId, row.userId),
          isNull(guardianLink.acceptedAt),
        ),
      )
      .run();
  }

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

  return { ok: true, sessionId, userId: row.userId, purpose: row.purpose };
}

export function destroySession(sessionId: string): void {
  db.delete(session).where(eq(session.id, sessionId)).run();
}

export function purgeExpired(): void {
  const now = nowSeconds();
  db.delete(magicLinkToken).where(lt(magicLinkToken.expiresAt, now)).run();
  db.delete(session).where(lt(session.expiresAt, now)).run();
}
