import { createRoute, Link } from '@tanstack/react-router';
import { rootRoute } from './root';

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "I've never written a proof. Can I really apply?",
    a: (
      <p>
        Yes &mdash; please do. The application asks about your proof-writing
        experience only so that we can place you well, and &ldquo;I am new to
        proof-based mathematics&rdquo; is a perfectly good answer. Learning to
        write proofs is much of the point.
      </p>
    ),
  },
  {
    q: 'What if the live session is at a bad time for me?',
    a: (
      <p>
        The application collects your weekly availability and time zone, and we
        schedule sections around the admitted pool. We can&rsquo;t promise
        every time zone will work in the pilot term, but your offer letter
        will state your exact meeting time before you commit to anything.
      </p>
    ),
  },
  {
    q: 'How is this different from the Ross summer program?',
    a: (
      <>
        <p>
          The residential summer program is an immersive six-week experience
          centered on number theory. ℝℙ² is shorter each week, runs during the
          school year, and explores topics beyond the summer curriculum. It is
          a different program with the same philosophy: mathematics learned by
          doing it yourself, slowly and deeply.
        </p>
        <p className="mt-3">
          Applying to one has no bearing on the other &mdash; online
          participation is neither required for nor a guarantee of residential
          admission.
        </p>
      </>
    ),
  },
  {
    q: 'How much work is it each week?',
    a: (
      <p>
        Two and a half hours of live meetings (the seminar and the optional
        office hour), plus your own time on the problem set &mdash; for most
        students, a few additional hours. The sets are designed to be worked on
        across the week, not finished in a sitting.
      </p>
    ),
  },
  {
    q: 'Is this a class for a grade or credit?',
    a: (
      <p>
        No grades, no credit, no exams. You&rsquo;ll receive something we
        think is more useful: weekly written feedback on your mathematics from
        someone who read it closely.
      </p>
    ),
  },
  {
    q: 'Who teaches the courses?',
    a: (
      <p>
        Graduate students in mathematics, supported by advanced undergraduate
        course assistants &mdash; many with previous Ross experience &mdash;
        hired and trained by the Ross Program.
      </p>
    ),
  },
];

function FaqPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <p className="smallcaps text-accent mb-6">Questions we expect</p>
      <h1 className="font-serif text-4xl font-semibold leading-tight mb-8">
        Frequently asked questions.
      </h1>

      <div className="border-t border-rule">
        {FAQS.map((f, i) => (
          <details
            key={i}
            className="border-b border-rule group [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="cursor-pointer flex justify-between items-center gap-4 py-5 font-semibold text-lg">
              <span>{f.q}</span>
              <span
                aria-hidden
                className="font-mono text-accent text-xl shrink-0 group-open:hidden"
              >
                +
              </span>
              <span
                aria-hidden
                className="font-mono text-accent text-xl shrink-0 hidden group-open:inline"
              >
                −
              </span>
            </summary>
            <div className="pb-5 text-ink/90">{f.a}</div>
          </details>
        ))}
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-4">
        <Link to="/" className="btn btn-ghost no-underline">
          ← Back to the program page
        </Link>
        <Link to="/parents" className="btn btn-ghost no-underline">
          For parents →
        </Link>
      </div>
    </main>
  );
}

export const faqRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/faq',
  component: FaqPage,
});
