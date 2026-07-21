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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
