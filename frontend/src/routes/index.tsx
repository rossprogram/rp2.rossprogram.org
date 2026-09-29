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
				<WhoItsFor />
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
			<div className="max-w-3xl mx-auto px-6 py-16 md:py-24">
				<p className="smallcaps text-accent mb-6">
					The Ross Mathematics Program · Online · Fall 2026
				</p>
				<h1 className="font-serif font-bold text-[clamp(4rem,10vw,6.5rem)] leading-none tracking-tight">
					ℝℙ²
				</h1>
				<p className="mt-6 text-[clamp(1.15rem,2.4vw,1.4rem)] leading-snug max-w-[32ch]">
					A ten-week experience of proof-based mathematics for high-school
					students. Our first term is underway: September 27 through December
					12, 2026, with a break for US Thanksgiving.
				</p>
				<div className="mt-8 max-w-[44ch] pl-5 py-4 pr-5 bg-accent-soft border-l-2 border-accent">
					<span className="smallcaps text-accent block mb-1">
						Applications are closed
					</span>
					We&rsquo;re not accepting new applications right now. We expect to
					open another round of applications in the future.
				</div>
				<div className="mt-8 flex flex-wrap gap-4">
					<AccountLink signedIn={signedIn} />
					<Link to="/courses" className="btn btn-ghost no-underline">
						See the courses
					</Link>
				</div>
			</div>
		</section>
	);
}

// Families already in the program still sign in from here; there is just no
// "start an application" while applications are closed.
function AccountLink({ signedIn }: { signedIn: boolean }) {
	return signedIn ? (
		<Link to="/apply" className="btn btn-primary no-underline">
			Go to my account →
		</Link>
	) : (
		<Link to="/auth/request" className="btn btn-primary no-underline">
			Sign in
		</Link>
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
				Each course meets at a fixed weekly time, which we set once we knew
				when admitted students were actually available.
			</p>
			<div className="mt-6 border-t border-rule">
				{rows.map(([when, what], i) => (
					<div
						key={i}
						className="grid gap-x-5 gap-y-1 md:grid-cols-[11rem_1fr] py-4 border-b border-rule"
					>
						<div className="font-sans text-sm text-accent pt-1">{when}</div>
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

function WhoItsFor() {
	return (
		<section id="who" className="pt-14">
			<SectionHead n={3}>Who it&rsquo;s for</SectionHead>
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
				stuck, we hope you&rsquo;ll apply when applications open again.
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
			"August 21",
			<>
				Priority application deadline. Late applications were reviewed on a
				rolling basis while seats remained.
			</>,
		],
		[
			"September",
			<>
				Offers went out with course placement, meeting time, and financial-aid
				decision, and families confirmed enrollment.
			</>,
		],
		[
			"September 27",
			<>
				Classes started. We&rsquo;re in the middle of our first term now.
			</>,
		],
		[
			"December 12",
			<>
				The term ends, after ten weeks of instruction and one week off at
				Thanksgiving.
			</>,
		],
		[
			"In the future",
			<>
				We expect to open another round of applications. Check back here, or
				write to us and we&rsquo;ll let you know when it opens.
			</>,
		],
	];
	return (
		<section id="admissions" className="pt-14 scroll-mt-24">
			<SectionHead n={4}>Admissions &amp; dates</SectionHead>
			<p>
				<b>Applications are closed right now.</b> Our first cohort is in the
				middle of the term, and we aren&rsquo;t taking new applications for
				it.
			</p>
			<p className="mt-4">
				When applications open again, the application will be short &mdash; we
				know you are busy. We ask for basic information, a transcript, your
				weekly availability, your course preferences, and a few short written
				answers about how you think about math: what you do when you&rsquo;re
				stuck, how you work with other people. There is no entrance exam.
				(Those are difficult, anyway, in the age of AI.) We read what you
				write, and we use the whole pool of applications to decide which
				courses to run and when sections meet.
			</p>
			<ol className="mt-6 border-l-2 border-rule pl-6 space-y-6">
				{items.map(([d, t], i) => (
					<li key={i} className="relative">
						<span
							aria-hidden
							className="absolute -left-[calc(1.5rem+5px)] top-2 w-[9px] h-[9px] rounded-full bg-accent"
						/>
						<div className="font-sans text-sm text-accent">{d}</div>
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
				and guardians are welcome to email us with questions anytime.
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
					Our first term is underway, and applications are closed.
					<br />
					We expect to open another round of applications in the future.
				</p>
				<div className="mt-6 flex justify-center flex-wrap gap-4">
					<AccountLink signedIn={signedIn} />
				</div>
				<p className="mt-8 text-sm text-muted">
					Questions, or want to hear when applications reopen? Write to us at{" "}
					<a
						href="mailto:ross@rossprogram.org"
						className="font-sans text-ink no-underline hover:underline"
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
