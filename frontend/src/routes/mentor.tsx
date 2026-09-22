import { createRoute, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './root';
import {
  fetchMe,
  fetchMentorView,
  type MentorSection,
  type MentorStudent,
} from '../api/client';

/*
 * A roster is a data table, not prose. The shared Prose container is sized to
 * a reading measure, which clipped the Discord column off the side of the
 * page — the one column a mentor most needs this week.
 */
function Wide({ children }: { children: React.ReactNode }) {
  return <div className="max-w-5xl mx-auto px-6 py-12">{children}</div>;
}

/*
 * What a mentor sees: their sections, when they next meet, and who is in them.
 *
 * Before term this is a readiness list — who has not signed, who is not in
 * Discord — because that is what a mentor can actually act on in the week
 * before classes. Attendance joins it once sessions start producing data.
 */

async function ensureStaff() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  const staff = ['mentor', 'assistant', 'admin'].some((r) => me.roles.includes(r));
  // Three of the course assistants also hold `applicant` from an abandoned
  // application of their own, so this checks for staff rather than against
  // anything else.
  if (!staff) throw redirect({ to: '/' });
}

function studentName(s: MentorStudent): string {
  if (s.preferredName && s.legalName && s.preferredName.toLowerCase() !== s.legalName.toLowerCase()) {
    return `${s.preferredName} (${s.legalName})`;
  }
  return s.legalName ?? s.preferredName ?? '(no name)';
}

function whenNext(startsAt: number): string {
  try {
    return new Date(startsAt * 1000).toLocaleString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function SectionBlock({ section }: { section: MentorSection }) {
  const outstanding = section.students.filter((s) => !s.fullySigned).length;
  const notInDiscord = section.students.filter((s) => s.discord !== 'joined').length;

  return (
    <section className="mb-14">
      <div className="rule-b pb-3 mb-4">
        <h2 className="font-serif text-2xl">
          {section.courseLabel ?? section.courseKey}{' '}
          <span className="text-muted">· {section.label}</span>
        </h2>
        <p className="text-sm text-muted mt-1">
          {section.schedule
            .filter((s) => s.when)
            .map((s) => `${s.kind === 'problem_session' ? 'Problem session' : 'Office hours'}: ${s.when}`)
            .join('  ·  ') || 'No schedule recorded'}
        </p>
        {section.nextSession ? (
          <p className="text-sm text-ink mt-1">
            Next:{' '}
            {section.nextSession.kind === 'problem_session' ? 'problem session' : 'office hours'},{' '}
            {whenNext(section.nextSession.startsAt)}
          </p>
        ) : (
          <p className="text-sm text-muted mt-1 italic">No upcoming sessions scheduled.</p>
        )}
      </div>

      {/* The two things a mentor can act on this week. */}
      <p className="text-sm mb-4">
        <span className="text-ink">{section.students.length} students</span>
        {outstanding > 0 ? (
          <span className="text-accent"> · {outstanding} not fully signed</span>
        ) : (
          <span className="text-muted"> · all signed</span>
        )}
        {notInDiscord > 0 ? (
          <span className="text-accent"> · {notInDiscord} not in Discord</span>
        ) : (
          <span className="text-muted"> · all in Discord</span>
        )}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-rule">
            <tr className="text-left smallcaps text-muted">
              <th className="py-2 pr-4">Group</th>
              <th className="py-2 pr-4">Student</th>
              <th className="py-2 pr-4">Timezone</th>
              <th className="py-2 pr-4">Signed</th>
              <th className="py-2 pr-4">Discord</th>
            </tr>
          </thead>
          <tbody>
            {section.students.map((s) => (
              <tr key={s.applicationId} className="border-b border-rule/60 align-top">
                <td className="py-3 pr-4 tabular-nums text-muted">{s.cohort ?? '—'}</td>
                <td className="py-3 pr-4 min-w-[14rem]">
                  <div className="text-ink">{studentName(s)}</div>
                  {/* Whole addresses, not broken mid-word — a wrapped email is
                      unreadable and uncopyable. */}
                  <div className="text-xs text-muted">{s.email}</div>
                  {s.guardianEmail ? (
                    <div className="text-xs text-muted">{s.guardianEmail}</div>
                  ) : null}
                </td>
                <td className="py-3 pr-4 text-muted text-xs whitespace-nowrap">
                  {s.timezone ?? '—'}
                </td>
                <td className="py-3 pr-4 whitespace-nowrap">
                  {s.fullySigned ? (
                    <span className="text-muted">yes</span>
                  ) : (
                    <span className="text-accent">
                      {s.outstandingSignatures} outstanding
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 whitespace-nowrap">
                  {s.discord === 'joined' ? (
                    <span className="text-muted">in server</span>
                  ) : s.discord === 'linked' ? (
                    <span className="text-accent">linked, not joined</span>
                  ) : (
                    <span className="text-accent">not linked</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MentorPage() {
  const q = useQuery({ queryKey: ['mentor', 'me'], queryFn: fetchMentorView });

  if (q.isPending) {
    return (
      <Wide>
        <p className="text-muted italic">Loading…</p>
      </Wide>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Wide>
        <p className="text-error">Failed to load.</p>
      </Wide>
    );
  }

  const { viewingAs, sections } = q.data;

  if (sections.length === 0) {
    return (
      <Wide>
        <p className="smallcaps text-accent mb-6">Staff</p>
        <h1 className="font-serif text-4xl font-semibold mb-4">No sections yet.</h1>
        <p className="text-muted">
          You do not have a section assigned. If that seems wrong, email{' '}
          <a href="mailto:ross@rossprogram.org" className="font-mono">
            ross@rossprogram.org
          </a>
          .
        </p>
      </Wide>
    );
  }

  return (
    <Wide>
      <p className="smallcaps text-accent mb-6">Staff</p>
      <h1 className="font-serif text-4xl font-semibold mb-2">
        {sections.length === 1 ? 'Your section' : 'Your sections'}
      </h1>
      <p className="text-muted mb-10">
        {viewingAs === 'admin'
          ? 'You are an admin, so this shows every section in the program.'
          : 'The students in the sections you lead, and what they still owe before term.'}
      </p>

      {sections.map((s) => (
        <SectionBlock key={s.id} section={s} />
      ))}
    </Wide>
  );
}

export const mentorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mentor',
  beforeLoad: ensureStaff,
  component: MentorPage,
});
