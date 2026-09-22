import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AGREEMENTS, AGREEMENT_KEYS, type AgreementKey } from '@rp2/shared';
import { requireAuth } from '../auth/session.js';
import {
  AgreementError,
  agreementStateFor,
  applicationIdForApplicant,
  guardianOwns,
  signAgreement,
} from '../services/agreements.js';
import { isEnrolled } from '../services/offers.js';
import { studentNamesFor } from '../services/names.js';
import { discordEnabled } from '../integrations/discord/index.js';
import { linkFor } from '../services/discord-sync.js';

/*
 * Signing the Code of Conduct and the Participation Agreement.
 *
 * Two near-mirrored surfaces, because the two parties sign from two different
 * portals: the student from /agreements, the guardian from their own
 * /parent/applicant/:appId. They share the service; only the authorization
 * differs, and it differs in a way worth keeping explicit rather than
 * collapsing into one clever handler.
 */

const SignBody = z.object({
  typedName: z.string().min(1).max(200),
  contact: z
    .object({
      email: z.string().email().max(200),
      phone: z.string().min(3).max(50),
      altPhone: z.string().max(50).nullable().optional(),
    })
    .optional(),
});

function parseDocument(raw: string): AgreementKey | null {
  return (AGREEMENT_KEYS as readonly string[]).includes(raw) ? (raw as AgreementKey) : null;
}

function fail(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof AgreementError) {
    return reply.code(err.statusCode).send({ error: err.code, message: err.message });
  }
  throw err;
}

/** Signing evidence. trustProxy is on, so req.ip is the real client. */
function evidence(req: FastifyRequest): { ip: string | null; userAgent: string | null } {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua.slice(0, 500) : null };
}

/**
 * Everything a signing page needs: the documents themselves, who has signed
 * what, and — the part that makes this usable — what the OTHER party still
 * owes. A family stuck half-signed is the common case, not the edge case.
 */
function envelopeFor(applicationId: string, viewer: 'student' | 'guardian') {
  const state = agreementStateFor(applicationId);
  const names = studentNamesFor(applicationId);
  return {
    applicationId,
    documents: AGREEMENTS,
    signatures: state.signatures,
    outstanding: state.outstanding,
    fullySigned: state.fullySigned,
    guardianContact: state.guardianContact,
    enrolled: isEnrolled(applicationId),
    studentName: names.preferred ?? names.legal,
    studentLegalName: names.legal,
    viewer,
    /** What this viewer still has to do. */
    mine: state.outstanding.filter((o) => o.signerKind === viewer),
    /** What the other party still has to do — drives the nudge. */
    theirs: state.outstanding.filter((o) => o.signerKind !== viewer),
  };
}

export async function registerAgreementRoutes(app: FastifyInstance): Promise<void> {
  /* -------- student -------- */

  app.get('/api/agreements', { preHandler: requireAuth() }, async (req, reply) => {
    const appId = applicationIdForApplicant(req.currentUser!.id);
    if (!appId) return reply.code(404).send({ error: 'no_application' });

    const env = envelopeFor(appId, 'student');
    const link = discordEnabled() ? linkFor(req.currentUser!.id) : null;
    return {
      ...env,
      discord: {
        enabled: discordEnabled(),
        linked: link !== null,
        username: link?.discordUsername ?? null,
        joined: link?.joinedGuildAt != null,
      },
    };
  });

  app.post(
    '/api/agreements/:document/sign',
    { preHandler: requireAuth() },
    async (req, reply) => {
      const document = parseDocument((req.params as { document: string }).document);
      if (!document) return reply.code(404).send({ error: 'unknown_document' });

      const parsed = SignBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      }

      const appId = applicationIdForApplicant(req.currentUser!.id);
      if (!appId) return reply.code(404).send({ error: 'no_application' });

      try {
        const { created } = signAgreement({
          applicationId: appId,
          document,
          signerKind: 'student',
          signerUserId: req.currentUser!.id,
          typedName: parsed.data.typedName,
          ...evidence(req),
        });
        return { created, ...envelopeFor(appId, 'student') };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  /* -------- guardian -------- */

  app.get(
    '/api/parent/applicant/:appId/agreements',
    { preHandler: requireAuth('guardian') },
    async (req, reply) => {
      const appId = (req.params as { appId: string }).appId;
      if (!guardianOwns(req.currentUser!.id, appId)) {
        // 404, not 403: never confirm an application exists to someone who is
        // not party to it.
        return reply.code(404).send({ error: 'not_linked' });
      }
      return envelopeFor(appId, 'guardian');
    },
  );

  app.post(
    '/api/parent/applicant/:appId/agreements/:document/sign',
    { preHandler: requireAuth('guardian') },
    async (req, reply) => {
      const { appId, document: rawDoc } = req.params as { appId: string; document: string };
      const document = parseDocument(rawDoc);
      if (!document) return reply.code(404).send({ error: 'unknown_document' });
      if (!guardianOwns(req.currentUser!.id, appId)) {
        return reply.code(404).send({ error: 'not_linked' });
      }

      const parsed = SignBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      }

      try {
        const { created } = signAgreement({
          applicationId: appId,
          document,
          signerKind: 'guardian',
          signerUserId: req.currentUser!.id,
          typedName: parsed.data.typedName,
          contact: parsed.data.contact
            ? {
                email: parsed.data.contact.email,
                phone: parsed.data.contact.phone,
                altPhone: parsed.data.contact.altPhone ?? null,
              }
            : undefined,
          ...evidence(req),
        });
        return { created, ...envelopeFor(appId, 'guardian') };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );
}
