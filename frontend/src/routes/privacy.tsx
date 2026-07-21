import { createRoute, Link } from '@tanstack/react-router';
import { rootRoute } from './root';

function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <p className="smallcaps text-accent mb-6">Privacy policy</p>
      <h1 className="font-serif text-4xl font-semibold leading-tight mb-4">
        Privacy at ℝℙ².
      </h1>
      <p className="text-muted italic mb-10">
        Effective August&nbsp;1, 2026.
      </p>

      <div className="prose-mm">
        <p>
          This policy describes what personal information ℝℙ² collects, how we
          use it, and the choices you have. ℝℙ² is operated by the{' '}
          <b>Ross Mathematics Foundation</b> (referred to below as
          &ldquo;we&rdquo; or &ldquo;the program&rdquo;).
        </p>
        <p>
          If any of this is unclear, please write to{' '}
          <a href="mailto:ross@rossprogram.org" className="font-mono">
            ross@rossprogram.org
          </a>{' '}
          — we would rather you ask than guess.
        </p>

        <H2>Information we collect</H2>

        <p>
          <b>Account information.</b> When you request a sign-in link we
          record your email address, the date and time of the request, and
          the IP address that made it. On your first sign-in we ask for
          your date of birth so we can confirm you are at least thirteen.
          We store the date of birth on your account; we do not share it
          with reviewers.
        </p>
        <p>
          <b>Application information.</b> The application collects the
          responses you provide: your name, school, city / state / country,
          time zone, weekly availability, prior program history, course
          preferences, parent or guardian contact information, an
          uploaded school transcript, optional financial-aid documentation,
          and short written reflections on your mathematical experience.
        </p>
        <p>
          <b>Uploaded documents.</b> Transcripts and financial-aid
          documents you attach are stored as files in private Amazon S3
          buckets. Only staff involved in application review, admissions,
          or financial aid can access them.
        </p>
        <p>
          <b>Session information.</b> When you sign in, we place a signed,
          HTTP-only session cookie on your browser so you stay signed in.
          We do not use analytics, advertising, or third-party tracking
          cookies of any kind.
        </p>

        <H2>How we use it</H2>

        <p>
          We use the information you provide to:
        </p>
        <ul className="mt-3 space-y-2 list-disc pl-6">
          <li>review your application and communicate our decision;</li>
          <li>
            schedule courses and cohorts around admitted students&rsquo;
            availability;
          </li>
          <li>
            send you the small number of transactional emails the program
            requires — a sign-in link when you request one, an application
            receipt, an offer letter, class reminders, and program
            announcements;
          </li>
          <li>
            operate the program day to day, including grading, feedback,
            and moderation of the community space.
          </li>
        </ul>
        <p className="mt-4">
          We do not sell your information. We do not send you marketing
          from other organizations. We do not build advertising profiles.
        </p>

        <H2>Where it lives</H2>

        <p>
          The program&rsquo;s database and file storage are hosted in
          Amazon Web Services facilities in the United States (regions
          <span className="font-mono"> us-east-1</span> and{' '}
          <span className="font-mono">us-east-2</span>). Backups of the
          database and uploaded files are retained in the same region for
          disaster recovery.
        </p>

        <H2>Service providers</H2>

        <p>
          We use a small number of trusted service providers to operate the
          program:
        </p>
        <ul className="mt-3 space-y-2 list-disc pl-6">
          <li>
            <b>Amazon Web Services</b> — email delivery (SES), database
            hosting, and file storage (S3);
          </li>
          <li>
            <b>Zoom</b> — live class sessions and office hours, for
            enrolled students only;
          </li>
          <li>
            <b>Gradescope</b> — problem-set submission and feedback, for
            enrolled students only;
          </li>
          <li>
            <b>Discord</b> — moderated program community, for enrolled
            students only;
          </li>
          <li>
            <b>Stripe</b> — tuition payment, for enrolled students only.
          </li>
        </ul>
        <p className="mt-4">
          Each of these providers has its own privacy practices. Where an
          enrolled student needs an account with one of these services,
          we&rsquo;ll walk families through what that entails before term
          begins.
        </p>

        <H2>How long we keep it</H2>

        <p>
          Application data — the responses, uploaded transcript, and any
          aid documents — is retained for <b>three years</b> after your
          final interaction with the program, so we can respond to
          transcript-verification requests, honor re-application, and
          maintain program records. After three years we permanently
          delete uploaded documents and pseudonymize the remaining
          application responses.
        </p>
        <p>
          You may request earlier deletion by writing to{' '}
          <a href="mailto:ross@rossprogram.org" className="font-mono">
            ross@rossprogram.org
          </a>
          . We will honor the request within thirty days, except where a
          legal or accounting obligation requires us to keep specific
          records longer.
        </p>

        <H2>Your rights</H2>

        <p>
          You can, at any time and free of charge:
        </p>
        <ul className="mt-3 space-y-2 list-disc pl-6">
          <li>ask for a copy of the personal information we hold about you;</li>
          <li>ask us to correct information that is inaccurate or incomplete;</li>
          <li>ask us to delete your information, subject to the retention note above;</li>
          <li>withdraw your application before an admission decision is issued.</li>
        </ul>
        <p className="mt-4">
          To exercise any of these rights, write to{' '}
          <a href="mailto:ross@rossprogram.org" className="font-mono">
            ross@rossprogram.org
          </a>{' '}
          from the email address associated with your account.
        </p>

        <H2>Security</H2>

        <p>
          All traffic between your browser and our servers is encrypted in
          transit with TLS. Files and the database are stored in AWS with
          server-side encryption at rest. Access to production systems is
          restricted to authorized program staff on hardened accounts.
          Sign-in uses one-time email links, not passwords, which
          eliminates password-reuse risk.
        </p>
        <p>
          No online system is perfectly secure. If you notice a security
          issue, please write to{' '}
          <a href="mailto:ross@rossprogram.org" className="font-mono">
            ross@rossprogram.org
          </a>{' '}
          and we&rsquo;ll look into it promptly.
        </p>

        <H2>Applicants under 18</H2>

        <p>
          ℝℙ² is designed for high-school students. Accounts are limited to
          people aged <b>thirteen or older</b>. We collect a date of birth
          at sign-in and reject accounts below that threshold.
        </p>
        <p>
          For students under eighteen, the application also collects
          parent or guardian contact information. A parent or guardian
          signature is required to submit an application. Parents and
          guardians may write to us at{' '}
          <a href="mailto:ross@rossprogram.org" className="font-mono">
            ross@rossprogram.org
          </a>{' '}
          to review, correct, or delete their student&rsquo;s information
          at any time.
        </p>

        <H2>Changes to this policy</H2>

        <p>
          If we make material changes, we will update the effective date
          at the top of this page and, where reasonable, notify you by
          email before the change takes effect.
        </p>

        <H2>Contact</H2>

        <p>
          Questions about this policy or how we handle your information:
        </p>
        <p className="mt-2">
          Ross Mathematics Foundation
          <br />
          <a href="mailto:ross@rossprogram.org" className="font-mono">
            ross@rossprogram.org
          </a>
        </p>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link to="/" className="btn btn-ghost no-underline">
            ← Back to the program page
          </Link>
          <Link to="/terms" className="btn btn-ghost no-underline">
            Terms of use →
          </Link>
        </div>
      </div>
    </main>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif text-2xl font-semibold mt-10 mb-3">{children}</h2>
  );
}

export const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/privacy',
  component: PrivacyPage,
});
