import { createRoute, Link, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import { fetchMe, fetchApplication } from '../api/client';

async function redirectIfAuthed({
  context,
}: {
  context: { queryClient: import('@tanstack/react-query').QueryClient };
}) {
  const me = await fetchMe();
  if (!me) return;
  const app = await context.queryClient.ensureQueryData({
    queryKey: ['application'],
    queryFn: fetchApplication,
  });
  throw redirect({ to: app.status === 'draft' ? '/apply' : '/status' });
}

function IndexPage() {
  return (
    <Prose>
      <p className="smallcaps text-accent mb-8">ℝℙ² — Online Program</p>

      <h1 className="mb-6">
        A ten-week seminar in <em>proof-based</em> mathematics, online.
      </h1>

      <p className="text-lg text-ink/90">
        ℝℙ² is the online arm of the Ross Mathematics Program. Each
        course runs weekly from <em>September&nbsp;28</em> through{' '}
        <em>December&nbsp;11, 2026</em>, and centers on Ross-style problem sets
        and guided, synchronous problem solving.
      </p>

      <p>
        Applications for the inaugural term are open to high-school students who
        want to engage seriously with mathematics — regardless of prior
        proof-writing experience.
      </p>

      <div className="mt-10 flex items-center gap-4">
        <Link to="/auth/request" className="btn btn-primary no-underline">
          Begin your application
        </Link>
        <Link to="/auth/request" className="btn btn-ghost no-underline">
          Continue where you left off
        </Link>
      </div>

      <hr />

      <h2 className="mb-3">What to expect</h2>
      <ul className="list-none pl-0 space-y-3">
        <li className="pl-4 border-l border-rule">
          One <em>90-minute</em> live Zoom session and one 60-minute office hour
          each week, per course.
        </li>
        <li className="pl-4 border-l border-rule">
          Weekly Ross-style problem sets, reviewed with written feedback.
        </li>
        <li className="pl-4 border-l border-rule">
          A moderated Discord community, small breakout cohorts, and mentorship
          from graduate students.
        </li>
      </ul>

      <p className="text-muted italic mt-8">
        Tuition is approximately $1,500 for the ten-week term. Need-based
        financial aid — including full scholarships — is available. The
        application is need-blind.
      </p>
    </Prose>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: redirectIfAuthed,
  component: IndexPage,
});
