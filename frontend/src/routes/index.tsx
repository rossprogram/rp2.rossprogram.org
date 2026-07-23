import { useQuery } from "@tanstack/react-query";
import { createRoute, Link } from "@tanstack/react-router";
import { rootRoute } from "./root";
import { fetchMe } from "../api/client";
import { EndMark } from "../components/Layout";

function IndexPage() {
	const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
	const signedIn = !!me.data;

	return (
		<>
			<Hero signedIn={signedIn} />
			<main className="max-w-3xl mx-auto px-6">
				<About />
				<Week />
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
					"linear-gradient(rgba(15,31,23,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(15,31,23,0.045) 1px, transparent 1px)",
				backgroundSize: "2.2rem 2.2rem",
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
					<p className="mt-6 text-[clamp(1.15rem,2.4vw,1.4rem)] leading-snug max-w-[32ch]">
						A ten-week experience of proof-based mathematics. For high-school
						students. September 28 through December 11, 2026, with a break for
						US Thanksgiving.
					</p>
					<p className="mt-6 font-mono text-sm text-muted">
						Priority application deadline:{" "}
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
						<Link to="/courses" className="btn btn-ghost no-underline">
							See the courses
						</Link>
					</div>
					{!signedIn && (
						<p className="mt-4 text-sm text-muted">
							Parent or guardian?{" "}
							<Link
								to="/auth/request"
								search={{ role: "guardian" }}
								className="text-ink underline underline-offset-2 hover:no-underline"
							>
								Register here →
							</Link>
						</p>
					)}
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
			<circle
				cx="150"
				cy="150"
				r="110"
				fill="none"
				stroke="#0F1F17"
				strokeWidth="2"
			/>
			<line
				x1="72.2"
				y1="72.2"
				x2="227.8"
				y2="227.8"
				stroke="#14532D"
				strokeWidth="1.5"
				strokeDasharray="5 5"
			/>
			<line
				x1="72.2"
				y1="227.8"
				x2="227.8"
				y2="72.2"
				stroke="#14532D"
				strokeWidth="1.5"
				strokeDasharray="5 5"
			/>
			<circle cx="72.2" cy="72.2" r="5" fill="#14532D" />
			<circle
				cx="227.8"
				cy="227.8"
				r="5"
				fill="none"
				stroke="#14532D"
				strokeWidth="2"
			/>
			<circle cx="227.8" cy="72.2" r="5" fill="#14532D" />
			<circle
				cx="72.2"
				cy="227.8"
				r="5"
				fill="none"
				stroke="#14532D"
				strokeWidth="2"
			/>
			<text
				x="56"
				y="60"
				fontFamily="'Computer Modern Serif', serif"
				fontStyle="italic"
				fontSize="17"
				fill="#0F1F17"
			>
				P
			</text>
			<text
				x="234"
				y="248"
				fontFamily="'Computer Modern Serif', serif"
				fontStyle="italic"
				fontSize="17"
				fill="#0F1F17"
			>
				P′
			</text>
			<text
				x="236"
				y="60"
				fontFamily="'Computer Modern Serif', serif"
				fontStyle="italic"
				fontSize="17"
				fill="#0F1F17"
			>
				Q
			</text>
			<text
				x="48"
				y="248"
				fontFamily="'Computer Modern Serif', serif"
				fontStyle="italic"
				fontSize="17"
				fill="#0F1F17"
			>
				Q′
			</text>
		</svg>
	);
}

function SectionHead({
	n,
	children,
}: {
	n: number;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-baseline gap-4 mb-5">
			<span className="smallcaps text-accent whitespace-nowrap">§{n}</span>
			<h2 className="font-serif text-[1.7rem] font-semibold leading-tight">
				{children}
			</h2>
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
			<SectionHead n={1}>What is&hellip; ℝℙ²?</SectionHead>
			<p>
				ℝℙ² is the real projective plane &mdash; where every two points meet in
				a line. Online. The Ross Program, extended with (on)line at infinity.
			</p>
			<p className="mt-4">
				More seriously, this is our way of bringing the{" "}
				<b>Ross Mathematics Program</b> (running since 1957!) to more people
				during the academic year. We&rsquo;re taking our usual approach of
				&ldquo;thinking deeply of simple things&rdquo; and offering that
				experience during the school year.
			</p>
			<p className="mt-4">
				Like the summer program, each online academic-year course is organized
				around problem sets. The problem sets are written so that you discover
				the mathematics yourself instead of reading it out of a textbook. You
				spend the week working on the problems, you&rsquo;ll meet once a week
				with your group and a graduate-student mentor to do math together, and
				you&rsquo;ll turn in written proofs, which we read carefully and return
				with comments. It'll be really fun.
			</p>
			<p className="mt-4">
				There aren&rsquo;t lectures to watch. It&rsquo;s a seminar: a group of
				people doing math together for ten weeks.
			</p>
			<EndMark />
		</section>
	);
}

function Week() {
	const rows: [string, React.ReactNode][] = [
		[
			"90 min · live session",
			<>
				<b>Live session.</b> Your mentor talks for maybe twenty or thirty
				minutes &mdash; a review, some discussion, new ideas &mdash; and then we
				split into small groups and work on problems for the rest of the
				session. Most of it is you doing math out loud with other people.
			</>,
		],
		[
			"90 min · office hour",
			<>
				<b>Office hour.</b> Optional. Come if you&rsquo;re stuck on the problem
				set, or if you&rsquo;re ahead and want harder problems, or if you just
				want to talk about math for a while.
			</>,
		],
		[
			"Your own time",
			<>
				<b>The problem set.</b> This is really the point of the experience. You
				write down your ideas, write up (!) your solutions, and turn it in each
				week; your mentor and course assistants respond with comments on your
				math and on your writing. It is such a wonderful thing to get feedback
				on your work and on your writing.
			</>,
		],
		[
			"Everything else",
			<>
				<b>The community.</b> A Discord server connects students across all the
				courses, and we run some program-wide things during the term: guest
				talks, a panel on college and math careers, student showcases, a few
				games.
			</>,
		],
	];
	return (
		<section id="week" className="pt-14">
			<SectionHead n={2}>A week at ℝℙ²</SectionHead>
			<p>
				Courses meet at a fixed weekly time, which we set once we know when
				admitted students are actually available.
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
				So: three live hours a week, plus however long you give the problem set.
				The students who give the problems plenty of time are the ones who get
				the most out of the experience.
			</p>
			<EndMark />
		</section>
	);
}

function WhoShouldApply() {
	return (
		<section id="who" className="pt-14">
			<SectionHead n={3}>Who should apply</SectionHead>
			<p>
				High-school students, anywhere in the world, who want to dig into some
				math. <b>You do not need to have written proofs before.</b> Some Ross
				participants arrive with a lot of competition experience or a previous
				proof course; others write their first proofs with us.
			</p>
			<p className="mt-4">
				The thing we actually look for is whether you like being stuck &mdash;
				whether you&rsquo;ll sit with a problem for a really long time. If you
				have ever been unable to put a math problem down even while you were
				stuck, please apply.
			</p>
			<Note label="Relationship to the residential program">
				ℝℙ² is a separate activity from the residential, in-person summer
				program, which remains our flagship experience. Doing the online program
				is not required for residential admission and doesn&rsquo;t guarantee it
				&mdash; but we want to bring this sort of experience to more people, and
				ℝℙ² is our way to keep Ross going during the academic year.
			</Note>
			<EndMark />
		</section>
	);
}

function Admissions() {
	const items: [string, React.ReactNode][] = [
		[
			"Now → August 14",
			<>
				Applications open. Apply by <b>August 14</b> for priority consideration.
			</>,
		],
		[
			"Week of August 21",
			<>
				First-round offers go out, with your course placement, meeting time, and
				financial-aid decision.
			</>,
		],
		[
			"September",
			<>
				Families confirm enrollment; students get added to the course page,
				Discord, and Gradescope. If seats remain, we go to the waitlist and late
				applicants.
			</>,
		],
		[
			"September 28",
			<>
				Classes start. Ten weeks of instruction, one week off at Thanksgiving,
				done December 11.
			</>,
		],
	];
	return (
		<section id="admissions" className="pt-14 scroll-mt-24">
			<SectionHead n={4}>Admissions &amp; dates</SectionHead>
			<p>
				The application is short &mdash; we know you are busy. We ask for basic
				information, a transcript, your weekly availability, your course
				preferences, and a few short written answers about how you think about
				math: what you do when you&rsquo;re stuck, how you work with other
				people. There is no entrance exam. (Those are difficult, anyway, in the
				age of AI.)
			</p>
			<p className="mt-4">
				We read what you write, and we use the whole pool of applications to
				decide which courses to run and when sections meet. That&rsquo;s why the
				priority deadline matters: applying early lets us schedule sections
				around <i>you</i>.
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
			<EndMark />
		</section>
	);
}

function Tuition() {
	return (
		<section id="tuition" className="pt-14 pb-14 scroll-mt-24">
			<SectionHead n={5}>Tuition &amp; financial aid</SectionHead>
			<p>
				Tuition for the ten-week term is <b>$1,500</b>. That covers our costs:
				instruction, materials, feedback, and community programming.
			</p>
			<p className="mt-4">
				If the cost is a problem, apply anyway. We have need-based aid &mdash;{" "}
				<b>up to and including full scholarships</b> &mdash; and admissions are{" "}
				<b>need-blind</b>, so asking for aid has no effect on whether you get
				in. There is a simple aid request built into the application. Parents
				and guardians are welcome to email us with questions before applying.
			</p>
			<EndMark />
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
				</div>
				{!signedIn && (
					<p className="mt-4 text-sm text-muted">
						Parent or guardian?{" "}
						<Link
							to="/auth/request"
							search={{ role: "guardian" }}
							className="text-ink underline underline-offset-2 hover:no-underline"
						>
							Register here →
						</Link>
					</p>
				)}
				<p className="mt-8 text-sm text-muted">
					Questions? Write to us at{" "}
					<a
						href="mailto:ross@rossprogram.org"
						className="font-mono text-ink no-underline hover:underline"
					>
						ross@rossprogram.org
					</a>
					.
				</p>
			</div>
		</div>
	);
}

export const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: IndexPage,
});
