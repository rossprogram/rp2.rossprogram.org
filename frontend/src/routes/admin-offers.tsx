import { createRoute, Link, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import { fetchMe } from '../api/client';
import { OfferImport } from '../features/admin/OfferImport';

async function ensureAdmin() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  if (!me.roles.includes('admin')) throw redirect({ to: '/' });
}

function AdminOffersPage() {
  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Admin</p>
      <h1 className="mb-2">Offers</h1>
      <p className="text-muted mb-8">
        Set decisions, course placement, and financial aid in a spreadsheet,
        then publish it here.{' '}
        <Link to="/admin" className="text-ink">
          Back to applications
        </Link>
      </p>
      <OfferImport />
    </Prose>
  );
}

export const adminOffersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/offers',
  beforeLoad: ensureAdmin,
  component: AdminOffersPage,
});
