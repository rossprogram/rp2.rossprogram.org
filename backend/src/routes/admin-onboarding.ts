import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AGREEMENTS, AGREEMENT_KEYS, SIGNER_KINDS, agreementByKey } from '@rp2/shared';
import { env } from '../env.js';
import { requireAuth } from '../auth/session.js';
import { requestGuardianInvite } from '../auth/magic-link.js';
import { sendEmail } from '../integrations/email/ses.js';
import { renderSignatureReminderEmail } from '../integrations/email/templates.js';
import { discordEnabled } from '../integrations/discord/index.js';
import {
  AgreementError,
  outstandingFamilies,
  recentVoids,
  suspectSignatures,
  voidSignature,
} from '../services/agreements.js';
import { reconcileAll } from '../services/discord-sync.js';
import { studentNamesForMany } from '../services/names.js';

/*
 * Admin: who still owes a signature, chasing them, and reconciling Discord.
 *
 * Both actions are deliberately admin-triggered with a preview first, the same
 * shape as publish-then-notify for offers. Nothing here runs on a timer:
 * emailing the families of minors, and removing people from a server, are
 * things a person should decide to do.
 */

const RemindBody = z.object({
  /** Limit the batch; omit to write to everyone outstanding. */
  applicationIds: z.array(z.string()).max(500).optional(),
  /** Preview only — report who WOULD be written to, and send nothing. */
  dryRun: z.boolean().default(false),
});

const VoidBody = z.object({
  document: z.enum(AGREEMENT_KEYS),
  signerKind: z.enum(SIGNER_KINDS),
  /* Required, and long enough to be a sentence. This lands verbatim in the
   * tombstone and is the only explanation anyone reading the record later
   * will have. */
  reason: z.string().min(10).max(1000),
});

const ReconcileBody = z.object({
  dryRun: z.boolean().default(true),
  /* Off by default: a role that already exists carries channel permissions a
   * freshly created one would not. A name we cannot find is reported, not
   * invented. */
  allowCreate: z.boolean().default(false),
});

function documentTitle(key: string): string {
  return agreementByKey(key)?.title ?? key;
}

/** "Code of Conduct (participant)" — what a person actually recognises. */
function describe(outstanding: { document: string; signerKind: string }[]): string[] {
  return outstanding.map(
    (o) => `${documentTitle(o.document)} (${o.signerKind === 'student' ? 'participant' : 'parent or guardian'})`,
  );
}

export async function registerAdminOnboardingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The chase list. Everyone enrolled with a signature still missing, with
   * enough detail to tell the two very different problems apart: a family who
   * has not got around to it, and a guardian who has never logged in at all.
   */
  app.get('/api/admin/agreements', { preHandler: requireAuth('admin') }, async () => {
    const families = outstandingFamilies();
    const names = studentNamesForMany(families.map((f) => f.applicationId));

    return {
      documents: AGREEMENTS.map((d) => ({ key: d.key, title: d.title, version: d.version })),
      outstandingCount: families.length,
      /* Guardians who never accepted their invite cannot sign at all — a
       * reminder about signing is the wrong email for them. */
      neverLoggedIn: families.filter((f) => !f.guardianAccepted).length,
      families: families.map((f) => ({
        applicationId: f.applicationId,
        studentName: names.get(f.applicationId)?.legal ?? null,
        studentEmail: f.studentEmail,
        guardianEmail: f.guardianEmail,
        guardianAccepted: f.guardianAccepted,
        outstanding: f.outstanding,
      })),
      /* Signatures that look like the wrong person typed them. Separate from
       * the chase list on purpose: these families are not waiting on anything,
       * which is exactly why nothing else would ever surface them. */
      suspect: suspectSignatures(),
      voids: recentVoids(),
    };
  });

  /**
   * Void one signature.
   *
   * The only way to undo a signature, because signing is idempotent and the
   * first one counts. Deletes the live row and writes a tombstone carrying the
   * whole of it plus who voided it and why — see `voidSignature()`.
   *
   * The slot is outstanding again afterwards, so the family reappears on the
   * chase list and the student is no longer cleared. That is the intended
   * effect, not a side effect: the point of voiding is that the signature is
   * genuinely missing and someone has to make it again.
   */
  app.post('/api/admin/agreements/:appId/void', { preHandler: requireAuth('admin') }, async (req, reply) => {
    const appId = (req.params as { appId: string }).appId;
    const parsed = VoidBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    try {
      const { state } = voidSignature({
        applicationId: appId,
        document: parsed.data.document,
        signerKind: parsed.data.signerKind,
        voidedByUserId: req.currentUser!.id,
        reason: parsed.data.reason,
      });

      /* Ids only — a voided signature is a name, and names do not go in logs. */
      req.log.warn(
        {
          applicationId: appId,
          document: parsed.data.document,
          signerKind: parsed.data.signerKind,
          voidedBy: req.currentUser!.id,
        },
        'agreement signature voided',
      );

      return { voided: true, outstanding: state.outstanding, fullySigned: state.fullySigned };
    } catch (err) {
      if (err instanceof AgreementError) {
        return reply.code(err.statusCode).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.post('/api/admin/agreements/remind', { preHandler: requireAuth('admin') }, async (req, reply) => {
    const parsed = RemindBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    const wanted = parsed.data.applicationIds;
    const families = outstandingFamilies().filter(
      (f) => !wanted || wanted.includes(f.applicationId),
    );
    const names = studentNamesForMany(families.map((f) => f.applicationId));

    const planned: { to: string; kind: 'student' | 'guardian' | 'guardian_invite' }[] = [];
    for (const f of families) {
      const studentOwes = f.outstanding.filter((o) => o.signerKind === 'student');
      const guardianOwes = f.outstanding.filter((o) => o.signerKind === 'guardian');

      if (studentOwes.length > 0 || guardianOwes.length > 0) {
        planned.push({ to: f.studentEmail, kind: 'student' });
      }
      if (f.guardianEmail && guardianOwes.length > 0) {
        // A guardian who never accepted their invite has no way in: send the
        // invite itself rather than a reminder about a portal they cannot
        // reach. 50 of 192 families were in this state at launch.
        planned.push({
          to: f.guardianEmail,
          kind: f.guardianAccepted ? 'guardian' : 'guardian_invite',
        });
      }
    }

    if (parsed.data.dryRun) {
      return { dryRun: true, families: families.length, planned };
    }

    let sent = 0;
    let skipped = 0;
    const recipients: string[] = [];

    for (const f of families) {
      const studentName = names.get(f.applicationId)?.legal ?? null;
      const studentOwes = describe(f.outstanding.filter((o) => o.signerKind === 'student'));
      const guardianOwes = describe(f.outstanding.filter((o) => o.signerKind === 'guardian'));

      // One send per address: a bad guardian address must not suppress the
      // student's copy, which is the one more likely to be read anyway.
      const jobs: (() => Promise<void>)[] = [
        async () => {
          const mail = renderSignatureReminderEmail({
            studentName,
            recipientKind: 'student',
            ownOutstanding: studentOwes,
            otherOutstanding: guardianOwes,
            portalUrl: `${env.APP_URL}/agreements`,
          });
          await sendEmail({ to: f.studentEmail, ...mail });
          recipients.push(f.studentEmail);
        },
      ];

      if (f.guardianEmail && guardianOwes.length > 0) {
        const guardianEmail = f.guardianEmail;
        jobs.push(async () => {
          if (!f.guardianAccepted) {
            await requestGuardianInvite(guardianEmail, studentName ?? '');
          } else {
            const mail = renderSignatureReminderEmail({
              studentName,
              recipientKind: 'guardian',
              ownOutstanding: guardianOwes,
              otherOutstanding: studentOwes,
              portalUrl: `${env.APP_URL}/parent`,
            });
            await sendEmail({ to: guardianEmail, ...mail });
          }
          recipients.push(guardianEmail);
        });
      }

      for (const job of jobs) {
        try {
          await job();
          sent += 1;
        } catch (err) {
          skipped += 1;
          req.log.error({ err, applicationId: f.applicationId }, 'signature reminder failed');
        }
      }
    }

    return { dryRun: false, families: families.length, sent, skipped, recipients };
  });

  /**
   * Reconcile the guild against the portal. Defaults to a dry run — the
   * live form can remove people from a server, so making that the explicit
   * choice is the point.
   */
  app.post('/api/admin/discord/reconcile', { preHandler: requireAuth('admin') }, async (req, reply) => {
    if (!discordEnabled()) return reply.code(503).send({ error: 'discord_disabled' });

    const parsed = ReconcileBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    try {
      const report = await reconcileAll({
        dryRun: parsed.data.dryRun,
        allowCreate: parsed.data.allowCreate,
      });
      return { dryRun: parsed.data.dryRun, ...report };
    } catch (err) {
      req.log.error({ err }, 'discord reconcile failed');
      return reply.code(502).send({ error: 'discord_error' });
    }
  });
}
