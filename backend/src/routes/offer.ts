import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth } from '../auth/session.js';
import {
  OfferError,
  authorizeOfferActor,
  loadOfferEnvelope,
  respondToOffer,
} from '../services/offers.js';
import { paymentsEnabled } from '../integrations/stripe/index.js';
import { startCheckout, sendEnrolledEmails } from '../services/payments.js';

/*
 * The family's view of their offer.
 *
 * Every route is requireAuth() only — authorizeOfferActor does the real work,
 * because a student and their guardian are equally entitled to act here. A
 * caller who is neither gets 404, never 403, so the endpoint never confirms
 * that an application id exists.
 */
export async function registerOfferRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/offer/:appId', { preHandler: requireAuth() }, async (req, reply) => {
    const { appId } = req.params as { appId: string };
    const actor = authorizeOfferActor(req.currentUser!.id, appId);
    if (!actor) return reply.code(404).send({ error: 'not_found' });
    try {
      return loadOfferEnvelope(appId, actor, paymentsEnabled());
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/offer/:appId/accept', { preHandler: requireAuth() }, async (req, reply) => {
    const { appId } = req.params as { appId: string };
    const actor = authorizeOfferActor(req.currentUser!.id, appId);
    if (!actor) return reply.code(404).send({ error: 'not_found' });

    try {
      const result = respondToOffer(appId, actor, 'accepted');
      req.log.info(
        { appId, actorKind: actor.kind, status: result.status },
        'offer accepted',
      );
      // A $0 balance enrolls immediately, so the thank-you goes out here
      // rather than from the webhook.
      if (result.status === 'enrolled' && !result.idempotent) {
        void sendEnrolledEmails(appId).catch((err: unknown) => {
          req.log.error({ err, appId }, 'enrolled email failed');
        });
      }
      return result;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/offer/:appId/decline', { preHandler: requireAuth() }, async (req, reply) => {
    const { appId } = req.params as { appId: string };
    const actor = authorizeOfferActor(req.currentUser!.id, appId);
    if (!actor) return reply.code(404).send({ error: 'not_found' });
    try {
      const result = respondToOffer(appId, actor, 'declined');
      req.log.info({ appId, actorKind: actor.kind }, 'offer declined');
      return result;
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post(
    '/api/offer/:appId/checkout-session',
    {
      preHandler: requireAuth(),
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const { appId } = req.params as { appId: string };
      const actor = authorizeOfferActor(req.currentUser!.id, appId);
      if (!actor) return reply.code(404).send({ error: 'not_found' });
      try {
        return await startCheckout(appId, actor);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );
}

function fail(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof OfferError) {
    return reply.code(err.statusCode).send({ error: err.code, message: err.message });
  }
  throw err;
}
