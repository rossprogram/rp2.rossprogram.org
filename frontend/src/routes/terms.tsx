import { createRoute, Link } from '@tanstack/react-router';
import { rootRoute } from './root';

function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <p className="smallcaps text-accent mb-6">Terms of use</p>
      <h1 className="font-serif text-4xl font-semibold leading-tight mb-4">
        Terms of use.
      </h1>
      <p className="text-muted italic mb-10">
        Effective August&nbsp;1, 2026.
      </p>

      <div className="prose-mm">
        <p>
          These terms apply when you create an account, apply, or take part
          in ℝℙ² &mdash; the online program of the{' '}
          <b>Ross Mathematics Foundation</b> (&ldquo;we&rdquo; or
          &ldquo;the program&rdquo;). By using this site you agree to them.
        </p>
        <p>
          They are meant to be plain-spoken. If any part is unclear, write
          to{' '}
          <a href="mailto:ross@rossprogram.org" className="font-mono">
            ross@rossprogram.org
          </a>{' '}
          and we&rsquo;ll explain.
        </p>

        <H2>Who this is for</H2>

        <p>
          ℝℙ² is for high-school students who want to engage seriously with
          mathematics. Accounts are limited to people aged{' '}
          <b>thirteen or older</b>. We ask for a date of birth at sign-in
          to enforce this.
        </p>
        <p>
          Students under eighteen must have a parent or guardian
          co-sign the application. Parents and guardians remain the
          financially responsible party for the student&rsquo;s
          enrollment.
        </p>

        <H2>Your account</H2>

        <p>
          You are responsible for keeping the email address on your
          account under your own control. Sign-in links sent to that
          address grant access to your application, so please do not
          share them.
        </p>
        <p>
          Provide accurate information on your application. Misstatements
          about identity, age, or educational history may lead us to
          withdraw an offer or rescind an enrollment.
        </p>

        <H2>Applying to the program</H2>

        <p>
          Submitting an application does not guarantee admission. We read
          applications holistically and use the applicant pool to decide
          course offerings, section times, and small cohort assignments.
          Financial-aid decisions are made independently of admission and
          the application process is need-blind.
        </p>
        <p>
          Offers are extended in writing. An offer includes your course
          placement, meeting time, and financial-aid decision. A seat is
          provisional until the family accepts the offer, completes the
          participation agreement, and pays tuition (or confirms an
          approved aid arrangement). Unclaimed seats may be released to
          waitlisted applicants after the deadline stated in the offer
          letter.
        </p>

        <H2>Tuition and refunds</H2>

        <p>
          Tuition for the ten-week pilot term is stated on the program
          page. Payment is due by the deadline stated in your offer
          letter.
        </p>
        <p>
          If you withdraw before classes begin, tuition is fully
          refundable. After classes begin, refunds are pro-rated only
          when the withdrawal is due to a documented medical or family
          emergency; discretionary withdrawals after the term begins are
          non-refundable. Contact{' '}
          <a href="mailto:ross@rossprogram.org" className="font-mono">
            ross@rossprogram.org
          </a>{' '}
          with any refund question.
        </p>

        <H2>Community expectations</H2>

        <p>
          Every family signs a participation agreement before term
          begins. In summary:
        </p>
        <ul className="mt-3 space-y-2 list-disc pl-6">
          <li>
            <b>Be kind.</b> Treat mentors, staff, and fellow students
            with respect. Harassment, discrimination, and personal
            attacks have no place in the program.
          </li>
          <li>
            <b>Do your own work.</b> You are encouraged to talk about
            problems with other students &mdash; that is much of the
            point &mdash; but written solutions you submit for feedback
            must be your own writing, in your own words. Do not use
            large language models to generate proofs you submit.
          </li>
          <li>
            <b>Attend.</b> The live sessions are the heart of the
            program. Please attend consistently and let your mentor
            know if you cannot.
          </li>
          <li>
            <b>Keep the space safe.</b> Do not record live sessions or
            share private program materials publicly. Report anything
            that makes you uncomfortable to program staff or to{' '}
            <a href="mailto:ross@rossprogram.org" className="font-mono">
              ross@rossprogram.org
            </a>
            .
          </li>
        </ul>

        <H2>Removal from the program</H2>

        <p>
          We reserve the ability to remove a student from the program
          for repeated or serious violations of the participation
          agreement, including academic dishonesty, harassment, or
          conduct that endangers other students. We will communicate
          concerns to the student and their guardian before taking such
          a step whenever it is practical to do so.
        </p>

        <H2>Recordings and student work</H2>

        <p>
          Live sessions are generally not recorded. If a session is
          recorded for pedagogical reasons, we will tell you in advance
          and only distribute the recording within the enrolled cohort.
        </p>
        <p>
          Mathematical work you produce during the program &mdash; the
          proofs you write, the notes you keep, the ideas you share with
          your cohort &mdash; belongs to you. Program materials
          (problem sets, lecture notes, our internal course design)
          remain the property of the Ross Mathematics Foundation and
          are shared with you for your personal use within the program.
        </p>

        <H2>Third-party services</H2>

        <p>
          The program uses Zoom, Discord, Gradescope, and Stripe.
          Enrolled students agree to those services&rsquo; own terms
          when they use them. We&rsquo;ll walk enrolled families
          through the setup before term begins.
        </p>

        <H2>Disclaimers</H2>

        <p>
          Participation in the program does not guarantee any academic,
          college-admissions, or professional outcome. The site is
          provided as-is; we will do our best to keep it available and
          working, but cannot promise it will be free of downtime or
          error.
        </p>
        <p>
          The program is a distinct offering from the residential Ross
          summer program. Participation in ℝℙ² is neither required for
          nor a guarantee of admission to the residential program.
        </p>

        <H2>Limitation of liability</H2>

        <p>
          To the extent permitted by law, the Ross Mathematics
          Foundation, its officers, staff, and mentors are not liable
          for indirect, incidental, or consequential damages arising
          from your use of the site or participation in the program.
          Our aggregate liability to you for any claim arising out of
          your participation is limited to the amount of tuition you
          paid for the term in which the claim arose.
        </p>

        <H2>Governing law</H2>

        <p>
          These terms are governed by the laws of the State of Ohio,
          without regard to conflict-of-laws principles. Any dispute
          arising from these terms or your use of the site will be
          resolved in the state or federal courts located in Franklin
          County, Ohio, and you agree to that jurisdiction and venue.
        </p>

        <H2>Changes to these terms</H2>

        <p>
          If we make material changes, we&rsquo;ll update the effective
          date at the top of this page and, where reasonable, notify
          you by email before the change takes effect. Continued use of
          the site after a change constitutes acceptance of the new
          terms.
        </p>

        <H2>Contact</H2>

        <p>
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
          <Link to="/privacy" className="btn btn-ghost no-underline">
            Privacy policy →
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

export const termsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/terms',
  component: TermsPage,
});
