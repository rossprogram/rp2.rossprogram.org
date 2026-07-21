import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UpsertResponsesBody } from '@rp2/shared';
import { requireAuth } from '../auth/session.js';
import {
  ApplicationLocked,
  GuardianEmailLocked,
  getOrCreateApplication,
  loadApplicationView,
  submitApplication,
  upsertResponses,
} from '../services/applications.js';
import {
  deleteFile,
  getFile,
  listFiles,
  registerFile,
} from '../services/uploads.js';
import { getGuardianStatusForApplicant } from '../services/guardian.js';
import { requestGuardianInvite } from '../auth/magic-link.js';
import { db } from '../db/client.js';
import { and, eq, isNull } from 'drizzle-orm';
import { application, applicationResponse, guardianLink, user } from '../db/schema.js';
import { getObject } from '../integrations/storage/index.js';

const RegisterFileBody = z.object({
  kind: z.enum(['transcript', 'aid_doc']),
  storageKey: z.string().min(1),
  filename: z.string().min(1).max(256),
  contentType: z.string().min(1).max(200),
  size: z.number().int().positive(),
});

export async function registerApplicationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/application/me',
    { preHandler: requireAuth() },
    async (req) => {
      const view = loadApplicationView(req.currentUser!.id);
      const guardian = getGuardianStatusForApplicant(req.currentUser!.id);
      return { ...view, guardian };
    },
  );

  app.post(
    '/api/application/me/resend-guardian-invite',
    {
      preHandler: requireAuth(),
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const userId = req.currentUser!.id;
      const link = db
        .select()
        .from(guardianLink)
        .where(eq(guardianLink.applicantUserId, userId))
        .get();
      if (!link) return reply.code(404).send({ error: 'no_guardian' });
      const guardian = db.select().from(user).where(eq(user.id, link.guardianUserId)).get();
      if (!guardian) return reply.code(404).send({ error: 'no_guardian' });

      const nameRow = db
        .select({ value: applicationResponse.value })
        .from(applicationResponse)
        .innerJoin(application, eq(application.id, applicationResponse.applicationId))
        .where(
          and(
            eq(application.applicantUserId, userId),
            eq(applicationResponse.questionKey, 'student_legal_name'),
          ),
        )
        .get();
      const applicantName = readJsonString(nameRow?.value) ?? '';

      await requestGuardianInvite(guardian.email, applicantName);
      const now = Math.floor(Date.now() / 1000);
      db.update(guardianLink)
        .set({ invitedAt: now })
        .where(
          and(
            eq(guardianLink.applicantUserId, userId),
            isNull(guardianLink.acceptedAt),
          ),
        )
        .run();
      return { ok: true };
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
        const { updatedAt } = await upsertResponses(
          req.currentUser!.id,
          parsed.data.responses,
        );
        return { updatedAt };
      } catch (err) {
        if (err instanceof ApplicationLocked) {
          return reply.code(409).send({ error: 'application_locked', status: err.status });
        }
        if (err instanceof GuardianEmailLocked) {
          return reply.code(409).send({ error: 'guardian_email_locked', reason: err.reason });
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

  app.get(
    '/api/application/me/files',
    { preHandler: requireAuth() },
    async (req) => {
      const appRow = getOrCreateApplication(req.currentUser!.id);
      return { files: listFiles(appRow.id) };
    },
  );

  app.post(
    '/api/application/me/files',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const parsed = RegisterFileBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body' });
      }
      const appRow = getOrCreateApplication(req.currentUser!.id);
      if (appRow.status !== 'draft') {
        return reply.code(409).send({ error: 'application_locked', status: appRow.status });
      }
      const row = await registerFile({
        applicationId: appRow.id,
        kind: parsed.data.kind,
        storageKey: parsed.data.storageKey,
        filename: parsed.data.filename,
        contentType: parsed.data.contentType,
        size: parsed.data.size,
        uploadedByUserId: req.currentUser!.id,
      });
      return { file: row };
    },
  );

  app.delete(
    '/api/application/me/files/:id',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const appRow = getOrCreateApplication(req.currentUser!.id);
      if (appRow.status !== 'draft') {
        return reply.code(409).send({ error: 'application_locked', status: appRow.status });
      }
      const ok = await deleteFile(appRow.id, id);
      if (!ok) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/application/me/files/:id/download',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const appRow = getOrCreateApplication(req.currentUser!.id);
      const file = getFile(appRow.id, id);
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

function readJsonString(v: string | undefined): string | null {
  if (v === undefined) return null;
  try {
    const parsed = JSON.parse(v);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return v;
  }
}
