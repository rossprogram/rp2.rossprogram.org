import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  application,
  applicantProfile,
  applicationResponse,
  applicationAvailability,
  applicationCoursePreference,
} from '../db/schema.js';
import type { ApplicationStatus } from '@rp2/shared';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/*
 * A subset of applicant_profile columns is denormalized out of
 * application_response for admin filtering. `syncKeys` maps question_key ->
 * profile column so we keep the two in sync on every upsert.
 */
const PROFILE_KEYS = {
  student_legal_name: 'legalName',
  student_preferred_name: 'preferredName',
  student_grade_level: 'gradeLevel',
  student_school: 'school',
  student_location: 'location',
  student_timezone: 'timezone',
} as const satisfies Record<string, keyof typeof applicantProfile.$inferInsert>;

type ProfileUpdate = Partial<Record<(typeof PROFILE_KEYS)[keyof typeof PROFILE_KEYS], string>>;

export function getOrCreateApplication(userId: string): {
  id: string;
  status: ApplicationStatus;
  submittedAt: number | null;
  updatedAt: number;
} {
  const existing = db
    .select()
    .from(application)
    .where(eq(application.applicantUserId, userId))
    .get();
  if (existing) {
    return {
      id: existing.id,
      status: existing.status,
      submittedAt: existing.submittedAt,
      updatedAt: existing.updatedAt,
    };
  }
  const id = nanoid();
  const now = nowSeconds();
  db.insert(application)
    .values({ id, applicantUserId: userId, status: 'draft' })
    .run();
  db.insert(applicantProfile)
    .values({ userId })
    .onConflictDoNothing()
    .run();
  return { id, status: 'draft', submittedAt: null, updatedAt: now };
}

export function loadApplicationView(userId: string): {
  id: string;
  status: ApplicationStatus;
  submittedAt: number | null;
  updatedAt: number;
  responses: Record<string, unknown>;
} {
  const app = getOrCreateApplication(userId);
  const rows = db
    .select({
      questionKey: applicationResponse.questionKey,
      value: applicationResponse.value,
    })
    .from(applicationResponse)
    .where(eq(applicationResponse.applicationId, app.id))
    .all();
  const responses: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      responses[row.questionKey] = JSON.parse(row.value);
    } catch {
      responses[row.questionKey] = row.value;
    }
  }
  return { ...app, responses };
}

export function upsertResponses(
  userId: string,
  incoming: Record<string, unknown>,
): { updatedAt: number } {
  const app = getOrCreateApplication(userId);
  if (app.status !== 'draft') {
    throw new ApplicationLocked(app.status);
  }
  const now = nowSeconds();

  const profileUpdate: ProfileUpdate = {};

  db.transaction(() => {
    for (const [key, value] of Object.entries(incoming)) {
      const serialized = JSON.stringify(value ?? null);
      db.insert(applicationResponse)
        .values({
          applicationId: app.id,
          questionKey: key,
          value: serialized,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [applicationResponse.applicationId, applicationResponse.questionKey],
          set: { value: serialized, updatedAt: now },
        })
        .run();

      const profileCol = PROFILE_KEYS[key as keyof typeof PROFILE_KEYS];
      if (profileCol && (typeof value === 'string' || value === null)) {
        profileUpdate[profileCol] = value ?? '';
      }
    }

    if (Object.keys(profileUpdate).length > 0) {
      db.update(applicantProfile)
        .set({ ...profileUpdate, updatedAt: now })
        .where(eq(applicantProfile.userId, userId))
        .run();
    }

    if ('availability' in incoming) {
      syncAvailability(app.id, incoming.availability);
    }
    if ('course_preferences' in incoming) {
      syncCoursePreferences(app.id, incoming.course_preferences);
    }

    db.update(application)
      .set({ updatedAt: now })
      .where(eq(application.id, app.id))
      .run();
  });

  return { updatedAt: now };
}

function syncAvailability(applicationId: string, value: unknown): void {
  db.delete(applicationAvailability)
    .where(eq(applicationAvailability.applicationId, applicationId))
    .run();
  if (!Array.isArray(value)) return;
  const rows = value
    .filter(
      (r): r is { weekday: number; startMin: number; endMin: number } =>
        !!r &&
        typeof r === 'object' &&
        Number.isInteger((r as { weekday?: unknown }).weekday) &&
        Number.isInteger((r as { startMin?: unknown }).startMin) &&
        Number.isInteger((r as { endMin?: unknown }).endMin) &&
        (r as { weekday: number }).weekday >= 0 &&
        (r as { weekday: number }).weekday <= 6 &&
        (r as { startMin: number }).startMin < (r as { endMin: number }).endMin,
    )
    .map((r) => ({
      applicationId,
      weekday: r.weekday,
      startMin: r.startMin,
      endMin: r.endMin,
    }));
  if (rows.length > 0) {
    db.insert(applicationAvailability).values(rows).run();
  }
}

function syncCoursePreferences(applicationId: string, value: unknown): void {
  db.delete(applicationCoursePreference)
    .where(eq(applicationCoursePreference.applicationId, applicationId))
    .run();
  if (!Array.isArray(value)) return;
  const rows = value
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((courseKey, i) => ({ applicationId, courseKey, rank: i + 1 }));
  if (rows.length > 0) {
    db.insert(applicationCoursePreference).values(rows).run();
  }
}

export class ApplicationLocked extends Error {
  constructor(public status: ApplicationStatus) {
    super(`application is ${status}, cannot modify`);
  }
}

export function submitApplication(userId: string): {
  id: string;
  status: ApplicationStatus;
  submittedAt: number;
} {
  const app = getOrCreateApplication(userId);
  if (app.status !== 'draft') {
    throw new ApplicationLocked(app.status);
  }
  const now = nowSeconds();
  db.update(application)
    .set({ status: 'submitted', submittedAt: now, updatedAt: now })
    .where(and(eq(application.id, app.id), eq(application.status, 'draft')))
    .run();
  return { id: app.id, status: 'submitted', submittedAt: now };
}
