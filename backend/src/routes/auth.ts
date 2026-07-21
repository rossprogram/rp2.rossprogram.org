import type { FastifyInstance } from 'fastify';
import { RequestLinkBody } from '@rp2/shared';
import { requestMagicLink, verifyToken, destroySession } from '../auth/magic-link.js';
import { setSessionCookie, clearSessionCookie } from '../auth/session.js';
import { env } from '../env.js';

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/auth/request-link',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const parsed = RequestLinkBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_email' });
      }
      try {
        await requestMagicLink(parsed.data.email, req.ip);
      } catch (err) {
        req.log.error({ err }, 'failed to send magic link');
      }
      return reply.code(204).send();
    },
  );

  app.get('/api/auth/verify', async (req, reply) => {
    const q = req.query as { token?: string };
    if (!q.token || typeof q.token !== 'string') {
      return reply.code(400).send({ error: 'missing_token' });
    }
    const result = verifyToken(q.token, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    if (!result.ok) {
      return reply.redirect(`${env.APP_URL}/auth/verify?error=${result.reason}`);
    }
    setSessionCookie(reply, result.sessionId);
    return reply.redirect(`${env.APP_URL}/apply`);
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.currentUser) return reply.code(401).send({ error: 'unauthenticated' });
    return {
      id: req.currentUser.id,
      email: req.currentUser.email,
      roles: req.currentUser.roles,
    };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.currentUser) destroySession(req.currentUser.sessionId);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
}
