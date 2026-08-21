import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  application,
  applicationAvailability,
  applicationCoursePreference,
  applicationFile,
  applicationResponse,
  guardianLink,
  user,
  userRole,
} from '../db/schema.js';
import type { ApplicationStatus } from '@rp2/shared';

export type AdminListRow = {
  id: string;
  applicantUserId: string;
  applicantEmail: string;
  legalName: string | null;
  preferredName: string | null;
  location: string | null;
  gradeLevel: string | null;
  status: ApplicationStatus;
  submittedAt: number | null;
  updatedAt: number;
  guardianEmail: string | null;
  guardianAccepted: boolean;
  coursePreferences: string[];
  fileCount: number;
};

const RESPONSE_KEYS_FOR_LIST = [
  'student_legal_name',
  'student_preferred_name',
  'student_location',
  'student_grade_level',
] as const;

export function listApplications(opts: { includeDrafts: boolean }): AdminListRow[] {
  const rows = db
    .select({
      id: application.id,
      applicantUserId: application.applicantUserId,
      status: application.status,
      submittedAt: application.submittedAt,
      updatedAt: application.updatedAt,
      applicantEmail: user.email,
    })
    .from(application)
    .innerJoin(user, eq(user.id, application.applicantUserId))
    .orderBy(desc(application.submittedAt), desc(application.updatedAt))
    .all();

  const kept = opts.includeDrafts
    ? rows
    : rows.filter((r) => r.status !== 'draft');

  return kept.map((r) => {
    const responses = readResponses(r.id, RESPONSE_KEYS_FOR_LIST);
    const link = db
      .select({ email: user.email, acceptedAt: guardianLink.acceptedAt })
      .from(guardianLink)
      .innerJoin(user, eq(user.id, guardianLink.guardianUserId))
      .where(eq(guardianLink.applicantUserId, r.applicantUserId))
      .get();
    const coursePreferences = db
      .select({
        courseKey: applicationCoursePreference.courseKey,
        rank: applicationCoursePreference.rank,
      })
      .from(applicationCoursePreference)
      .where(eq(applicationCoursePreference.applicationId, r.id))
      .all()
      .sort((a, b) => a.rank - b.rank)
      .map((c) => c.courseKey);
    const fileCount = db
      .select({ id: applicationFile.id })
      .from(applicationFile)
      .where(eq(applicationFile.applicationId, r.id))
      .all().length;
    return {
      id: r.id,
      applicantUserId: r.applicantUserId,
      applicantEmail: r.applicantEmail,
      legalName: readString(responses['student_legal_name']),
      preferredName: readString(responses['student_preferred_name']),
      location: readString(responses['student_location']),
      gradeLevel: readString(responses['student_grade_level']),
      status: r.status,
      submittedAt: r.submittedAt,
      updatedAt: r.updatedAt,
      guardianEmail: link?.email ?? null,
      guardianAccepted: !!link?.acceptedAt,
      coursePreferences,
      fileCount,
    };
  });
}

export type AdminDetail = {
  id: string;
  applicantUserId: string;
  applicantEmail: string;
  status: ApplicationStatus;
  submittedAt: number | null;
  guardianSubmittedAt: number | null;
  updatedAt: number;
  createdAt: number;
  responses: Record<string, unknown>;
  availability: { weekday: number; startMin: number; endMin: number }[];
  coursePreferences: { courseKey: string; rank: number }[];
  files: {
    id: string;
    kind: 'transcript' | 'aid_doc';
    filename: string;
    contentType: string;
    size: number;
    uploadedAt: number;
  }[];
  guardian: {
    email: string;
    acceptedAt: number | null;
    invitedAt: number | null;
    relationship: 'parent' | 'guardian' | 'other';
  } | null;
};

export function getApplicationDetail(id: string): AdminDetail | null {
  const app = db
    .select({
      id: application.id,
      applicantUserId: application.applicantUserId,
      status: application.status,
      submittedAt: application.submittedAt,
      guardianSubmittedAt: application.guardianSubmittedAt,
      updatedAt: application.updatedAt,
      createdAt: application.createdAt,
      applicantEmail: user.email,
    })
    .from(application)
    .innerJoin(user, eq(user.id, application.applicantUserId))
    .where(eq(application.id, id))
    .get();
  if (!app) return null;

  const responseRows = db
    .select({
      questionKey: applicationResponse.questionKey,
      value: applicationResponse.value,
    })
    .from(applicationResponse)
    .where(eq(applicationResponse.applicationId, id))
    .all();
  const responses: Record<string, unknown> = {};
  for (const r of responseRows) {
    try {
      responses[r.questionKey] = JSON.parse(r.value);
    } catch {
      responses[r.questionKey] = r.value;
    }
  }

  const availability = db
    .select({
      weekday: applicationAvailability.weekday,
      startMin: applicationAvailability.startMin,
      endMin: applicationAvailability.endMin,
    })
    .from(applicationAvailability)
    .where(eq(applicationAvailability.applicationId, id))
    .all();

  const coursePreferences = db
    .select({
      courseKey: applicationCoursePreference.courseKey,
      rank: applicationCoursePreference.rank,
    })
    .from(applicationCoursePreference)
    .where(eq(applicationCoursePreference.applicationId, id))
    .all();

  const files = db
    .select({
      id: applicationFile.id,
      kind: applicationFile.kind,
      filename: applicationFile.filename,
      contentType: applicationFile.contentType,
      size: applicationFile.size,
      uploadedAt: applicationFile.uploadedAt,
    })
    .from(applicationFile)
    .where(eq(applicationFile.applicationId, id))
    .all();

  const link = db
    .select({
      email: user.email,
      acceptedAt: guardianLink.acceptedAt,
      invitedAt: guardianLink.invitedAt,
      relationship: guardianLink.relationship,
    })
    .from(guardianLink)
    .innerJoin(user, eq(user.id, guardianLink.guardianUserId))
    .where(eq(guardianLink.applicantUserId, app.applicantUserId))
    .get();

  return {
    id: app.id,
    applicantUserId: app.applicantUserId,
    applicantEmail: app.applicantEmail,
    status: app.status,
    submittedAt: app.submittedAt,
    guardianSubmittedAt: app.guardianSubmittedAt,
    updatedAt: app.updatedAt,
    createdAt: app.createdAt,
    responses,
    availability,
    coursePreferences,
    files,
    guardian: link
      ? {
          email: link.email,
          acceptedAt: link.acceptedAt,
          invitedAt: link.invitedAt,
          relationship: link.relationship,
        }
      : null,
  };
}

export function getApplicationFile(
  applicationId: string,
  fileId: string,
): {
  id: string;
  kind: 'transcript' | 'aid_doc';
  filename: string;
  contentType: string;
  size: number;
  storageKey: string;
} | null {
  const row = db
    .select()
    .from(applicationFile)
    .where(
      and(
        eq(applicationFile.id, fileId),
        eq(applicationFile.applicationId, applicationId),
      ),
    )
    .get();
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    storageKey: row.storageKey,
  };
}

export function isAdmin(userId: string): boolean {
  const row = db
    .select({ role: userRole.role })
    .from(userRole)
    .where(and(eq(userRole.userId, userId), eq(userRole.role, 'admin')))
    .get();
  return !!row;
}

function readResponses(
  applicationId: string,
  keys: readonly string[],
): Record<string, unknown> {
  const rows = db
    .select({
      questionKey: applicationResponse.questionKey,
      value: applicationResponse.value,
    })
    .from(applicationResponse)
    .where(
      and(
        eq(applicationResponse.applicationId, applicationId),
        inArray(applicationResponse.questionKey, [...keys]),
      ),
    )
    .all();
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.questionKey] = JSON.parse(r.value);
    } catch {
      out[r.questionKey] = r.value;
    }
  }
  return out;
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}
