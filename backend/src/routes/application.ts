import type { FastifyInstance } from 'fastify';
import { UpsertResponsesBody } from '@rp2/shared';
import { requireAuth } from '../auth/session.js';
import {
  ApplicationLocked,
  loadApplicationView,
  submitApplication,
  upsertResponses,
} from '../services/applications.js';

export async function registerApplicationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/application/me',
    { preHandler: requireAuth() },
    async (req) => {
      return loadApplicationView(req.currentUser!.id);
    },
  );

  app.patch(
    '/api/application/me/responses',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const parsed = UpsertResponsesBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      }
      try {
        const { updatedAt } = upsertResponses(req.currentUser!.id, parsed.data.responses);
        return { updatedAt };
      } catch (err) {
        if (err instanceof ApplicationLocked) {
          return reply.code(409).send({ error: 'application_locked', status: err.status });
        }
        throw err;
      }
    },
  );

  app.post(
    '/api/application/me/submit',
    { preHandler: requireAuth() },
    async (req, reply) => {
      try {
        return submitApplication(req.currentUser!.id);
      } catch (err) {
        if (err instanceof ApplicationLocked) {
          return reply.code(409).send({ error: 'application_locked', status: err.status });
        }
        throw err;
      }
    },
  );
}
