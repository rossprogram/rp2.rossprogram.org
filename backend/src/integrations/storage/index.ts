/*
 * Storage driver dispatcher. Callers import from here; we route to local
 * disk or S3 based on env.STORAGE_DRIVER at boot time.
 */

import { env } from '../../env.js';
import * as local from './local.js';
import * as s3 from './s3.js';
import type { UploadTicket } from './local.js';

const impl = env.STORAGE_DRIVER === 's3' ? s3 : local;

export const signUpload: (input: {
  userId: string;
  kind: 'transcript' | 'aid_doc';
  contentType: string;
  size: number;
}) => Promise<UploadTicket> = async (input) => impl.signUpload(input);

export const putObject: (key: string, body: Buffer) => Promise<void> = (key, body) =>
  impl.putObject(key, body);

export const getObject: (key: string) => Promise<Buffer> = (key) => impl.getObject(key);

export const deleteObject: (key: string) => Promise<void> = (key) =>
  impl.deleteObject(key);

export type { UploadTicket };

// Re-export the HMAC helper used only by the local-mode PUT endpoint.
export { verifyPutParams } from './local.js';
