import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';

// Raw binary body parser for presigned PUT uploads. Body arrives as
// Buffer; multipart/form-data isn't used — the PUT is a single file blob.

import { env } from './env.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerApplicationRoutes } from './routes/application.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerParentRoutes } from './routes/parent.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { registerOfferRoutes } from './routes/offer.js';
import { registerStripeWebhookRoutes } from './routes/stripe-webhook.js';
import { registerAgreementRoutes } from './routes/agreements.js';
import { registerDiscordRoutes } from './routes/discord.js';
import { registerAdminOnboardingRoutes } from './routes/admin-onboarding.js';
import { registerMentorRoutes } from './routes/mentor.js';
import { initStripe } from './integrations/stripe/index.js';
import { attachSession } from './auth/session.js';
import { runMigrations } from './db/migrate.js';

export async function build() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      redact: ['req.headers.cookie', 'req.body.email'],
    },
    trustProxy: true,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, {
    // Effectively off under test: the suite drives hundreds of requests in a
    // second and would otherwise trip the limiter, making failures depend on
    // test order. Per-route limits still apply where they are declared.
    max: env.NODE_ENV === 'test' ? 100_000 : 100,
    timeWindow: '1 minute',
  });

  app.addContentTypeParser(
    ['application/pdf', 'image/png', 'image/jpeg', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  app.addHook('preHandler', attachSession);

  app.get('/api/health', async () => ({ ok: true }));

  await registerAuthRoutes(app);
  await registerApplicationRoutes(app);
  await registerAdminRoutes(app);
  await registerParentRoutes(app);
  await registerUploadRoutes(app);
  await registerOfferRoutes(app);
  await registerStripeWebhookRoutes(app);
  await registerAgreementRoutes(app);
  await registerDiscordRoutes(app);
  await registerAdminOnboardingRoutes(app);
  await registerMentorRoutes(app);

  return app;
}

async function main() {
  runMigrations();
  // Warm the SDK so the webhook handler can verify signatures synchronously.
  await initStripe();
  const app = await build();
  await app.listen({ port: env.PORT, host: env.HOST });
}

/*
 * Only start listening when this file IS the process, not when a test imports
 * build(). Without the guard every test file that imports the server races for
 * port 3000, and the loser exits the whole worker. Same idiom as migrate.ts.
 */
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.ts');

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
