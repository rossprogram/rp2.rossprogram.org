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
        <h2 className="font-serif text-2xl font-semibold mt-2 mb-3">
          What to expect
        </h2>
        <p>
          Students work in small groups led by graduate-student mentors, with
          help from undergraduate course assistants. Everyone on staff is
          hired and trained by the Ross Mathematics Program. Training
          includes online teaching, how to give good feedback, and our
          youth-safety and professional-boundary policies.
        </p>

        <h2 className="font-serif text-2xl font-semibold mt-10 mb-3">
          Youth safety
        </h2>
        <p>
          Staff are present at every live session, including breakout rooms,
          and the Discord server is moderated. Before the term starts, every
          family signs a participation agreement that spells out what we
          expect around conduct and academic honesty. We can and will remove
          students who don&rsquo;t follow it. You&rsquo;ll get welcome
          materials before classes begin, and you&rsquo;re welcome to contact
          us at any point with questions or concerns.
        </p>

        <h2 className="font-serif text-2xl font-semibold mt-10 mb-3">
          Technical requirements
        </h2>
        <p>
          A computer, a decent internet connection, Zoom, and free Discord
          and Gradescope accounts. We&rsquo;ll help enrolled families get
          set up before the first class.
        </p>

        <h2 className="font-serif text-2xl font-semibold mt-10 mb-3">
          Tuition &amp; financial aid
        </h2>
        <p>
          Tuition for the ten-week term is about <b>$1,500</b>. Need-based
          aid is available, up to full scholarships, and admissions are
          need-blind: asking for aid won&rsquo;t affect the admission
          decision. If cost is the thing holding you back, apply anyway.
        </p>

        <h2 className="font-serif text-2xl font-semibold mt-10 mb-3">
          Contacting us
        </h2>
        <p>
          Questions are welcome anytime, before applying or mid-term. Write
          to{' '}
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
