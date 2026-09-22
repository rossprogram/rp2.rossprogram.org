import 'dotenv/config';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),

  DATABASE_URL: z.string().default('./dev.sqlite'),

  APP_URL: z.string().url().default('http://localhost:5173'),

  SESSION_SECRET: z.string().min(32),

  EMAIL_FROM: z.string().email().default('noreply@rossprogram.org'),
  EMAIL_TRANSPORT: z.enum(['console', 'ses']).default('console'),
  SES_REGION: z.string().default('us-east-1'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().default('us-east-2'),
  STORAGE_S3_PREFIX: z.string().default('uploads/'),

  // Payments are opt-in so dev (and a pilot whose Stripe account has not
  // cleared review yet) boots without them. The $0-balance enrollment path
  // works fine with this off.
  PAYMENTS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Accepts a standard secret key (sk_) or a restricted key (rk_). Restricted
  // keys are the better choice here — this app only needs Checkout Sessions:
  // write — so rejecting them would push you toward a more privileged key.
  STRIPE_SECRET_KEY: z
    .string()
    .regex(/^(sk|rk)_/, 'must be a Stripe secret (sk_) or restricted (rk_) key')
    .optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),

  // Discord is opt-in the same way payments are: with this off, agreements
  // and the rest of the portal work unchanged and the "link your Discord"
  // control simply does not appear. That is what makes shipping agreements
  // without Discord a real option rather than a theoretical one.
  DISCORD_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),
  // The interaction public key, exactly as the Discord dashboard shows it:
  // 32 bytes, hex-encoded. verifyInteraction() wraps it in an SPKI header to
  // make node:crypto accept it.
  DISCORD_PUBLIC_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'must be 64 hex characters, as shown in the Discord dashboard')
    .optional(),
  // Holding this role in the guild is what earns the staff tier of /whois.
  // Staff are not portal users, so this is the only way the bot knows.
  DISCORD_STAFF_ROLE_ID: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.PAYMENTS_ENABLED && !v.STRIPE_SECRET_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STRIPE_SECRET_KEY'],
      message: 'STRIPE_SECRET_KEY is required when PAYMENTS_ENABLED=true',
    });
  }
  if (v.PAYMENTS_ENABLED && !v.STRIPE_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STRIPE_WEBHOOK_SECRET'],
      message: 'STRIPE_WEBHOOK_SECRET is required when PAYMENTS_ENABLED=true',
    });
  }
  // Fail at boot rather than halfway through a student's first link attempt.
  const discordRequired = [
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'DISCORD_BOT_TOKEN',
    'DISCORD_GUILD_ID',
    'DISCORD_PUBLIC_KEY',
  ] as const;
  if (v.DISCORD_ENABLED) {
    for (const key of discordRequired) {
      if (!v[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when DISCORD_ENABLED=true`,
        });
      }
    }
  }
});

export const env = Env.parse(process.env);
export type Env = z.infer<typeof Env>;
