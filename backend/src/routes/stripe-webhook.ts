import type { FastifyInstance } from 'fastify';
import { verifyWebhook } from '../integrations/stripe/index.js';
import { handleStripeEvent, sendEnrolledEmails } from '../services/payments.js';

/*
 * The Stripe webhook — the ONLY thing that may enroll a paying family.
 *
 * The success_url redirect deliberately does not mutate state: it is often
 * never hit (mobile 3DS flows, closed tabs), it is a forgeable GET from an
 * authenticated browser, and it races this handler anyway.
 */
export async function registerStripeWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Encapsulated scope: this JSON parser applies only to routes registered
  // inside it, so the global JSON parser and the octet-stream parser that
  // server.ts installs for uploads are both left alone. Signature
  // verification needs the exact bytes, which the default parser would have
  // already turned into an object.
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => done(null, body),
    );

    scope.post(
      '/api/stripe/webhook',
      // Signature-gated, and Stripe retries in bursts.
      { config: { rateLimit: false } },
      async (req, reply) => {
        const sig = req.headers['stripe-signature'];
        if (typeof sig !== 'string') {
          return reply.code(400).send({ error: 'missing_signature' });
        }
        if (!Buffer.isBuffer(req.body)) {
          return reply.code(400).send({ error: 'expected_raw_body' });
        }

        let event;
        try {
          event = verifyWebhook(req.body, sig);
        } catch (err) {
          req.log.warn({ err }, 'stripe webhook signature verification failed');
          return reply.code(400).send({ error: 'bad_signature' });
        }

        const { result, enrolled } = handleStripeEvent(event);
        req.log.info({ eventId: event.id, type: event.type, result }, 'stripe event');

        if (enrolled) {
          void sendEnrolledEmails(enrolled).catch((err: unknown) => {
            req.log.error({ err, appId: enrolled }, 'enrolled email failed');
          });
        }

        // Always 2xx for events we do not act on, or Stripe retries forever.
        return reply.code(200).send({ received: true, result: result.status });
      },
    );
  });
}
