/*
 * The term surveys.
 *
 * Open to enrolled families only: the student answers about themselves from
 * /survey, and their linked guardian answers about that student from the
 * parent portal. The question set lives in shared/src/surveys.ts; this file
 * only stores, lists and exports answers.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { utils, write } from 'xlsx';
import {
  SURVEY_ROUND,
  csvGuard,
  surveyAnswersSchema,
  surveyExportColumns,
  surveyFor,
  type SurveyAnswers,
  type SurveyRespondent,
} from '@rp2/shared';
import { db } from '../db/client.js';
import { application, guardianLink, offer, surveyResponse, user } from '../db/schema.js';
import { isEnrolled } from './offers.js';
import { studentNamesForMany } from './names.js';

export class SurveyError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 409,
    public issues?: unknown,
  ) {
    super(message);
    this.name = 'SurveyError';
  }
}

const now = (): number => Math.floor(Date.now() / 1000);

export type SurveyState = {
  round: string;
  respondent: SurveyRespondent;
  /** Null until this respondent has submitted in this round. */
  answers: SurveyAnswers | null;
  submittedAt: number | null;
  updatedAt: number | null;
};

export function surveyStateFor(applicationId: string, respondent: SurveyRespondent): SurveyState {
  const row = db
    .select()
    .from(surveyResponse)
    .where(
      and(
        eq(surveyResponse.round, SURVEY_ROUND),
        eq(surveyResponse.applicationId, applicationId),
        eq(surveyResponse.respondentKind, respondent),
      ),
    )
    .get();
  return {
    round: SURVEY_ROUND,
    respondent,
    answers: row ? (JSON.parse(row.answers) as SurveyAnswers) : null,
    submittedAt: row?.submittedAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** The section on the student's offer, for prefilling and the export. */
export function offerSectionFor(applicationId: string): string | null {
  const row = db
    .select({ section: offer.section })
    .from(offer)
    .where(eq(offer.applicationId, applicationId))
    .get();
  return row?.section ?? null;
}

/**
 * Record a survey. Re-submitting in the same round replaces the answers but
 * keeps the original submitted_at.
 */
export function submitSurvey(input: {
  applicationId: string;
  respondent: SurveyRespondent;
  respondentUserId: string;
  answers: unknown;
}): SurveyState {
  if (!isEnrolled(input.applicationId)) {
    throw new SurveyError('not_enrolled', 'The survey is open to enrolled students only.', 403);
  }

  const parsed = surveyAnswersSchema(surveyFor(input.respondent)).safeParse(input.answers);
  if (!parsed.success) {
    throw new SurveyError(
      'invalid_answers',
      'Please answer every required question.',
      400,
      parsed.error.issues,
    );
  }

  const stamp = now();
  const json = JSON.stringify(parsed.data);
  db.insert(surveyResponse)
    .values({
      id: nanoid(),
      round: SURVEY_ROUND,
      applicationId: input.applicationId,
      respondentKind: input.respondent,
      respondentUserId: input.respondentUserId,
      answers: json,
      submittedAt: stamp,
      updatedAt: stamp,
    })
    .onConflictDoUpdate({
      target: [surveyResponse.round, surveyResponse.applicationId, surveyResponse.respondentKind],
      set: { answers: json, respondentUserId: input.respondentUserId, updatedAt: stamp },
    })
    .run();

  return surveyStateFor(input.applicationId, input.respondent);
}

export type SurveyFamily = {
  applicationId: string;
  studentName: string | null;
  studentEmail: string;
  section: string | null;
  guardianEmail: string | null;
  guardianAccepted: boolean;
  studentRespondedAt: number | null;
  guardianRespondedAt: number | null;
};

/** Every enrolled family and whether each party has answered this round. */
export function surveyFamilies(): SurveyFamily[] {
  const rows = db
    .select({
      applicationId: application.id,
      applicantUserId: application.applicantUserId,
      studentEmail: user.email,
      section: offer.section,
    })
    .from(application)
    .innerJoin(user, eq(user.id, application.applicantUserId))
    .leftJoin(offer, eq(offer.applicationId, application.id))
    .where(eq(application.status, 'enrolled'))
    .all();
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.applicationId);

  const guardians = db
    .select({
      applicantUserId: guardianLink.applicantUserId,
      email: user.email,
      acceptedAt: guardianLink.acceptedAt,
    })
    .from(guardianLink)
    .innerJoin(user, eq(user.id, guardianLink.guardianUserId))
    .where(inArray(guardianLink.applicantUserId, rows.map((r) => r.applicantUserId)))
    .all();
  const guardianBy = new Map(guardians.map((g) => [g.applicantUserId, g]));

  const responses = db
    .select({
      applicationId: surveyResponse.applicationId,
      respondentKind: surveyResponse.respondentKind,
      submittedAt: surveyResponse.submittedAt,
    })
    .from(surveyResponse)
    .where(and(eq(surveyResponse.round, SURVEY_ROUND), inArray(surveyResponse.applicationId, ids)))
    .all();
  const respondedAt = (appId: string, kind: SurveyRespondent) =>
    responses.find((r) => r.applicationId === appId && r.respondentKind === kind)?.submittedAt ??
    null;

  const names = studentNamesForMany(ids);

  return rows
    .map((r) => {
      const g = guardianBy.get(r.applicantUserId);
      return {
        applicationId: r.applicationId,
        studentName: names.get(r.applicationId)?.legal ?? null,
        studentEmail: r.studentEmail,
        section: r.section,
        guardianEmail: g?.email ?? null,
        guardianAccepted: g?.acceptedAt != null,
        studentRespondedAt: respondedAt(r.applicationId, 'student'),
        guardianRespondedAt: respondedAt(r.applicationId, 'guardian'),
      };
    })
    .sort((a, b) => (a.studentName ?? '').localeCompare(b.studentName ?? ''));
}

function isoOrBlank(unixSeconds: number | null): string {
  return unixSeconds == null ? '' : new Date(unixSeconds * 1000).toISOString();
}

function cell(value: unknown): string | number {
  if (value == null) return '';
  if (typeof value === 'number') return value;
  // Free text from families: neutralize spreadsheet formula evaluation.
  return csvGuard(String(value));
}

/**
 * One row per response in the current round, one column per question (a grid
 * contributes one column per statement, holding 1–5).
 */
export function surveyExportRows(respondent: SurveyRespondent): Record<string, string | number>[] {
  const def = surveyFor(respondent);
  const columns = surveyExportColumns(def);

  const rows = db
    .select({
      applicationId: surveyResponse.applicationId,
      answers: surveyResponse.answers,
      submittedAt: surveyResponse.submittedAt,
      updatedAt: surveyResponse.updatedAt,
      respondentEmail: user.email,
      section: offer.section,
    })
    .from(surveyResponse)
    .innerJoin(user, eq(user.id, surveyResponse.respondentUserId))
    .leftJoin(offer, eq(offer.applicationId, surveyResponse.applicationId))
    .where(
      and(eq(surveyResponse.round, SURVEY_ROUND), eq(surveyResponse.respondentKind, respondent)),
    )
    .all();

  const names = studentNamesForMany(rows.map((r) => r.applicationId));

  return rows
    .map((r) => {
      const answers = JSON.parse(r.answers) as SurveyAnswers;
      const out: Record<string, string | number> = {
        round: SURVEY_ROUND,
        submitted_at: isoOrBlank(r.submittedAt),
        updated_at: isoOrBlank(r.updatedAt),
        app_id: csvGuard(r.applicationId),
        student_name: cell(names.get(r.applicationId)?.legal ?? null),
        enrolled_section: cell(r.section),
        respondent_email: cell(r.respondentEmail),
      };
      for (const c of columns) {
        const [qKey, rowKey] = c.key.split('.') as [string, string | undefined];
        const v = answers[qKey];
        out[c.header] = cell(
          rowKey !== undefined && v && typeof v === 'object' ? (v[rowKey] ?? null) : v,
        );
      }
      return out;
    })
    .sort((a, b) => String(a.student_name).localeCompare(String(b.student_name)));
}

/**
 * The download. CSV holds one respondent kind; XLSX holds both, one sheet
 * each, so a single file carries the whole round.
 */
export function buildSurveyExport(
  format: 'csv' | 'xlsx',
  respondent: SurveyRespondent,
): Buffer {
  const sheetFor = (kind: SurveyRespondent) => {
    const rows = surveyExportRows(kind);
    const header = [
      'round',
      'submitted_at',
      'updated_at',
      'app_id',
      'student_name',
      'enrolled_section',
      'respondent_email',
      ...surveyExportColumns(surveyFor(kind)).map((c) => c.header),
    ];
    return utils.json_to_sheet(rows, { header });
  };

  const wb = utils.book_new();
  if (format === 'csv') {
    utils.book_append_sheet(wb, sheetFor(respondent), 'Responses');
  } else {
    utils.book_append_sheet(wb, sheetFor('student'), 'Students');
    utils.book_append_sheet(wb, sheetFor('guardian'), 'Parents');
  }
  const out: unknown = write(wb, { type: 'buffer', bookType: format });
  return Buffer.from(out as Uint8Array);
}
