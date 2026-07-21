import { useQuery } from '@tanstack/react-query';
import { createRoute, Link } from '@tanstack/react-router';
import { rootRoute } from './root';
import { fetchMe } from '../api/client';

function IndexPage() {
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const signedIn = !!me.data;

  return (
    <>
      <Hero signedIn={signedIn} />
      <main className="max-w-3xl mx-auto px-6">
        <About />
        <Week />
        <Courses />
        <WhoShouldApply />
        <Admissions />
        <Tuition />
      </main>
      <ClosingCTA signedIn={signedIn} />
    </>
  );
}

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section
      className="relative border-b border-rule overflow-hidden"
      style={{
        backgroundImage:
          'linear-gradient(rgba(15,31,23,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(15,31,23,0.045) 1px, transparent 1px)',
        backgroundSize: '2.2rem 2.2rem',
      }}
    >
      <div className="max-w-5xl mx-auto px-6 py-16 md:py-24 grid gap-12 md:grid-cols-[1.35fr_1fr] items-center">
        <div>
          <p className="smallcaps text-accent mb-6">
            The Ross Mathematics Program · Online · Fall 2026
          </p>
          <h1 className="font-serif font-bold text-[clamp(4rem,10vw,6.5rem)] leading-none tracking-tight">
            ℝℙ²
          </h1>
          <p className="mt-6 text-[clamp(1.15rem,2.4vw,1.4rem)] leading-snug max-w-[30ch]">
            A ten-week online seminar in proof-based mathematics, for
            high-school students who want to think deeply about hard problems.
          </p>
          <p className="mt-6 font-mono text-sm text-muted">
            <b className="text-ink font-normal">Sept 28 – Dec 11, 2026</b> · one
            week off at Thanksgiving
            <br />
            Priority application deadline:{' '}
            <b className="text-ink font-normal">August 14</b>
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            {signedIn ? (
              <Link to="/apply" className="btn btn-primary no-underline">
                Go to my application →
              </Link>
            ) : (
              <Link to="/auth/request" className="btn btn-primary no-underline">
                Start an application
              </Link>
            )}
            <Link to="/" hash="courses" className="btn btn-ghost no-underline">
              See the courses
            </Link>
          </div>
        </div>
        <figure className="max-w-[17rem] mx-auto md:mx-0">
          <ProjectiveDisk />
          <figcaption className="mt-3 text-sm italic text-muted text-center leading-snug">
            ℝℙ², the real projective plane: a disk whose opposite boundary
            points are declared to be the same point. Glue carefully.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function ProjectiveDisk() {
  return (
    <svg
      viewBox="0 0 300 300"
      role="img"
      aria-label="A disk with antipodal boundary points identified — a standard picture of the real projective plane"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto"
    >
      <circle cx="150" cy="150" r="110" fill="none" stroke="#0F1F17" strokeWidth="2" />
      <line x1="72.2" y1="72.2" x2="227.8" y2="227.8" stroke="#14532D" strokeWidth="1.5" strokeDasharray="5 5" />
      <line x1="72.2" y1="227.8" x2="227.8" y2="72.2" stroke="#14532D" strokeWidth="1.5" strokeDasharray="5 5" />
      <circle cx="72.2" cy="72.2" r="5" fill="#14532D" />
      <circle cx="227.8" cy="227.8" r="5" fill="none" stroke="#14532D" strokeWidth="2" />
      <circle cx="227.8" cy="72.2" r="5" fill="#14532D" />
      <circle cx="72.2" cy="227.8" r="5" fill="none" stroke="#14532D" strokeWidth="2" />
      <text x="56" y="60" fontFamily="'Computer Modern Serif', serif" fontStyle="italic" fontSize="17" fill="#0F1F17">P</text>
      <text x="234" y="248" fontFamily="'Computer Modern Serif', serif" fontStyle="italic" fontSize="17" fill="#0F1F17">P′</text>
      <text x="236" y="60" fontFamily="'Computer Modern Serif', serif" fontStyle="italic" fontSize="17" fill="#0F1F17">Q</text>
      <text x="48" y="248" fontFamily="'Computer Modern Serif', serif" fontStyle="italic" fontSize="17" fill="#0F1F17">Q′</text>
    </svg>
  );
}

function SectionHead({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 mb-5">
      <span className="smallcaps text-accent whitespace-nowrap">§{n}</span>
      <h2 className="font-serif text-[1.7rem] font-semibold leading-tight">{children}</h2>
    </div>
  );
}

function Note({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5 pl-5 py-4 pr-5 bg-accent-soft border-l-2 border-accent">
      <span className="smallcaps text-accent block mb-1">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function About() {
  return (
    <section id="about" className="pt-14">
      <SectionHead n={1}>What this is</SectionHead>
      <p>
        ℝℙ² (&ldquo;Ross Projective&rdquo;) is the new online program of the{' '}
        <b>Ross Mathematics Program</b>, one of the longest-running summer
        mathematics programs in the United States. It brings the Ross approach
        &mdash; think deeply of simple things &mdash; to a ten-week online
        term.
      </p>
      <p className="mt-4">
        Each course is built around a weekly Ross-style problem set: a sequence
        of problems that leads you to discover a piece of mathematics for
        yourself, rather than a textbook that hands it to you. You will spend
        the week wrestling with the problems, meet live to work on mathematics
        with your cohort and a graduate-student mentor, and submit written
        proofs that receive careful, personal feedback.
      </p>
      <p className="mt-4">
        This is not a lecture course, and it is not a video series. It is a
        seminar: small groups, live conversation, and sustained engagement with
        problems that are genuinely hard.
      </p>
      <Note label="A note on the name">
        ℝℙ² denotes the real projective plane &mdash; the ordinary plane, plus
        one extra point for every direction, so that parallel lines finally get
        to meet. It seemed like the right name for the Ross Program, extended.
      </Note>
    </section>
  );
}

function Week() {
  const rows: [string, React.ReactNode][] = [
    [
      '90 min · live session',
      <>
        <b>Problem seminar.</b> A short framing from your mentor &mdash; twenty
        or thirty minutes of recap, discussion, or new ideas &mdash; and then
        the real work: an hour of collaborative problem solving in small
        breakout cohorts. Most of the session is you doing mathematics, out
        loud, with other people.
      </>,
    ],
    [
      '60 min · office hour',
      <>
        <b>Office hour.</b> Optional but encouraged. Come for help with the
        problem set, extension problems if you are ahead, more examples if you
        want them, or unhurried mathematical conversation.
      </>,
    ],
    [
      'Your own time',
      <>
        <b>The problem set.</b> The heart of the program. You will write real
        proofs and submit them each week, and your mentor and course assistants
        will return them with written feedback &mdash; on your mathematics and
        on your mathematical writing.
      </>,
    ],
    [
      'Anytime',
      <>
        <b>The community.</b> A moderated Discord server connects students
        across all courses, with program-wide events during the term: guest
        lectures, panels on college and mathematical careers, and student
        showcases.
      </>,
    ],
  ];
  return (
    <section id="week" className="pt-14">
      <SectionHead n={2}>A week at ℝℙ²</SectionHead>
      <p>
        Every course meets on a fixed weekly schedule, set around the
        availability of admitted students. A typical week looks like this:
      </p>
      <div className="mt-6 border-t border-rule">
        {rows.map(([when, what], i) => (
          <div
            key={i}
            className="grid gap-x-5 gap-y-1 md:grid-cols-[11rem_1fr] py-4 border-b border-rule"
          >
            <div className="font-mono text-sm text-accent pt-1">{when}</div>
            <div>{what}</div>
          </div>
        ))}
      </div>
      <p className="mt-5">
        Plan on the two and a half live hours plus several more with the
        problem set. The problems reward time; students who make room for them
        each week get the most out of the term.
      </p>
    </section>
  );
}

function Courses() {
  const courses: { tag: string; title: string; body: React.ReactNode }[] = [
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
  return (
    <section id="courses" className="pt-14 scroll-mt-24">
      <SectionHead n={3}>Courses · Fall 2026</SectionHead>
      <p>
        Each student enrolls in one course for the term. These are the courses
        planned for the pilot; the final list, and the number of sections of
        each, will depend on applicant interest and scheduling, so the
        application asks you to rank your preferences.
      </p>
      <div className="mt-6 border-t border-rule">
        {courses.map((c, i) => (
          <div key={i} className="py-6 border-b border-rule">
            <div className="smallcaps text-muted mb-1">{c.tag}</div>
            <h3 className="font-serif text-xl font-semibold">{c.title}</h3>
            <p className="mt-2">{c.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WhoShouldApply() {
  return (
    <section id="who" className="pt-14">
      <SectionHead n={4}>Who should apply</SectionHead>
      <p>
        ℝℙ² is for high-school students, anywhere in the world, who want to
        engage seriously with mathematics.{' '}
        <b>Prior proof-writing experience is not required.</b> Some of our
        students will have competition backgrounds or previous proof courses;
        others will be writing their first proofs with us. Courses and cohorts
        are arranged so that both can thrive.
      </p>
      <p className="mt-4">
        What we do look for is appetite: curiosity, persistence, and a
        willingness to stay stuck on a problem longer than feels comfortable.
        If you have ever been unable to put a math problem down, this program
        was designed for you.
      </p>
      <Note label="Relationship to the residential program">
        ℝℙ² is a distinct program from the residential Ross summer program,
        which remains the flagship Ross experience. Participating online is not
        required for residential admission, and does not guarantee it &mdash;
        but it is a genuine Ross experience in its own right, and a natural way
        to grow into the community.
      </Note>
    </section>
  );
}

function Admissions() {
  const items: [string, React.ReactNode][] = [
    [
      'Now → August 14',
      <>
        Applications open. Apply by <b>August 14</b> for priority consideration.
      </>,
    ],
    [
      'Week of August 21',
      <>
        First-round offers go out, including your course placement, meeting
        time, and financial-aid decision.
      </>,
    ],
    [
      'September',
      <>
        Families confirm enrollment; students are added to the course page,
        Discord, and Gradescope. Remaining seats are offered to waitlisted and
        late applicants as space allows.
      </>,
    ],
    [
      'September 28',
      <>
        Classes begin. Ten instructional weeks, with a one-week Thanksgiving
        break, concluding December 11.
      </>,
    ],
  ];
  return (
    <section id="admissions" className="pt-14 scroll-mt-24">
      <SectionHead n={5}>Admissions &amp; dates</SectionHead>
      <p>
        The application is short and reflective rather than competitive. We
        ask for basic information, a school transcript, your weekly
        availability, your course preferences, and a few written reflections on
        how you think about mathematics &mdash; what you do when you are stuck,
        how your understanding changes, how you work with others. There is no
        entrance exam.
      </p>
      <p className="mt-4">
        We read applications holistically and use the whole applicant pool to
        finalize course offerings, section times, and small problem-solving
        cohorts. That is why the priority deadline matters: it lets us schedule
        sections around <i>your</i> availability.
      </p>
      <ol className="mt-6 border-l-2 border-rule pl-6 space-y-6">
        {items.map(([d, t], i) => (
          <li key={i} className="relative">
            <span
              aria-hidden
              className="absolute -left-[calc(1.5rem+5px)] top-2 w-[9px] h-[9px] rounded-full bg-accent"
            />
            <div className="font-mono text-sm text-accent">{d}</div>
            <div className="mt-1">{t}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Tuition() {
  return (
    <section id="tuition" className="pt-14 pb-14 scroll-mt-24">
      <SectionHead n={6}>Tuition &amp; financial aid</SectionHead>
      <p>
        Tuition for the ten-week term is approximately <b>$1,500</b>, which
        covers all instruction, materials, feedback, and community programming.
      </p>
      <p className="mt-4">
        Cost should never be the reason a student doesn&rsquo;t apply.
        Need-based financial aid &mdash; up to and including{' '}
        <b>full scholarships</b> &mdash; is available, and admissions are{' '}
        <b>need-blind</b>: requesting aid has no effect on your admission
        decision. The application includes a simple aid request; families are
        welcome to write to us with questions before applying.
      </p>
    </section>
  );
}

function ClosingCTA({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="border-t border-rule bg-accent-soft mt-14">
      <div className="max-w-3xl mx-auto px-6 py-14 text-center">
        <h2 className="font-serif text-3xl font-semibold">
          Think deeply of simple things.
        </h2>
        <p className="mt-3 text-ink/85">
          Applications for the Fall 2026 term are open now.
          <br />
          Priority deadline: <b>August 14, 2026</b>.
        </p>
        <div className="mt-6 flex justify-center flex-wrap gap-4">
          {signedIn ? (
            <Link to="/apply" className="btn btn-primary no-underline">
              Go to my application →
            </Link>
          ) : (
            <Link to="/auth/request" className="btn btn-primary no-underline">
              Start an application
            </Link>
          )}
          <a
            href="mailto:fowler@math.osu.edu"
            className="btn btn-ghost no-underline"
          >
            Write to us with questions
          </a>
        </div>
      </div>
    </div>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: IndexPage,
});
