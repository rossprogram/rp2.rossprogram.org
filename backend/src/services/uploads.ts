import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { application, applicationFile } from '../db/schema.js';
import {
  signUpload,
  deleteObject,
  type UploadTicket,
} from '../integrations/storage/local.js';

const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);
const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export type SignInput = {
  userId: string;
  applicationId: string;
  kind: 'transcript' | 'aid_doc';
  filename: string;
  contentType: string;
  size: number;
};

export type SignError = 'unsupported_type' | 'too_large' | 'app_locked';

export function requestSignedUpload(
  input: SignInput,
): { ok: true; ticket: UploadTicket } | { ok: false; reason: SignError } {
  if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
    return { ok: false, reason: 'unsupported_type' };
  }
  if (input.size <= 0 || input.size > MAX_SIZE) {
    return { ok: false, reason: 'too_large' };
  }
  const app = db
    .select({ status: application.status })
    .from(application)
    .where(eq(application.id, input.applicationId))
    .get();
  if (!app || app.status !== 'draft') return { ok: false, reason: 'app_locked' };

  const ticket = signUpload({
    userId: input.userId,
    kind: input.kind,
    contentType: input.contentType,
    size: input.size,
  });
  return { ok: true, ticket };
}

export type RegisterInput = {
  applicationId: string;
  kind: 'transcript' | 'aid_doc';
  storageKey: string;
  filename: string;
  contentType: string;
  size: number;
};

export type ApplicationFileRow = {
  id: string;
  kind: 'transcript' | 'aid_doc';
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: number;
};

export async function registerFile(input: RegisterInput): Promise<ApplicationFileRow> {
  // Transcript is single-file (replace on new upload). Aid docs are multi-file.
  if (input.kind === 'transcript') {
    const existing = db
      .select()
      .from(applicationFile)
      .where(
        and(
          eq(applicationFile.applicationId, input.applicationId),
          eq(applicationFile.kind, 'transcript'),
        ),
      )
      .all();
    for (const row of existing) {
      await deleteObject(row.storageKey);
      db.delete(applicationFile).where(eq(applicationFile.id, row.id)).run();
    }
  }

  const id = nanoid();
  const now = nowSeconds();
  db.insert(applicationFile)
    .values({
      id,
      applicationId: input.applicationId,
      kind: input.kind,
      storageKey: input.storageKey,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
      uploadedAt: now,
    })
    .run();
  db.update(application)
    .set({ updatedAt: now })
    .where(eq(application.id, input.applicationId))
    .run();
  return {
    id,
    kind: input.kind,
    filename: input.filename,
    contentType: input.contentType,
    size: input.size,
    uploadedAt: now,
  };
}

export function listFiles(applicationId: string): ApplicationFileRow[] {
  return db
    .select({
      id: applicationFile.id,
      kind: applicationFile.kind,
      filename: applicationFile.filename,
      contentType: applicationFile.contentType,
      size: applicationFile.size,
      uploadedAt: applicationFile.uploadedAt,
    })
    .from(applicationFile)
    .where(eq(applicationFile.applicationId, applicationId))
    .all();
}

export async function deleteFile(
  applicationId: string,
  fileId: string,
): Promise<boolean> {
  const row = db
    .select()
    .from(applicationFile)
    .where(
      and(eq(applicationFile.id, fileId), eq(applicationFile.applicationId, applicationId)),
    )
    .get();
  if (!row) return false;
  await deleteObject(row.storageKey);
  db.delete(applicationFile).where(eq(applicationFile.id, fileId)).run();
  return true;
}

export function getFile(
  applicationId: string,
  fileId: string,
): (ApplicationFileRow & { storageKey: string }) | null {
  const row = db
    .select()
    .from(applicationFile)
    .where(
      and(eq(applicationFile.id, fileId), eq(applicationFile.applicationId, applicationId)),
    )
    .get();
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    uploadedAt: row.uploadedAt,
    storageKey: row.storageKey,
  };
}
