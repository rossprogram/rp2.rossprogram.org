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
});

export const env = Env.parse(process.env);
export type Env = z.infer<typeof Env>;
