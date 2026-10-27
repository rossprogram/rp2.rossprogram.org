import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SURVEY_RESPONDENTS, surveyFor, type SurveyRespondent } from '@rp2/shared';
import { env } from '../env.js';
import { requireAuth } from '../auth/session.js';
import { sendEmail } from '../integrations/email/ses.js';
import { renderSurveyRequestEmail } from '../integrations/email/templates.js';
import { applicationIdForApplicant, guardianOwns } from '../services/agreements.js';
import { isEnrolled } from '../services/offers.js';
import { studentNamesFor } from '../services/names.js';
import {
  SurveyError,
  buildSurveyExport,
  offerSectionFor,
  submitSurvey,
  surveyFamilies,
  surveyStateFor,
} from '../services/surveys.js';

/*
 * The term surveys: the student's from /survey, the guardian's from the parent
 * portal, and the admin's view, download and email request.
 *
 * Same shape as the agreements: two near-mirrored family surveys that differ
 * only in authorization, and an admin email that previews before it sends.
 */

const SubmitBody = z.object({ answers: z.record(z.unknown()) });

const ExportQuery = z.object({
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
  respondent: z.enum(SURVEY_RESPONDENTS).default('student'),
});

const RequestBody = z.object({
  /** Preview only — report who WOULD be written to, and send nothing. */
  dryRun: z.boolean().default(true),
  /** Off by default: someone who has answered does not need asking again. */
  includeResponded: z.boolean().default(false),
});

function fail(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof SurveyError) {
    return reply
      .code(err.statusCode)
      .send({ error: err.code, message: err.message, issues: err.issues });
  }
  throw err;
}

function envelopeFor(applicationId: string, respondent: SurveyRespondent) {
  const names = studentNamesFor(applicationId);
  return {
    applicationId,
    survey: surveyFor(respondent),
    enrolled: isEnrolled(applicationId),
    studentName: names.preferred ?? names.legal,
    /** Prefills the student's "Which section are you in?". */
    section: offerSectionFor(applicationId),
    ...surveyStateFor(applicationId, respondent),
  };
}

export async function registerSurveyRoutes(app: FastifyInstance): Promise<void> {
  /* -------- student -------- */

  app.get('/api/survey', { preHandler: requireAuth() }, async (req, reply) => {
    const appId = applicationIdForApplicant(req.currentUser!.id);
    if (!appId) return reply.code(404).send({ error: 'no_application' });
    return envelopeFor(appId, 'student');
  });

  app.post('/api/survey', { preHandler: requireAuth() }, async (req, reply) => {
    const appId = applicationIdForApplicant(req.currentUser!.id);
    if (!appId) return reply.code(404).send({ error: 'no_application' });

    const parsed = SubmitBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    try {
      submitSurvey({
        applicationId: appId,
        respondent: 'student',
        respondentUserId: req.currentUser!.id,
        answers: parsed.data.answers,
      });
      return envelopeFor(appId, 'student');
    } catch (err) {
      return fail(reply, err);
    }
  });

  /* -------- guardian -------- */

  app.get(
    '/api/parent/applicant/:appId/survey',
    { preHandler: requireAuth('guardian') },
    async (req, reply) => {
      const appId = (req.params as { appId: string }).appId;
      // 404, not 403: never confirm an application exists to a stranger.
      if (!guardianOwns(req.currentUser!.id, appId)) {
        return reply.code(404).send({ error: 'not_linked' });
      }
      return envelopeFor(appId, 'guardian');
    },
  );

  app.post(
    '/api/parent/applicant/:appId/survey',
    { preHandler: requireAuth('guardian') },
    async (req, reply) => {
      const appId = (req.params as { appId: string }).appId;
      if (!guardianOwns(req.currentUser!.id, appId)) {
        return reply.code(404).send({ error: 'not_linked' });
      }
      const parsed = SubmitBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      }
      try {
        submitSurvey({
          applicationId: appId,
          respondent: 'guardian',
          respondentUserId: req.currentUser!.id,
          answers: parsed.data.answers,
        });
        return envelopeFor(appId, 'guardian');
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  /* -------- admin -------- */

  app.get('/api/admin/surveys', { preHandler: requireAuth('admin') }, async () => {
    const families = surveyFamilies();
    return {
      families,
      enrolledCount: families.length,
      studentResponses: families.filter((f) => f.studentRespondedAt !== null).length,
      guardianResponses: families.filter((f) => f.guardianRespondedAt !== null).length,
    };
  });

  app.get('/api/admin/surveys/export', { preHandler: requireAuth('admin') }, async (req, reply) => {
    const parsed = ExportQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }
    const { format, respondent } = parsed.data;
    const buf = buildSurveyExport(format, respondent);
    const stamp = new Date().toISOString().slice(0, 10);
    const name =
      format === 'csv'
        ? `rp2-survey-${respondent === 'student' ? 'students' : 'parents'}-${stamp}.csv`
        : `rp2-survey-${stamp}.xlsx`;
    reply.header(
      'Content-Type',
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return reply.send(buf);
  });

  /**
   * Ask enrolled families to fill in the survey.
   *
   * Defaults to a dry run, like the signature reminders: these are emails to
   * the families of minors, and an email cannot be recalled. One email per
   * address — a guardian of two students is asked once, about both.
   */
  app.post('/api/admin/surveys/request', { preHandler: requireAuth('admin') }, async (req, reply) => {
    const parsed = RequestBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { dryRun, includeResponded } = parsed.data;
    const families = surveyFamilies();

    type Planned = { to: string; kind: SurveyRespondent; students: string[]; portalUrl: string };
    const planned: Planned[] = [];
    const guardianBy = new Map<string, Planned>();

    for (const f of families) {
      const student = f.studentName ?? '';
      if (includeResponded || f.studentRespondedAt === null) {
        planned.push({
          to: f.studentEmail,
          kind: 'student',
          students: [student],
          portalUrl: `${env.APP_URL}/survey`,
        });
      }
      if (f.guardianEmail && (includeResponded || f.guardianRespondedAt === null)) {
        const existing = guardianBy.get(f.guardianEmail);
        if (existing) {
          existing.students.push(student);
        } else {
          const p: Planned = {
            to: f.guardianEmail,
            kind: 'guardian',
            students: [student],
            // One student: straight to their survey. Several: the portal
            // index, which lists each.
            portalUrl: `${env.APP_URL}/parent/applicant/${f.applicationId}/survey`,
          };
          guardianBy.set(f.guardianEmail, p);
          planned.push(p);
        }
      }
    }
    for (const p of guardianBy.values()) {
      if (p.students.length > 1) p.portalUrl = `${env.APP_URL}/parent`;
    }

    if (dryRun) {
      return {
        dryRun: true,
        planned: planned.map(({ to, kind, students }) => ({ to, kind, students })),
      };
    }

    let sent = 0;
    let skipped = 0;
    for (const p of planned) {
      try {
        const mail = renderSurveyRequestEmail({
          recipientKind: p.kind,
          studentNames: p.students,
          portalUrl: p.portalUrl,
        });
        await sendEmail({ to: p.to, ...mail });
        sent += 1;
      } catch (err) {
        // A bad address must not stop the rest of the batch. No address in
        // the log: PII stays in the database.
        skipped += 1;
        req.log.error({ err, kind: p.kind }, 'survey request email failed');
      }
    }
    req.log.info({ sent, skipped, by: req.currentUser!.id }, 'survey request sent');
    return { dryRun: false, sent, skipped };
  });
}
