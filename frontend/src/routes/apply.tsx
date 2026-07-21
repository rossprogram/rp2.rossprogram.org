import { createRoute, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './root';
import { Prose, SectionHeading } from '../components/Layout';
import { fetchMe, api } from '../api/client';

async function ensureAuth() {
  const me = await fetchMe();
  if (!me) {
    throw redirect({ to: '/auth/request' });
  }
  return me;
}

function ApplyPage() {
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
  });

  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Application</p>
      <h1 className="mb-4">Welcome{me?.email ? `, ${me.email}` : ''}.</h1>
      <p className="text-lg text-muted">
        Your application is a draft. You can save your work and return at any
        time before submitting.
      </p>

      <div className="mt-12 space-y-8">
        <PlaceholderSection n={1}>Student information</PlaceholderSection>
        <PlaceholderSection n={2}>Parent / guardian information</PlaceholderSection>
        <PlaceholderSection n={3}>Mathematical background</PlaceholderSection>
        <PlaceholderSection n={4}>Mathematical reflections</PlaceholderSection>
        <PlaceholderSection n={5}>Financial aid</PlaceholderSection>
        <PlaceholderSection n={6}>Signatures</PlaceholderSection>
      </div>

      <hr />
      <div className="flex items-center justify-between text-muted">
        <span className="italic">Signed in as {me?.email}</span>
        <button
          className="btn btn-ghost"
          onClick={async () => {
            await api.post('/api/auth/logout');
            window.location.assign('/');
          }}
        >
          Sign out
        </button>
      </div>
    </Prose>
  );
}

function PlaceholderSection({
  n,
  children,
}: {
  n: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rule-t pt-6">
      <SectionHeading number={n}>{children}</SectionHeading>
      <p className="text-muted italic mt-2">
        Coming next — the applicant form fields will render here.
      </p>
    </section>
  );
}

export const applyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/apply',
  beforeLoad: ensureAuth,
  component: ApplyPage,
});
