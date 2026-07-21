import { createRoute, Link, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import { fetchMe, fetchMyLinkedApplicants } from '../api/client';
import type { GuardianApplicantSummary } from '../api/client';

async function ensureGuardian() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  if (!me.roles.includes('guardian')) {
    // Signed in but not a guardian — nothing to show here. Send them home.
    throw redirect({ to: '/' });
  }
  return { me };
}

function GuardianIndex() {
  const q = useQuery({
    queryKey: ['guardian', 'me'],
    queryFn: fetchMyLinkedApplicants,
  });

  const applicants = q.data?.applicants ?? [];
  const label =
    applicants.length === 0
      ? 'Parent portal'
      : applicants.length === 1
        ? 'Your student'
        : `Your ${applicants.length} students`;

  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Parent portal</p>
      <h1 className="mb-4">{label}</h1>

      {applicants.length === 0 ? (
        <div className="mt-8">
          <p className="text-muted mb-6">
            No applicants are currently linked to this email. When a student
            adds you as their parent or guardian on their application, they
            will appear here.
          </p>
          <Link to="/" className="btn btn-ghost no-underline">
            Back to the program page
          </Link>
        </div>
      ) : (
        <>
          <p className="text-muted mb-10 max-w-2xl">
            You&rsquo;ve been listed as the parent or guardian on the
            application{applicants.length > 1 ? 's' : ''} below. Open each
            student&rsquo;s page to sign consent and (if requested) upload
            supporting financial-aid documents.
          </p>

          <ol className="rule-t divide-y divide-rule">
            {applicants.map((a) => (
              <ApplicantCard key={a.applicationId} applicant={a} />
            ))}
          </ol>
        </>
      )}
    </Prose>
  );
}

function ApplicantCard({ applicant }: { applicant: GuardianApplicantSummary }) {
  const displayName = applicant.applicantName || applicant.applicantEmail;
  const statusText = applicant.taskComplete
    ? 'Complete'
    : applicant.guardianSignature
      ? 'In progress'
      : 'Not started';
  const statusColor = applicant.taskComplete
    ? 'text-accent'
    : applicant.guardianSignature
      ? 'text-ink'
      : 'text-muted';
  return (
    <li className="py-5">
      <Link
        to="/guardian/applicant/$appId"
        params={{ appId: applicant.applicationId }}
        className="flex items-baseline gap-4 no-underline hover:no-underline group"
      >
        <span className="flex-1">
          <span className="text-ink group-hover:underline underline-offset-4">
            {displayName}
          </span>
          <span className={`block text-sm italic ${statusColor}`}>
            {statusText}
          </span>
        </span>
        <span className="text-muted smallcaps">Open →</span>
      </Link>
    </li>
  );
}

export const guardianRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/guardian',
  beforeLoad: ensureGuardian,
  component: GuardianIndex,
});
