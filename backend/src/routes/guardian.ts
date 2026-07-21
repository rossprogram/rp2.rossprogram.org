import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import {
  completeGuardianPart,
  getGuardianApplicantView,
  listLinkedApplicants,
  patchGuardianTasks,
} from '../services/guardian.js';
import {
  deleteFile,
  getFile,
  listFiles,
  registerFile,
  requestSignedUpload,
} from '../services/uploads.js';
import { db } from '../db/client.js';
import { application, guardianLink } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getObject } from '../integrations/storage/index.js';

const PatchBody = z.object({
  guardianSignature: z.string().max(500).optional(),
  aidLevel: z.enum(['none', 'partial', 'full']).optional(),
});

const RegisterFileBody = z.object({
  storageKey: z.string().min(1),
  filename: z.string().min(1).max(256),
  contentType: z.string().min(1).max(200),
  size: z.number().int().positive(),
});

const SignBody = z.object({
  filename: z.string().min(1).max(256),
  contentType: z.string().min(1).max(200),
  size: z.number().int().positive(),
});

function requireLinkedGuardian(
  guardianUserId: string,
  applicationId: string,
): { ok: true; applicantUserId: string } | { ok: false } {
  const row = db
    .select({ applicantUserId: application.applicantUserId })
    .from(guardianLink)
    .innerJoin(application, eq(application.applicantUserId, guardianLink.applicantUserId))
    .where(
      and(
        eq(guardianLink.guardianUserId, guardianUserId),
        eq(application.id, applicationId),
      ),
    )
    .get();
  if (!row) return { ok: false };
  return { ok: true, applicantUserId: row.applicantUserId };
}

export async function registerGuardianRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/guardian/me',
    { preHandler: requireAuth('guardian') },
    async (req) => {
      return { applicants: listLinkedApplicants(req.currentUser!.id) };
    },
  );

  app.get(
    '/api/guardian/applicant/:appId',
    { preHandler: requireAuth('guardian') },
    async (req, reply) => {
      const { appId } = req.params as { appId: string };
      const view = getGuardianApplicantView(req.currentUser!.id, appId);
      if (!view) return reply.code(404).send({ error: 'not_found' });
      const files = listFiles(appId).filter((f) => f.kind === 'aid_doc');
      return { applicant: view, files };
    },
  );

  app.patch(
    '/api/guardian/applicant/:appId',
    { preHandler: requireAuth('guardian') },
    async (req, reply) => {
      const parsed = PatchBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const { appId } = req.params as { appId: string };
      const result = patchGuardianTasks(req.currentUser!.id, appId, parsed.data);
      if (!result.ok) {
        return reply.code(result.reason === 'not_linked' ? 404 : 409).send({ error: result.reason });
      }
      return { ok: true };
    },
  );

  app.post(
    '/api/guardian/applicant/:appId/complete',
    { preHandler: requireAuth('guardian') },
    async (req, reply) => {
      const { appId } = req.params as { appId: string };
      const result = await completeGuardianPart(req.currentUser!.id, appId);
      if (!result.ok) {
        const code = result.reason === 'not_linked' ? 404 : 409;
        return reply.code(code).send({ error: result.reason });
      }
      return { ok: true, status: result.status };
    },
  );

  app.post(
    '/api/guardian/applicant/:appId/uploads/sign',
    { preHandler: requireAuth('guardian') },
    async (req, reply) => {
      const parsed = SignBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const { appId } = req.params as { appId: string };
      const link = requireLinkedGuardian(req.currentUser!.id, appId);
      if (!link.ok) return reply.code(404).send({ error: 'not_found' });
      const result = await requestSignedUpload({
        userId: req.currentUser!.id,
        applicationId: appId,
        kind: 'aid_doc',
        filename: parsed.data.filename,
        contentType: parsed.data.contentType,
        size: parsed.data.size,
      });
      if (!result.ok) return reply.code(400).send({ error: result.reason });
      return { ticket: result.ticket };
    },
  );

  app.post(
    '/api/guardian/applicant/:appId/files',
    { preHandler: requireAuth('guardian') },
    async (req, reply) => {
      const parsed = RegisterFileBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const { appId } = req.params as { appId: string };
      const link = requireLinkedGuardian(req.currentUser!.id, appId);
      if (!link.ok) return reply.code(404).send({ error: 'not_found' });
      const row = await registerFile({
        applicationId: appId,
        kind: 'aid_doc',
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
    '/api/guardian/applicant/:appId/files/:id',
    { preHandler: requireAuth('guardian') },
    async (req, reply) => {
      const { appId, id } = req.params as { appId: string; id: string };
      const link = requireLinkedGuardian(req.currentUser!.id, appId);
      if (!link.ok) return reply.code(404).send({ error: 'not_found' });
      const ok = await deleteFile(appId, id);
      if (!ok) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/guardian/applicant/:appId/files/:id/download',
    { preHandler: requireAuth('guardian') },
    async (req, reply) => {
      const { appId, id } = req.params as { appId: string; id: string };
      const link = requireLinkedGuardian(req.currentUser!.id, appId);
      if (!link.ok) return reply.code(404).send({ error: 'not_found' });
      const file = getFile(appId, id);
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
