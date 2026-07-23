import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  application,
  applicationFile,
  applicationResponse,
  guardianLink,
  user,
} from '../db/schema.js';
import { sendEmail } from '../integrations/email/ses.js';
import { renderGuardianCompletedEmail } from '../integrations/email/templates.js';
import {
  canonicalRoleForEmail,
  requestApplicantInvite,
} from '../auth/magic-link.js';
import { getOrCreateApplication } from './applications.js';
import type { ApplicationStatus } from '@rp2/shared';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export type GuardianApplicantSummary = {
  applicationId: string;
  applicantName: string;
  applicantEmail: string;
  status: ApplicationStatus;
  aidLevel: string | null;
  guardianSignature: string | null;
  aidDocCount: number;
  taskComplete: boolean;
  guardianSubmittedAt: number | null;
};

export function listLinkedApplicants(
  guardianUserId: string,
): GuardianApplicantSummary[] {
  const rows = db
    .select({
      appId: application.id,
      applicantEmail: user.email,
      status: application.status,
      guardianSubmittedAt: application.guardianSubmittedAt,
    })
    .from(guardianLink)
    .innerJoin(user, eq(user.id, guardianLink.applicantUserId))
    .innerJoin(application, eq(application.applicantUserId, guardianLink.applicantUserId))
    .where(eq(guardianLink.guardianUserId, guardianUserId))
    .all();

  return rows.map((r) => hydrateSummary(r.appId, r.applicantEmail, r.status, r.guardianSubmittedAt));
}

export function getGuardianApplicantView(
  guardianUserId: string,
  applicationId: string,
): GuardianApplicantSummary | null {
  const linkOk = db
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .innerJoin(application, eq(application.applicantUserId, guardianLink.applicantUserId))
    .where(
      and(
        eq(guardianLink.guardianUserId, guardianUserId),
        eq(application.id, applicationId),
      ),
    )
    .get();
  if (!linkOk) return null;

  const row = db
    .select({
      appId: application.id,
      applicantUserId: application.applicantUserId,
      status: application.status,
      guardianSubmittedAt: application.guardianSubmittedAt,
    })
    .from(application)
    .where(eq(application.id, applicationId))
    .get();
  if (!row) return null;
  const applicant = db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, row.applicantUserId))
    .get();
  if (!applicant) return null;
  return hydrateSummary(row.appId, applicant.email, row.status, row.guardianSubmittedAt);
}

function hydrateSummary(
  applicationId: string,
  applicantEmail: string,
  status: ApplicationStatus,
  guardianSubmittedAt: number | null,
): GuardianApplicantSummary {
  const responses = db
    .select({ key: applicationResponse.questionKey, value: applicationResponse.value })
    .from(applicationResponse)
    .where(eq(applicationResponse.applicationId, applicationId))
    .all();
  const responseByKey = new Map(responses.map((r) => [r.key, r.value]));

  const applicantName = readString(responseByKey.get('student_legal_name'));
  const aidLevel = readString(responseByKey.get('aid_level'));
  const guardianSignature = readString(responseByKey.get('guardian_signature'));

  const aidDocs = db
    .select({ id: applicationFile.id })
    .from(applicationFile)
    .where(
      and(eq(applicationFile.applicationId, applicationId), eq(applicationFile.kind, 'aid_doc')),
    )
    .all();

  const taskComplete = computeTaskComplete({
    guardianSignature,
    aidLevel,
    aidDocCount: aidDocs.length,
  });

  return {
    applicationId,
    applicantName: applicantName ?? '',
    applicantEmail,
    status,
    aidLevel,
    guardianSignature,
    aidDocCount: aidDocs.length,
    taskComplete,
    guardianSubmittedAt,
  };
}

function readString(v: string | undefined): string | null {
  if (v === undefined) return null;
  try {
    const parsed = JSON.parse(v);
    if (typeof parsed === 'string') return parsed;
    if (parsed === null) return null;
    return String(parsed);
  } catch {
    return v;
  }
}

function computeTaskComplete(input: {
  guardianSignature: string | null;
  aidLevel: string | null;
  aidDocCount: number;
}): boolean {
  if (!input.guardianSignature || input.guardianSignature.trim().length === 0) return false;
  if (input.aidLevel === 'partial' || input.aidLevel === 'full') {
    if (input.aidDocCount === 0) return false;
  }
  return true;
}

export type GuardianPatchInput = {
  guardianSignature?: string | undefined;
  aidLevel?: string | undefined;
};

export type GuardianPatchError = 'not_linked' | 'app_locked';

export function patchGuardianTasks(
  guardianUserId: string,
  applicationId: string,
  input: GuardianPatchInput,
): { ok: true } | { ok: false; reason: GuardianPatchError } {
  const view = getGuardianApplicantView(guardianUserId, applicationId);
  if (!view) return { ok: false, reason: 'not_linked' };
  if (view.status !== 'draft' && view.status !== 'awaiting_guardian') {
    return { ok: false, reason: 'app_locked' };
  }
  const now = nowSeconds();

  db.transaction(() => {
    if (input.guardianSignature !== undefined) {
      writeResponse(applicationId, 'guardian_signature', input.guardianSignature, now);
    }
    if (input.aidLevel !== undefined) {
      writeResponse(applicationId, 'aid_level', input.aidLevel, now);
    }
    db.update(application)
      .set({ updatedAt: now })
      .where(eq(application.id, applicationId))
      .run();
  });

  return { ok: true };
}

function writeResponse(
  applicationId: string,
  key: string,
  value: unknown,
  now: number,
): void {
  const serialized = JSON.stringify(value ?? null);
  db.insert(applicationResponse)
    .values({ applicationId, questionKey: key, value: serialized, updatedAt: now })
    .onConflictDoUpdate({
      target: [applicationResponse.applicationId, applicationResponse.questionKey],
      set: { value: serialized, updatedAt: now },
    })
    .run();
}

export type GuardianCompleteError = 'not_linked' | 'app_locked' | 'incomplete';

export async function completeGuardianPart(
  guardianUserId: string,
  applicationId: string,
): Promise<
  | { ok: true; status: ApplicationStatus }
  | { ok: false; reason: GuardianCompleteError }
> {
  const view = getGuardianApplicantView(guardianUserId, applicationId);
  if (!view) return { ok: false, reason: 'not_linked' };
  if (view.status !== 'draft' && view.status !== 'awaiting_guardian') {
    return { ok: false, reason: 'app_locked' };
  }
  if (!view.taskComplete) return { ok: false, reason: 'incomplete' };

  const now = nowSeconds();

  // If applicant already submitted their part, we can flip straight to
  // `submitted`. Otherwise stay in `draft` — applicant hasn't finished yet;
  // submittedAt was already set when they did their submit and shouldn't be
  // touched here.
  const nextStatus: ApplicationStatus =
    view.status === 'awaiting_guardian' ? 'submitted' : 'draft';

  db.update(application)
    .set({
      guardianSubmittedAt: now,
      status: nextStatus,
      updatedAt: now,
    })
    .where(eq(application.id, applicationId))
    .run();

  // Fire-and-forget notification email to the guardian.
  const guardian = db.select().from(user).where(eq(user.id, guardianUserId)).get();
  if (guardian) {
    const rendered = renderGuardianCompletedEmail({ applicantName: view.applicantName });
    void sendEmail({
      to: guardian.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }

  return { ok: true, status: nextStatus };
}

export type InviteApplicantInput = {
  guardianUserId: string;
  applicantEmail: string;
  relationship: 'parent' | 'guardian' | 'other';
};

export type InviteApplicantError =
  | 'self_invite'
  | 'email_is_guardian'
  | 'applicant_linked_elsewhere';

export async function inviteApplicant(
  input: InviteApplicantInput,
): Promise<
  | { ok: true; applicantUserId: string; alreadyLinked: boolean }
  | { ok: false; reason: InviteApplicantError }
> {
  const normalized = input.applicantEmail.trim().toLowerCase();

  const guardian = db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, input.guardianUserId))
    .get();
  if (guardian && guardian.email === normalized) {
    return { ok: false, reason: 'self_invite' };
  }

  // If this email is already a canonical guardian, we can't turn them into
  // an applicant. They'd need to use a different email address to apply.
  if (canonicalRoleForEmail(normalized) === 'guardian') {
    return { ok: false, reason: 'email_is_guardian' };
  }

  // Find or create the applicant user record + issue a magic link.
  const guardianName = readGuardianName(input.guardianUserId);
  const { applicantUserId } = await requestApplicantInvite(normalized, guardianName);

  // Check for an existing link on this applicant.
  const existingLink = db
    .select()
    .from(guardianLink)
    .where(eq(guardianLink.applicantUserId, applicantUserId))
    .get();

  if (existingLink && existingLink.guardianUserId !== input.guardianUserId) {
    return { ok: false, reason: 'applicant_linked_elsewhere' };
  }

  const now = nowSeconds();
  if (!existingLink) {
    db.insert(guardianLink)
      .values({
        id: nanoid(),
        applicantUserId,
        guardianUserId: input.guardianUserId,
        relationship: input.relationship,
        invitedAt: now,
        acceptedAt: now, // guardian side is already active
        createdAt: now,
      })
      .run();
    // Materialize the applicant's row so the parent sees them on their
    // portal before the student ever signs in. getOrCreateApplication
    // also creates the applicant_profile row.
    getOrCreateApplication(applicantUserId);
    return { ok: true, applicantUserId, alreadyLinked: false };
  }

  // Idempotent re-invite: refresh invitedAt so the applicant sees the new mail.
  db.update(guardianLink)
    .set({ invitedAt: now, relationship: input.relationship })
    .where(eq(guardianLink.id, existingLink.id))
    .run();
  return { ok: true, applicantUserId, alreadyLinked: true };
}

function readGuardianName(guardianUserId: string): string {
  // Best-effort: use whatever name the guardian may have entered from their
  // side. Fall back to the empty string; the template handles that.
  const linked = db
    .select({ appId: application.id })
    .from(guardianLink)
    .innerJoin(application, eq(application.applicantUserId, guardianLink.applicantUserId))
    .where(eq(guardianLink.guardianUserId, guardianUserId))
    .get();
  if (!linked) return '';
  const row = db
    .select({ value: applicationResponse.value })
    .from(applicationResponse)
    .where(
      and(
        eq(applicationResponse.applicationId, linked.appId),
        eq(applicationResponse.questionKey, 'guardian_name'),
      ),
    )
    .get();
  return readString(row?.value) ?? '';
}

export function getGuardianStatusForApplicant(
  applicantUserId: string,
): {
  hasLink: boolean;
  guardianEmail: string | null;
  invitedAt: number | null;
  acceptedAt: number | null;
  taskComplete: boolean;
} {
  const link = db
    .select()
    .from(guardianLink)
    .where(eq(guardianLink.applicantUserId, applicantUserId))
    .get();
  if (!link) {
    return {
      hasLink: false,
      guardianEmail: null,
      invitedAt: null,
      acceptedAt: null,
      taskComplete: false,
    };
  }
  const guardian = db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, link.guardianUserId))
    .get();

  const app = db
    .select({ id: application.id, guardianSubmittedAt: application.guardianSubmittedAt })
    .from(application)
    .where(eq(application.applicantUserId, applicantUserId))
    .get();

  return {
    hasLink: true,
    guardianEmail: guardian?.email ?? null,
    invitedAt: link.invitedAt,
    acceptedAt: link.acceptedAt,
    taskComplete: app?.guardianSubmittedAt !== null && app?.guardianSubmittedAt !== undefined,
  };
}
