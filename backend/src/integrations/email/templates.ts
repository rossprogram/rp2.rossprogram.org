/*
 * Email templates. Plain HTML + text strings, deliberately simple — the
 * transactional email volume for the pilot is low, and MJML/handlebars are
 * overkill.
 *
 * The sign-in link email lives on magic-link.ts because the phrasing is tied
 * to auth policy (single-use, 15 min TTL). Program-flow emails live here.
 */

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

export function renderGuardianInviteEmail(params: {
  applicantName: string;
  magicLinkUrl: string;
}): RenderedEmail {
  const { applicantName, magicLinkUrl } = params;
  const displayName = applicantName.trim() || 'A student';
  return {
    subject: `${displayName} is applying to ℝℙ² — please review and sign`,
    text: [
      'Hello,',
      '',
      `${displayName} has listed you as their parent or guardian on their application to ℝℙ², the online program of the Ross Mathematics Foundation.`,
      '',
      'Please open your ℝℙ² parent portal to review the application, sign consent, and (if you are requesting financial aid) upload supporting documentation:',
      magicLinkUrl,
      '',
      'This link expires in 15 minutes. If it expires, ask your student to resend it from their application.',
      '',
      'If you did not expect this email, you can ignore it.',
      '',
      '— Ross Mathematics Foundation',
    ].join('\n'),
    html: `
      <p>Hello,</p>
      <p><b>${escapeHtml(displayName)}</b> has listed you as their parent or guardian on their application to ℝℙ², the online program of the Ross Mathematics Foundation.</p>
      <p>Please open your ℝℙ² parent portal to review the application, sign consent, and (if you are requesting financial aid) upload supporting documentation:</p>
      <p><a href="${escapeHtml(magicLinkUrl)}">${escapeHtml(magicLinkUrl)}</a></p>
      <p>This link expires in 15 minutes. If it expires, ask your student to resend it from their application.</p>
      <p>If you did not expect this email, you can ignore it.</p>
      <p>— Ross Mathematics Foundation</p>
    `,
  };
}

export function renderGuardianCompletedEmail(params: {
  applicantName: string;
}): RenderedEmail {
  const displayName = params.applicantName.trim() || 'the applicant';
  return {
    subject: `${displayName}'s ℝℙ² application has been submitted`,
    text: [
      'Hello,',
      '',
      `The parent portal tasks for ${displayName}'s application to ℝℙ² are now complete. The application has been submitted for review.`,
      '',
      'You will hear from us with an admissions decision.',
      '',
      '— Ross Mathematics Foundation',
    ].join('\n'),
    html: `
      <p>Hello,</p>
      <p>The parent portal tasks for <b>${escapeHtml(displayName)}</b>'s application to ℝℙ² are now complete. The application has been submitted for review.</p>
      <p>You will hear from us with an admissions decision.</p>
      <p>— Ross Mathematics Foundation</p>
    `,
  };
}

export function renderApplicantInviteEmail(params: {
  guardianName: string;
  magicLinkUrl: string;
}): RenderedEmail {
  const inviter = params.guardianName.trim() || 'A parent or guardian';
  return {
    subject: `${inviter} invited you to apply to ℝℙ²`,
    text: [
      'Hello,',
      '',
      `${inviter} has invited you to apply to ℝℙ², the online program of the Ross Mathematics Foundation.`,
      '',
      'Follow this link to start your application:',
      params.magicLinkUrl,
      '',
      'This link expires in 15 minutes. If it expires, ask your parent or guardian to resend it from their portal.',
      '',
      'If you were not expecting this email, you can ignore it.',
      '',
      '— Ross Mathematics Foundation',
    ].join('\n'),
    html: `
      <p>Hello,</p>
      <p><b>${escapeHtml(inviter)}</b> has invited you to apply to ℝℙ², the online program of the Ross Mathematics Foundation.</p>
      <p>Follow this link to start your application:</p>
      <p><a href="${escapeHtml(params.magicLinkUrl)}">${escapeHtml(params.magicLinkUrl)}</a></p>
      <p>This link expires in 15 minutes. If it expires, ask your parent or guardian to resend it from their portal.</p>
      <p>If you were not expecting this email, you can ignore it.</p>
      <p>— Ross Mathematics Foundation</p>
    `,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * "Something changed on your application" — deliberately says nothing about
 * the decision itself. The portal is the authority, so one template covers
 * accept, waitlist, and reject, and nothing sensitive lands in an inbox that
 * may be shared or forwarded.
 */
export function renderOfferPublishedEmail(params: {
  studentName: string | null;
  portalUrl: string;
}): RenderedEmail {
  const who = params.studentName?.trim() || 'your student';
  return {
    subject: `An update on ${who}'s ℝℙ² application`,
    text: [
      'Hello,',
      '',
      `There is an update on ${who}'s application to ℝℙ², the online program of the Ross Mathematics Foundation.`,
      '',
      'Please sign in to your portal to see it:',
      params.portalUrl,
      '',
      'If an offer of admission is waiting for you there, the portal is also where you accept or decline it.',
      '',
      '— Ross Mathematics Foundation',
    ].join('\n'),
    html: `
      <p>Hello,</p>
      <p>There is an update on <b>${escapeHtml(who)}</b>'s application to ℝℙ², the online program of the Ross Mathematics Foundation.</p>
      <p>Please sign in to your portal to see it:</p>
      <p><a href="${escapeHtml(params.portalUrl)}">${escapeHtml(params.portalUrl)}</a></p>
      <p>If an offer of admission is waiting for you there, the portal is also where you accept or decline it.</p>
      <p>— Ross Mathematics Foundation</p>
    `,
  };
}

export function renderEnrolledEmail(params: {
  studentName: string | null;
  courseLabel: string | null;
  section: string | null;
  cohort: string | null;
  problemSession: string | null;
  officeHours: string | null;
  portalUrl: string;
}): RenderedEmail {
  const who = params.studentName?.trim() || 'your student';
  const course = params.courseLabel ?? 'your course';

  const facts: string[] = [];
  if (params.courseLabel) facts.push(`Course: ${params.courseLabel}`);
  if (params.section) facts.push(`Section: ${params.section}`);
  if (params.cohort) facts.push(`Group: ${params.cohort}`);
  if (params.problemSession) {
    facts.push(`Problem session: ${params.problemSession} (your local time)`);
  }
  if (params.officeHours) {
    facts.push(`Office hours: ${params.officeHours} (your local time)`);
  }

  return {
    subject: `${who} is enrolled in ℝℙ²`,
    text: [
      'Thank you — enrollment is complete.',
      '',
      `${who} has a confirmed seat in ${course} for the ℝℙ² pilot term, September 27 through December 12, 2026, with a break for US Thanksgiving.`,
      '',
      ...(facts.length > 0 ? [...facts, ''] : []),
      'Before classes begin we will send details about Zoom, Discord, and Gradescope, along with the first problem set.',
      '',
      'You can review these details any time in your portal:',
      params.portalUrl,
      '',
      'We are glad to have you with us.',
      '',
      '— Ross Mathematics Foundation',
    ].join('\n'),
    html: `
      <p>Thank you — enrollment is complete.</p>
      <p><b>${escapeHtml(who)}</b> has a confirmed seat in ${escapeHtml(course)} for the ℝℙ² pilot term, September 27 through December 12, 2026, with a break for US Thanksgiving.</p>
      ${facts.length > 0 ? `<ul>${facts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}
      <p>Before classes begin we will send details about Zoom, Discord, and Gradescope, along with the first problem set.</p>
      <p>You can review these details any time in your portal:</p>
      <p><a href="${escapeHtml(params.portalUrl)}">${escapeHtml(params.portalUrl)}</a></p>
      <p>We are glad to have you with us.</p>
      <p>— Ross Mathematics Foundation</p>
    `,
  };
}
