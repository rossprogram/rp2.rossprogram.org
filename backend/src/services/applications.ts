import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  application,
  applicantProfile,
  applicationResponse,
  applicationAvailability,
  applicationCoursePreference,
  guardianLink,
  user,
  userRole,
} from '../db/schema.js';
import type { ApplicationStatus } from '@rp2/shared';
import { requestGuardianInvite } from '../auth/magic-link.js';

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

export async function upsertResponses(
  userId: string,
  incoming: Record<string, unknown>,
): Promise<{ updatedAt: number }> {
  const app = getOrCreateApplication(userId);
  // Applicant can still edit while awaiting the guardian; once the whole
  // thing is `submitted` or beyond, it's locked.
  if (app.status !== 'draft' && app.status !== 'awaiting_guardian') {
    throw new ApplicationLocked(app.status);
  }
  const now = nowSeconds();

  const guardianAction = decideGuardianAction(userId, incoming);
  if (guardianAction.kind === 'reject') {
    throw new GuardianEmailLocked(guardianAction.reason);
  }

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

  if (guardianAction.kind === 'invite') {
    // Fire outside the DB transaction — sending email is async and slow.
    await maybeSendGuardianInvite(userId, guardianAction);
  }

  return { updatedAt: now };
}

type GuardianDecision =
  | { kind: 'noop' }
  | { kind: 'reject'; reason: 'accepted_locked' | 'same_as_applicant' }
  | {
      kind: 'invite';
      guardianEmail: string;
      guardianName: string;
      relationship: 'parent' | 'guardian' | 'other';
    };

function decideGuardianAction(
  applicantUserId: string,
  incoming: Record<string, unknown>,
): GuardianDecision {
  if (
    !('guardian_email' in incoming) &&
    !('guardian_name' in incoming) &&
    !('guardian_relationship' in incoming)
  ) {
    return { kind: 'noop' };
  }

  const nextEmail = normalizeStr(incoming['guardian_email']);
  const nextName = normalizeStr(incoming['guardian_name']);
  const nextRel = normalizeStr(incoming['guardian_relationship']);

  const existingLink = db
    .select()
    .from(guardianLink)
    .where(eq(guardianLink.applicantUserId, applicantUserId))
    .get();

  const applicant = db.select().from(user).where(eq(user.id, applicantUserId)).get();
  const applicantEmail = applicant?.email ?? '';

  // If applicant is just editing the name or relationship (no email), the
  // link may need a relationship update but we don't reinvite.
  if (nextEmail === undefined) {
    // Nothing to invite; caller will still save the plain response.
    return { kind: 'noop' };
  }

  const normalized = nextEmail.toLowerCase();

  if (normalized === '' && !existingLink) {
    // Applicant cleared the email but no link exists — nothing to do.
    return { kind: 'noop' };
  }
  if (normalized === applicantEmail.toLowerCase()) {
    return { kind: 'reject', reason: 'same_as_applicant' };
  }
  if (existingLink && existingLink.acceptedAt !== null) {
    // Guardian already accepted; email is locked. Same email is fine (no-op).
    const currentGuardian = db
      .select()
      .from(user)
      .where(eq(user.id, existingLink.guardianUserId))
      .get();
    if (currentGuardian && currentGuardian.email === normalized) {
      return { kind: 'noop' };
    }
    return { kind: 'reject', reason: 'accepted_locked' };
  }

  const relationship = normalizeRelationship(nextRel);
  const finalName = nextName ?? '';
  return {
    kind: 'invite',
    guardianEmail: normalized,
    guardianName: finalName,
    relationship,
  };
}

const INVITE_RATE_LIMIT_SECONDS = 60 * 60 * 24; // 1 invite per 24h per link

async function maybeSendGuardianInvite(
  applicantUserId: string,
  action: Extract<GuardianDecision, { kind: 'invite' }>,
): Promise<void> {
  const now = nowSeconds();
  const { guardianUserId } = await requestGuardianInvite(
    action.guardianEmail,
    action.guardianName,
  );
  const existing = db
    .select()
    .from(guardianLink)
    .where(eq(guardianLink.applicantUserId, applicantUserId))
    .get();

  if (!existing) {
    // If this email is already an established guardian (they've accepted a
    // prior invite — for a sibling, or previously for this same applicant),
    // don't force them through the sign-in interstitial again. Mark the new
    // link accepted at creation.
    const alreadyGuardian = db
      .select({ userId: userRole.userId })
      .from(userRole)
      .where(and(eq(userRole.userId, guardianUserId), eq(userRole.role, 'guardian')))
      .get();

    db.insert(guardianLink)
      .values({
        id: nanoid(),
        applicantUserId,
        guardianUserId,
        relationship: action.relationship,
        invitedAt: now,
        acceptedAt: alreadyGuardian ? now : null,
        createdAt: now,
      })
      .run();
    return;
  }

  // Existing link. Repoint to the (possibly new) guardian user.
  const isNewGuardian = existing.guardianUserId !== guardianUserId;
  const withinRateLimit =
    !isNewGuardian &&
    existing.invitedAt !== null &&
    now - existing.invitedAt < INVITE_RATE_LIMIT_SECONDS;

  if (withinRateLimit) {
    // Don't spam the parent with fresh magic links every keystroke; keep the
    // link row intact.
    return;
  }

  db.update(guardianLink)
    .set({
      guardianUserId,
      relationship: action.relationship,
      invitedAt: now,
      // If we switched guardians, reset acceptance state.
      ...(isNewGuardian ? { acceptedAt: null } : {}),
    })
    .where(eq(guardianLink.applicantUserId, applicantUserId))
    .run();
}

function normalizeStr(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (v === null) return '';
  if (typeof v === 'string') return v.trim();
  return '';
}

function normalizeRelationship(v: string | undefined): 'parent' | 'guardian' | 'other' {
  if (v === 'parent') return 'parent';
  if (v === 'guardian') return 'guardian';
  return 'other';
}

export class GuardianEmailLocked extends Error {
  constructor(public reason: 'accepted_locked' | 'same_as_applicant') {
    super(`guardian_email rejected: ${reason}`);
  }
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

  // If the guardian raced ahead of the applicant and already finished their
  // part, flip straight to `submitted`; otherwise park in `awaiting_guardian`
  // until the guardian completes.
  const row = db
    .select({ guardianSubmittedAt: application.guardianSubmittedAt })
    .from(application)
    .where(eq(application.id, app.id))
    .get();
  const guardianDone = row?.guardianSubmittedAt !== null && row?.guardianSubmittedAt !== undefined;
  const nextStatus: ApplicationStatus = guardianDone ? 'submitted' : 'awaiting_guardian';

  db.update(application)
    .set({ status: nextStatus, submittedAt: now, updatedAt: now })
    .where(and(eq(application.id, app.id), eq(application.status, 'draft')))
    .run();
  return { id: app.id, status: nextStatus, submittedAt: now };
}
