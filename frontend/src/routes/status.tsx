import { createRoute, Link, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import { fetchMe, fetchApplication } from '../api/client';
import { useApplication } from '../features/applicant/useApplication';

async function ensureAuth({
  context,
}: {
  context: { queryClient: import('@tanstack/react-query').QueryClient };
}) {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  await context.queryClient.ensureQueryData({
    queryKey: ['application'],
    queryFn: fetchApplication,
  });
}

function StatusPage() {
  const q = useApplication();
  const app = q.data;
  const status = app?.status ?? 'draft';

  if (status === 'draft') {
    return (
      <Prose>
        <p className="smallcaps text-accent mb-6">Application status</p>
        <h1 className="mb-4">Your application is still a draft.</h1>
        <p className="text-muted mb-8">
          Nothing has been submitted yet. Return to your application to keep
          working — everything is autosaved.
        </p>
        <Link to="/apply" className="btn btn-primary no-underline">
          Continue your application →
        </Link>
      </Prose>
    );
  }

  if (status === 'awaiting_guardian') {
    const guardianEmail = app?.guardian?.guardianEmail ?? null;
    return (
      <Prose>
        <p className="smallcaps text-accent mb-6">Application status</p>
        <h1 className="mb-4">Your part is in.</h1>
        <p className="text-lg text-ink/90 mb-6">
          We&rsquo;ve emailed{' '}
          {guardianEmail ? (
            <em>{guardianEmail}</em>
          ) : (
            <em>your parent or guardian</em>
          )}{' '}
          to sign consent and (if you requested aid) upload supporting
          documentation. Once they complete their part, your application will
          move into review.
        </p>
        <p className="text-muted italic mb-10">
          You will receive an email when there is any update.
        </p>
        <Link to="/apply" className="btn btn-ghost no-underline">
          Review my responses
        </Link>
      </Prose>
    );
  }

  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Application status</p>
      <h1 className="mb-4">
        {status === 'submitted' || status === 'under_review'
          ? 'Your application is in.'
          : status === 'accepted'
            ? 'You are in.'
            : status === 'waitlisted'
              ? 'You are on the waitlist.'
              : status === 'rejected'
                ? 'A decision has been made.'
                : 'Your application has been withdrawn.'}
      </h1>

      <p className="text-lg text-ink/90 mb-6">
        <StatusLine status={status} submittedAt={app?.submittedAt ?? null} />
      </p>

      <p className="text-muted mb-10 italic">
        You will receive an email at{' '}
        <em>the address associated with your account</em> when there is any
        update to your application.
      </p>

      <div className="flex items-center gap-4">
        <Link to="/apply" className="btn btn-ghost no-underline">
          Review my responses
        </Link>
      </div>
    </Prose>
  );
}

function StatusLine({
  status,
  submittedAt,
}: {
  status: string;
  submittedAt: number | null;
}) {
  const submitted = submittedAt
    ? new Date(submittedAt * 1000).toLocaleString(undefined, {
        dateStyle: 'long',
        timeStyle: 'short',
      })
    : null;
  switch (status) {
    case 'submitted':
    case 'under_review':
      return (
        <>
          We received your application
          {submitted ? (
            <>
              {' '}
              on <em>{submitted}</em>
            </>
          ) : null}{' '}
          and it is now with the review team. Decisions will go out in the round
          following the priority deadline.
        </>
      );
    case 'accepted':
      return (
        <>Welcome to the program. Your offer letter and next steps are on the way.</>
      );
    case 'waitlisted':
      return <>You are on the waitlist. If space opens, we will be in touch.</>;
    case 'rejected':
      return (
        <>
          Thank you for applying. We were not able to offer you a spot this term.
        </>
      );
    case 'withdrawn':
      return <>Your application has been withdrawn at your request.</>;
    default:
      return null;
  }
}

export const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/status',
  beforeLoad: ensureAuth,
  component: StatusPage,
});
