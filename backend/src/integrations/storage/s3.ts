import { randomBytes } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../env.js';
import type { UploadTicket } from './local.js';

/*
 * Real S3 storage driver. Credentials come from the EC2 instance role via
 * IMDS — the SDK picks them up automatically if AWS_ACCESS_KEY_ID isn't set.
 */

const SIGN_TTL_SECONDS = 15 * 60;

let client: S3Client | null = null;
function getClient(): S3Client {
  if (client) return client;
  client = new S3Client({ region: env.STORAGE_S3_REGION });
  return client;
}

function bucket(): string {
  if (!env.STORAGE_S3_BUCKET) {
    throw new Error(
      'STORAGE_S3_BUCKET is required when STORAGE_DRIVER=s3 (set in backend/.env)',
    );
  }
  return env.STORAGE_S3_BUCKET;
}

function withPrefix(key: string): string {
  const prefix = env.STORAGE_S3_PREFIX.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${key}` : key;
}

export async function signUpload(input: {
  userId: string;
  kind: 'transcript' | 'aid_doc';
  contentType: string;
  size: number;
}): Promise<UploadTicket> {
  const id = randomBytes(16).toString('base64url');
  const key = `${input.kind}/${input.userId}/${id}`;
  const fullKey = withPrefix(key);
  const expiresAt = Math.floor(Date.now() / 1000) + SIGN_TTL_SECONDS;

  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: fullKey,
    ContentType: input.contentType,
    ContentLength: input.size,
  });
  const uploadUrl = await getSignedUrl(getClient(), cmd, {
    expiresIn: SIGN_TTL_SECONDS,
  });

  return { key, uploadUrl, expiresAt, maxSize: input.size, contentType: input.contentType };
}

export async function putObject(_key: string, _body: Buffer): Promise<void> {
  throw new Error('putObject is not used with the s3 driver (client uploads direct to S3)');
}

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const readable = stream as AsyncIterable<Uint8Array>;
  for await (const chunk of readable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function getObject(key: string): Promise<Buffer> {
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: withPrefix(key) });
  const res = await getClient().send(cmd);
  if (!res.Body) throw new Error(`empty body for ${key}`);
  return streamToBuffer(res.Body);
}

export async function deleteObject(key: string): Promise<void> {
  const cmd = new DeleteObjectCommand({ Bucket: bucket(), Key: withPrefix(key) });
  await getClient().send(cmd);
}
