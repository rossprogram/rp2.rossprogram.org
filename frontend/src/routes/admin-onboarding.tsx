import { createRoute, Link, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import { fetchMe } from '../api/client';
import { OnboardingBoard } from '../features/admin/OnboardingBoard';
import { DiscordPanel } from '../features/admin/DiscordPanel';

/*
 * Getting the cohort ready for term: who still owes a signature, chasing
 * them, and putting the signed ones into Discord.
 */

async function ensureAdmin() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  if (!me.roles.includes('admin')) throw redirect({ to: '/' });
}

function AdminOnboardingPage() {
  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Admin</p>
      <h1 className="mb-2">Onboarding</h1>
      <p className="text-muted mb-10">
        A student takes part once they are enrolled <em>and</em> both they and
        their guardian have signed the Code of Conduct and the Participation
        Agreement.{' '}
        <Link to="/admin" className="text-ink">
          Applications
        </Link>
        {' · '}
        <Link to="/admin/offers" className="text-ink">
          Offers &amp; import
        </Link>
      </p>

      <h2 className="font-serif text-2xl mb-4">Signatures</h2>
      <OnboardingBoard />

      <h2 className="font-serif text-2xl mt-16 mb-4">Discord</h2>
      <DiscordPanel />
    </Prose>
  );
}

export const adminOnboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/onboarding',
  beforeLoad: ensureAdmin,
  component: AdminOnboardingPage,
});
