import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { getOrCreateApplication } from '../services/applications.js';
import { requestSignedUpload } from '../services/uploads.js';
import { putObject, verifyPutParams } from '../integrations/storage/local.js';

const SignBody = z.object({
  kind: z.enum(['transcript', 'aid_doc']),
  filename: z.string().min(1).max(256),
  contentType: z.string().min(1).max(200),
  size: z.number().int().positive(),
});

const PutQuery = z.object({
  key: z.string().min(1),
  ct: z.string().min(1),
  sz: z.coerce.number().int().positive(),
  exp: z.coerce.number().int().positive(),
  sig: z.string().min(1),
});

const MAX_BODY_BYTES = 25 * 1024 * 1024;

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/uploads/sign',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const parsed = SignBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
      const userId = req.currentUser!.id;
      const appRow = getOrCreateApplication(userId);
      const result = requestSignedUpload({
        userId,
        applicationId: appRow.id,
        kind: parsed.data.kind,
        filename: parsed.data.filename,
        contentType: parsed.data.contentType,
        size: parsed.data.size,
      });
      if (!result.ok) return reply.code(400).send({ error: result.reason });
      return {
        uploadUrl: result.ticket.uploadUrl,
        storageKey: result.ticket.key,
        expiresAt: result.ticket.expiresAt,
      };
    },
  );

  // Presigned PUT target. Unauthenticated by design — the HMAC in the query
  // string is the auth, matching S3 presigned-URL semantics.
  app.route({
    method: 'PUT',
    url: '/api/uploads/put',
    bodyLimit: MAX_BODY_BYTES,
    handler: async (req: FastifyRequest, reply) => {
      const parsed = PutQuery.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });
      const { key, ct, sz, exp, sig } = parsed.data;

      if (!verifyPutParams({ key, contentType: ct, size: sz, exp, sig })) {
        return reply.code(403).send({ error: 'invalid_signature' });
      }

      const body = req.body;
      if (!Buffer.isBuffer(body)) {
        return reply.code(400).send({ error: 'expected_binary_body' });
      }
      if (body.byteLength !== sz) {
        return reply.code(400).send({ error: 'size_mismatch' });
      }

      await putObject(key, body);
      return reply.code(204).send();
    },
  });
}
