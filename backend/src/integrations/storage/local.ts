import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../env.js';

/*
 * S3-shaped upload API backed by local disk in dev.
 *
 * Flow:
 *   1. Client asks the backend to "sign" an upload → server returns a
 *      short-lived signed URL that includes an HMAC.
 *   2. Client PUTs the file body to that URL.
 *   3. Server verifies the HMAC and writes the file to STORAGE_LOCAL_DIR.
 *
 * The HMAC keeps the presign endpoint auth-gated (route middleware) while the
 * actual upload URL can be hit unauthenticated — matching the S3 behavior
 * where the presigned URL is the auth.
 */

const SIGN_TTL_SECONDS = 15 * 60;

export type UploadTicket = {
  key: string;
  uploadUrl: string;
  expiresAt: number;
  maxSize: number;
  contentType: string;
};

export function signUpload(input: {
  userId: string;
  kind: 'transcript' | 'aid_doc';
  contentType: string;
  size: number;
}): UploadTicket {
  const id = randomBytes(16).toString('base64url');
  const key = `${input.kind}/${input.userId}/${id}`;
  const expiresAt = Math.floor(Date.now() / 1000) + SIGN_TTL_SECONDS;
  const sig = sign(key, input.contentType, input.size, expiresAt);
  const uploadUrl =
    `/api/uploads/put?key=${encodeURIComponent(key)}` +
    `&exp=${expiresAt}` +
    `&ct=${encodeURIComponent(input.contentType)}` +
    `&sz=${input.size}` +
    `&sig=${sig}`;
  return { key, uploadUrl, expiresAt, maxSize: input.size, contentType: input.contentType };
}

function sign(key: string, contentType: string, size: number, exp: number): string {
  const h = createHmac('sha256', env.SESSION_SECRET);
  h.update(`${key}\n${contentType}\n${size}\n${exp}`);
  return h.digest('base64url');
}

function verify(sig: string, key: string, contentType: string, size: number, exp: number): boolean {
  const expected = sign(key, contentType, size, exp);
  const a = Buffer.from(sig, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyPutParams(params: {
  key: string;
  contentType: string;
  size: number;
  exp: number;
  sig: string;
}): boolean {
  if (params.exp <= Math.floor(Date.now() / 1000)) return false;
  return verify(params.sig, params.key, params.contentType, params.size, params.exp);
}

function keyToPath(key: string): string {
  // Reject path-traversal attempts. Keys are `${kind}/${userId}/${id}` and
  // both kind and userId/id are constrained by our signing flow.
  if (key.includes('..') || key.startsWith('/')) {
    throw new Error('invalid key');
  }
  return path.join(env.STORAGE_LOCAL_DIR, key);
}

export async function putObject(key: string, body: Buffer): Promise<void> {
  const p = keyToPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, body);
}

export async function getObject(key: string): Promise<Buffer> {
  return readFile(keyToPath(key));
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await unlink(keyToPath(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function objectSize(key: string): Promise<number> {
  const s = await stat(keyToPath(key));
  return s.size;
}
