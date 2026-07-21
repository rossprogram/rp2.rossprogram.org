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
});

export const env = Env.parse(process.env);
export type Env = z.infer<typeof Env>;
