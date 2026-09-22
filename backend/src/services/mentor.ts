/*
 * What a mentor sees.
 *
 * Scoping is the whole job here. A mentor sees the students in the sections
 * they are assigned to, and nobody else's — `section_staff` is the boundary,
 * and every query below starts from it rather than filtering afterwards. An
 * admin sees every section, because that is what admin has always meant.
 *
 * Queries are batched per section rather than per student. `listApplications`
 * in services/admin.ts runs three extra queries inside a .map() over ~200
 * rows, and services/names.ts exists because that habit had already produced
 * six copies of one lookup.
 */

import { eq, inArray } from 'drizzle-orm';
import {
  PROGRAM_TIMEZONE,
  SESSION_KINDS,
  TERM_KEY,
  courseLabel,
  formatScheduleString,
  type SessionKind,
} from '@rp2/shared';
import { db } from '../db/client.js';
import {
  agreementSignature,
  application,
  applicationResponse,
  discordLink,
  guardianLink,
  offer,
  section,
  sectionStaff,
  sessionOccurrence,
  user,
} from '../db/schema.js';
import { studentNamesForMany } from './names.js';

export type MentorSection = {
  id: string;
  label: string;
  courseKey: string;
  courseLabel: string | null;
  /** The viewer's own role in THIS section. */
  myRole: 'mentor' | 'assistant' | 'admin';
  schedule: { kind: SessionKind; when: string | null }[];
  nextSession: { kind: SessionKind; date: string; startsAt: number } | null;
  students: MentorStudent[];
};

export type MentorStudent = {
  applicationId: string;
  preferredName: string | null;
  legalName: string | null;
  email: string;
  guardianEmail: string | null;
  cohort: string | null;
  timezone: string | null;
  /** Both documents signed by both parties. */
  fullySigned: boolean;
  outstandingSignatures: number;
  discord: 'joined' | 'linked' | 'none';
};

function readJson(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'string' ? v.trim() || null : null;
  } catch {
    return null;
  }
}

/** Sections this user may see, and in what capacity. */
export function sectionsForViewer(
  userId: string,
  isAdmin: boolean,
): { id: string; label: string; courseKey: string; role: 'mentor' | 'assistant' | 'admin' }[] {
  const all = db
    .select()
    .from(section)
    .all()
    .filter((s) => s.term === TERM_KEY);

  if (isAdmin) {
    return all.map((s) => ({ id: s.id, label: s.label, courseKey: s.courseKey, role: 'admin' as const }));
  }

  const mine = db
    .select({ sectionId: sectionStaff.sectionId, role: sectionStaff.role })
    .from(sectionStaff)
    .where(eq(sectionStaff.userId, userId))
    .all();
  const roleBy = new Map(mine.map((m) => [m.sectionId, m.role]));

  return all
    .filter((s) => roleBy.has(s.id))
    .map((s) => ({ id: s.id, label: s.label, courseKey: s.courseKey, role: roleBy.get(s.id)! }));
}

/**
 * The full view for one staff member.
 *
 * Everything is loaded in a handful of batched queries, then assembled in
 * memory — the same shape as loadCurrentRows() in services/offers.ts.
 */
export function mentorView(userId: string, isAdmin: boolean, now: number): MentorSection[] {
  const mine = sectionsForViewer(userId, isAdmin);
  if (mine.length === 0) return [];

  const sectionIds = mine.map((s) => s.id);
  const labels = mine.map((s) => s.label);

  const sectionRows = new Map(
    db.select().from(section).where(inArray(section.id, sectionIds)).all().map((s) => [s.id, s]),
  );

  // Students, keyed by the section LABEL, since offer.section is still the
  // family-facing string and the link between the two.
  const students = db
    .select({
      applicationId: application.id,
      applicantUserId: application.applicantUserId,
      email: user.email,
      label: offer.section,
      cohort: offer.cohort,
    })
    .from(application)
    .innerJoin(offer, eq(offer.applicationId, application.id))
    .innerJoin(user, eq(user.id, application.applicantUserId))
    .where(eq(application.status, 'enrolled'))
    .all()
    .filter((r) => r.label !== null && labels.includes(r.label));

  const appIds = students.map((s) => s.applicationId);
  const names = studentNamesForMany(appIds);

  const timezones = new Map<string, string>();
  if (appIds.length > 0) {
    for (const r of db
      .select({ applicationId: applicationResponse.applicationId, value: applicationResponse.value })
      .from(applicationResponse)
      .where(eq(applicationResponse.questionKey, 'student_timezone'))
      .all()) {
      timezones.set(r.applicationId, readJson(r.value) ?? '');
    }
  }

  // Signature counts. Four is a complete family.
  const sigCounts = new Map<string, number>();
  if (appIds.length > 0) {
    for (const r of db
      .select({ applicationId: agreementSignature.applicationId })
      .from(agreementSignature)
      .where(inArray(agreementSignature.applicationId, appIds))
      .all()) {
      sigCounts.set(r.applicationId, (sigCounts.get(r.applicationId) ?? 0) + 1);
    }
  }

  const guardianEmails = new Map<string, string>();
  const applicantUserIds = students.map((s) => s.applicantUserId);
  if (applicantUserIds.length > 0) {
    for (const r of db
      .select({ applicantUserId: guardianLink.applicantUserId, email: user.email })
      .from(guardianLink)
      .innerJoin(user, eq(user.id, guardianLink.guardianUserId))
      .where(inArray(guardianLink.applicantUserId, applicantUserIds))
      .all()) {
      guardianEmails.set(r.applicantUserId, r.email);
    }
  }

  const discord = new Map<string, { joined: boolean }>();
  if (applicantUserIds.length > 0) {
    for (const r of db
      .select({ userId: discordLink.userId, joinedGuildAt: discordLink.joinedGuildAt })
      .from(discordLink)
      .where(inArray(discordLink.userId, applicantUserIds))
      .all()) {
      discord.set(r.userId, { joined: r.joinedGuildAt !== null });
    }
  }

  // The next scheduled session per section, so a mentor lands on "when am I
  // next teaching" without doing date arithmetic.
  const upcoming = new Map<string, { kind: SessionKind; date: string; startsAt: number }>();
  for (const o of db
    .select()
    .from(sessionOccurrence)
    .where(inArray(sessionOccurrence.sectionId, sectionIds))
    .all()) {
    if (o.status !== 'scheduled' || o.startsAt < now) continue;
    const held = upcoming.get(o.sectionId);
    if (!held || o.startsAt < held.startsAt) {
      upcoming.set(o.sectionId, { kind: o.kind, date: o.date, startsAt: o.startsAt });
    }
  }

  return mine
    .map((s) => {
      const row = sectionRows.get(s.id);
      const schedule = SESSION_KINDS.map((kind) => {
        const weekday = kind === 'problem_session' ? row?.problemWeekday : row?.officeWeekday;
        const minute = kind === 'problem_session' ? row?.problemMinute : row?.officeMinute;
        return {
          kind,
          when:
            weekday !== null && weekday !== undefined && minute !== null && minute !== undefined
              ? `${formatScheduleString(weekday, minute)} ${PROGRAM_TIMEZONE}`
              : null,
        };
      });

      const mineStudents: MentorStudent[] = students
        .filter((st) => st.label === s.label)
        .map((st) => {
          const n = names.get(st.applicationId);
          const signed = sigCounts.get(st.applicationId) ?? 0;
          const d = discord.get(st.applicantUserId);
          return {
            applicationId: st.applicationId,
            preferredName: n?.preferred ?? null,
            legalName: n?.legal ?? null,
            email: st.email,
            guardianEmail: guardianEmails.get(st.applicantUserId) ?? null,
            cohort: st.cohort,
            timezone: timezones.get(st.applicationId) || null,
            fullySigned: signed >= 4,
            outstandingSignatures: Math.max(0, 4 - signed),
            discord: (d ? (d.joined ? 'joined' : 'linked') : 'none') as MentorStudent['discord'],
          };
        })
        .sort((a, b) => {
          // Group first, then name — a mentor thinks in breakout groups.
          const g = (a.cohort ?? '').localeCompare(b.cohort ?? '', undefined, { numeric: true });
          if (g !== 0) return g;
          return (a.legalName ?? '').localeCompare(b.legalName ?? '');
        });

      return {
        id: s.id,
        label: s.label,
        courseKey: s.courseKey,
        courseLabel: courseLabel(s.courseKey),
        myRole: s.role,
        schedule,
        nextSession: upcoming.get(s.id) ?? null,
        students: mineStudents,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
