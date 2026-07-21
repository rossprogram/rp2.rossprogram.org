import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { session, user, userRole } from '../db/schema.js';
import type { Role } from '@rp2/shared';

const SESSION_COOKIE = 'rp2_sid';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type CurrentUser = {
  id: string;
  email: string;
  roles: Role[];
  sessionId: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: CurrentUser | null;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function attachSession(req: FastifyRequest): Promise<void> {
  req.currentUser = null;
  const sid = req.cookies[SESSION_COOKIE];
  if (!sid) return;
  const unsigned = req.unsignCookie(sid);
  if (!unsigned.valid || !unsigned.value) return;

  const row = db
    .select({
      sid: session.id,
      expiresAt: session.expiresAt,
      userId: user.id,
      email: user.email,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(eq(session.id, unsigned.value))
    .get();
  if (!row) return;
  if (row.expiresAt <= nowSeconds()) return;

  const roles = db
    .select({ role: userRole.role })
    .from(userRole)
    .where(eq(userRole.userId, row.userId))
    .all()
    .map((r) => r.role as Role);
  if (!roles.includes('applicant')) roles.push('applicant');

  req.currentUser = {
    id: row.userId,
    email: row.email,
    roles,
    sessionId: row.sid,
  };
}

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    signed: true,
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function sessionTtlSeconds(): number {
  return SESSION_TTL_SECONDS;
}

export function requireAuth(role?: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.currentUser) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }
    if (role && !req.currentUser.roles.includes(role)) {
      reply.code(403).send({ error: 'forbidden' });
      return;
    }
  };
}
