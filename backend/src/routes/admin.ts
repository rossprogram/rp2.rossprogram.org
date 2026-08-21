import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import {
  getApplicationDetail,
  getApplicationFile,
  listApplications,
} from '../services/admin.js';
import { getObject } from '../integrations/storage/index.js';

const ListQuery = z.object({
  includeDrafts: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional(),
});

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/admin/applications',
    { preHandler: requireAuth('admin') },
    async (req) => {
      const parsed = ListQuery.safeParse(req.query);
      const includeDrafts = parsed.success
        ? parsed.data.includeDrafts === 'true' || parsed.data.includeDrafts === '1'
        : false;
      const applications = listApplications({ includeDrafts });
      return { applications };
    },
  );

  app.get(
    '/api/admin/applications/:id',
    { preHandler: requireAuth('admin') },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const detail = getApplicationDetail(id);
      if (!detail) return reply.code(404).send({ error: 'not_found' });
      return { application: detail };
    },
  );

  app.get(
    '/api/admin/applications/:id/files/:fileId/download',
    { preHandler: requireAuth('admin') },
    async (req, reply) => {
      const { id, fileId } = req.params as { id: string; fileId: string };
      const file = getApplicationFile(id, fileId);
      if (!file) return reply.code(404).send({ error: 'not_found' });
      const body = await getObject(file.storageKey);
      reply.header('Content-Type', file.contentType);
      reply.header(
        'Content-Disposition',
        `inline; filename="${sanitizeFilename(file.filename)}"`,
      );
      return reply.send(body);
    },
  );
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]/g, '_').slice(0, 200);
}
