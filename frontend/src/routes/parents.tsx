import { createRoute, Link } from '@tanstack/react-router';
import { rootRoute } from './root';

function ParentsPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <p className="smallcaps text-accent mb-6">For parents &amp; guardians</p>
      <h1 className="font-serif text-4xl font-semibold leading-tight mb-8">
        What your student can expect from ℝℙ².
      </h1>

      <div className="prose-mm">
        <p>
          Your student will be working in small groups with graduate-student
          mentors and undergraduate course assistants, all hired and trained by
          the Ross Mathematics Program. Mentor training covers online pedagogy,
          feedback, and &mdash; importantly &mdash; youth-safety expectations
          and professional boundaries.
        </p>

        <h2 className="font-serif text-2xl font-semibold mt-10 mb-3">
          Youth safety
        </h2>
        <p>
          All live sessions are staffed, breakout rooms are monitored, and the
          Discord community is moderated. Every family signs a participation
          agreement setting out clear expectations for respectful conduct and
          academic integrity, and we reserve the ability to remove students who
          violate community norms. You will receive welcome materials before
          the term begins, and you can always reach the program directly with
          questions or concerns.
        </p>

        <h2 className="font-serif text-2xl font-semibold mt-10 mb-3">
          Technical requirements
        </h2>
        <p>
          Your student needs a computer with a reliable internet connection,
          Zoom, and a free Discord and Gradescope account. We will walk
          enrolled families through the setup before classes begin.
        </p>

        <h2 className="font-serif text-2xl font-semibold mt-10 mb-3">
          Tuition &amp; financial aid
        </h2>
        <p>
          Tuition is approximately <b>$1,500</b> for the ten-week term.
          Need-based aid up to and including full scholarships is available,
          and admissions are need-blind &mdash; requesting aid has no effect on
          the admission decision. If cost is a concern, please still apply.
        </p>

        <h2 className="font-serif text-2xl font-semibold mt-10 mb-3">
          Contacting us
        </h2>
        <p>
          Questions before your student applies, or during the term, are
          always welcome. Write to{' '}
          <a href="mailto:ross@rossprogram.org" className="font-mono">
            ross@rossprogram.org
          </a>
          .
        </p>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link to="/" className="btn btn-ghost no-underline">
            ← Back to the program page
          </Link>
          <Link to="/faq" className="btn btn-ghost no-underline">
            Frequently asked questions →
          </Link>
        </div>
      </div>
    </main>
  );
}

export const parentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/parents',
  component: ParentsPage,
});
