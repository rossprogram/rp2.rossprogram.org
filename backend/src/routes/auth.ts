import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RequestLinkBody } from '@rp2/shared';
import {
  requestMagicLink,
  previewToken,
  consumeToken,
  destroySession,
} from '../auth/magic-link.js';
import { setSessionCookie, clearSessionCookie } from '../auth/session.js';
import { env } from '../env.js';

const CompleteBody = z.object({
  token: z.string().min(20).max(200),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .optional(),
});

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

  // Email-link landing endpoint. Intentionally does NOT consume the token —
  // corporate email scanners (Microsoft ATP Safe Links, Mimecast, Proofpoint,
  // Gmail hover previews, etc.) fetch every URL in incoming mail. If we
  // consumed here, the scanner would burn the token before the human ever
  // clicks. Instead we validate + redirect to an SPA interstitial with a
  // human "Continue" button that fires the actual consume via POST.
  app.get('/api/auth/verify', async (req, reply) => {
    const q = req.query as { token?: string };
    if (!q.token || typeof q.token !== 'string') {
      return reply.redirect(`${env.APP_URL}/auth/verify?error=invalid`);
    }
    const preview = previewToken(q.token);
    if (!preview.ok) {
      return reply.redirect(`${env.APP_URL}/auth/verify?error=${preview.reason}`);
    }
    return reply.redirect(
      `${env.APP_URL}/auth/complete?token=${encodeURIComponent(q.token)}`,
    );
  });

  // SPA calls this on mount to render "Sign in as ada@example.com" — read-only.
  app.get('/api/auth/verify/peek', async (req, reply) => {
    const q = req.query as { token?: string };
    if (!q.token || typeof q.token !== 'string') {
      return reply.code(400).send({ error: 'invalid' });
    }
    const preview = previewToken(q.token);
    if (!preview.ok) return reply.code(400).send({ error: preview.reason });
    return {
      email: preview.email,
      expiresAt: preview.expiresAt,
      needsDob: preview.needsDob,
      purpose: preview.purpose,
    };
  });

  // Actual consume. Only fires after an explicit Continue click.
  app.post(
    '/api/auth/complete',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const parsed = CompleteBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid' });
      }
      const result = consumeToken(parsed.data.token, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        dob: parsed.data.dob,
      });
      if (!result.ok) {
        const status = result.reason === 'too_young' ? 403 : 400;
        return reply.code(status).send({ error: result.reason });
      }
      setSessionCookie(reply, result.sessionId);
      return { ok: true, purpose: result.purpose };
    },
  );

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
