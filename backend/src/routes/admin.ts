import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { discordEnabled } from '../integrations/discord/index.js';
import { syncMember } from '../services/discord-sync.js';
import {
  getApplicationDetail,
  getApplicationFile,
  listApplications,
} from '../services/admin.js';
import { getObject } from '../integrations/storage/index.js';
import {
  OfferError,
  buildTemplate,
  listImports,
  markNotified,
  notifyTargetsFor,
  previewImport,
  publishImport,
} from '../services/offers.js';
import { sendEmail } from '../integrations/email/ses.js';
import { renderOfferPublishedEmail } from '../integrations/email/templates.js';
import { env } from '../env.js';

const TemplateQuery = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

const UploadQuery = z.object({
  filename: z.string().min(1).max(255).default('upload.csv'),
});

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

  /* -------- offer import -------- */

  app.get(
    '/api/admin/offers/template',
    { preHandler: requireAuth('admin') },
    async (req, reply) => {
      const { format } = TemplateQuery.parse(req.query);
      const buf = buildTemplate(format);
      const stamp = new Date().toISOString().slice(0, 10);
      reply.header(
        'Content-Type',
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      reply.header(
        'Content-Disposition',
        `attachment; filename="rp2-offers-${stamp}.${format}"`,
      );
      return reply.send(buf);
    },
  );

  // The body is the raw file. server.ts already registers an octet-stream
  // buffer parser for the presigned-PUT flow, so this needs no multipart.
  app.post(
    '/api/admin/offers/preview',
    { preHandler: requireAuth('admin') },
    async (req, reply) => {
      const { filename } = UploadQuery.parse(req.query);
      const buf = req.body;
      if (!Buffer.isBuffer(buf)) {
        return reply.code(400).send({ error: 'expected_binary_body' });
      }
      try {
        return { preview: previewImport(buf, filename) };
      } catch (err) {
        return sendOfferError(reply, err);
      }
    },
  );

  app.post(
    '/api/admin/offers/publish',
    { preHandler: requireAuth('admin') },
    async (req, reply) => {
      const { filename } = UploadQuery.parse(req.query);
      const buf = req.body;
      if (!Buffer.isBuffer(buf)) {
        return reply.code(400).send({ error: 'expected_binary_body' });
      }
      const importId = req.headers['x-import-id'];
      const expectedHash = req.headers['x-file-hash'];
      if (typeof importId !== 'string' || importId.length < 8) {
        return reply.code(400).send({ error: 'missing_import_id' });
      }
      try {
        const result = publishImport({
          buf,
          filename,
          importId,
          expectedHash: typeof expectedHash === 'string' ? expectedHash : '',
          adminUserId: req.currentUser!.id,
        });
        req.log.info(
          { importId: result.importId, applied: result.applied },
          'offer import published',
        );

        /*
         * A publish can move a student between sections or groups, which makes
         * their Discord roles wrong. Re-sync the rows that changed, after the
         * transaction and without blocking the response — exactly how the
         * enrolled email is sent after the Stripe webhook commits. A Discord
         * outage must never fail an import.
         */
        if (discordEnabled()) {
          for (const appId of result.changedAppIds) {
            void syncMember(appId).catch((err: unknown) => {
              req.log.error({ err, appId }, 'discord sync after publish failed');
            });
          }
        }

        return result;
      } catch (err) {
        return sendOfferError(reply, err);
      }
    },
  );

  app.post(
    '/api/admin/offers/imports/:importId/notify',
    { preHandler: requireAuth('admin') },
    async (req, reply) => {
      const { importId } = req.params as { importId: string };
      let targets;
      try {
        targets = notifyTargetsFor(importId);
      } catch (err) {
        return sendOfferError(reply, err);
      }

      const recipients: string[] = [];
      let sent = 0;
      let skipped = 0;

      // One send per address, so a bad guardian address cannot suppress the
      // student's copy (or the other way round).
      for (const t of targets) {
        for (const to of t.emails) {
          const mail = renderOfferPublishedEmail({
            studentName: t.studentName,
            portalUrl: `${env.APP_URL}/status`,
          });
          try {
            await sendEmail({ to, ...mail });
            recipients.push(to);
            sent += 1;
          } catch (err) {
            skipped += 1;
            req.log.error({ err, applicationId: t.applicationId }, 'offer notify failed');
          }
        }
      }

      const result = { sent, skipped, recipients };
      markNotified(importId, result);
      return result;
    },
  );

  app.get(
    '/api/admin/offers/imports',
    { preHandler: requireAuth('admin') },
    async () => ({ imports: listImports() }),
  );
}

function sendOfferError(reply: FastifyReply, err: unknown): never | FastifyReply {
  if (err instanceof OfferError) {
    return reply.code(err.statusCode).send({ error: err.code, message: err.message });
  }
  throw err;
}


function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ]/g, '_').slice(0, 200);
}
