import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import { registerAuthRoutes } from './routes/auth.js';
import { attachSession } from './auth/session.js';
import { runMigrations } from './db/migrate.js';

async function build() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      redact: ['req.headers.cookie', 'req.body.email'],
    },
    trustProxy: true,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  app.addHook('preHandler', attachSession);

  app.get('/api/health', async () => ({ ok: true }));

  await registerAuthRoutes(app);

  return app;
}

async function main() {
  runMigrations();
  const app = await build();
  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
