import { createRoute, Link } from '@tanstack/react-router';
import { rootRoute } from './root';

const COURSES: { tag: string; title: string; body: React.ReactNode }[] = [
  {
    tag: 'Topology',
    title: 'Point-Set Topology',
    body: (
      <>
        What survives when you forget about distance and keep only
        &ldquo;nearness&rdquo;? Open sets, continuity, compactness,
        connectedness &mdash; the language in which modern analysis and
        geometry are written. An online descendant of a course that has
        become a favorite at the residential program.
      </>
    ),
  },
  {
    tag: 'Algebra · Geometry',
    title: 'Geometric Group Theory',
    body: (
      <>
        Groups are usually met as algebra; here they become shapes. Cayley
        graphs, symmetries of tilings and trees, and the surprising idea that
        you can study a group by studying the geometry of a space it acts on.
      </>
    ),
  },
  {
    tag: 'Combinatorics',
    title: 'Combinatorial Game Theory',
    body: (
      <>
        Nim, Hackenbush, and games you have never heard of &mdash; analyzed
        completely. Winning strategies are not guessed but proved, and the
        values of games turn out to form a number system stranger and larger
        than the reals.
      </>
    ),
  },
  {
    tag: 'Number theory',
    title: 'Quadratic Forms',
    body: (
      <>
        Which whole numbers can be written as <i>x</i>² + <i>y</i>²? As{' '}
        <i>x</i>² + 2<i>y</i>²? A visual, hands-on tour of binary quadratic
        forms in the spirit of John Conway&rsquo;s{' '}
        <i>The Sensual (Quadratic) Form</i>, built around his
        &ldquo;topograph&rdquo; &mdash; a picture that makes a classical
        subject suddenly obvious.
      </>
    ),
  },
];

function CoursesPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <p className="smallcaps text-accent mb-6">Courses · Fall 2026</p>
      <h1 className="font-serif text-4xl font-semibold leading-tight mb-6">
        The Fall 2026 courses.
      </h1>
      <p>
        Each student enrolls in one course for the term. These are the courses
        planned for the pilot; the final list, and the number of sections of
        each, will depend on applicant interest and scheduling, so the
        application asks you to rank your preferences.
      </p>

      <div className="mt-8 border-t border-rule">
        {COURSES.map((c, i) => (
          <div key={i} className="py-6 border-b border-rule">
            <div className="smallcaps text-muted mb-1">{c.tag}</div>
            <h2 className="font-serif text-xl font-semibold">{c.title}</h2>
            <p className="mt-2">{c.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-4">
        <Link to="/" className="btn btn-ghost no-underline">
          ← Back to the program page
        </Link>
        <Link to="/auth/request" className="btn btn-primary no-underline">
          Start an application →
        </Link>
      </div>
    </main>
  );
}

export const coursesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/courses',
  component: CoursesPage,
});
