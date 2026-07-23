import { useState } from 'react';
import { createRoute, Link, redirect } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import {
  ApiError,
  fetchMe,
  fetchMyLinkedApplicants,
  inviteApplicantFromParent,
} from '../api/client';
import type { GuardianApplicantSummary } from '../api/client';

async function ensureGuardian() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request', search: { role: 'guardian' } });
  if (!me.roles.includes('guardian')) {
    // Signed in but not a guardian — nothing to show here. Send them home.
    throw redirect({ to: '/' });
  }
  return { me };
}

function ParentIndex() {
  const q = useQuery({
    queryKey: ['parent', 'me'],
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
        <EmptyState />
      ) : (
        <>
          <p className="text-muted mb-10 max-w-2xl">
            You&rsquo;re listed as the parent or guardian on the application
            {applicants.length > 1 ? 's' : ''} below. Open each student&rsquo;s
            page to sign consent and (if requested) upload supporting
            financial-aid documents.
          </p>

          <ol className="rule-t divide-y divide-rule">
            {applicants.map((a) => (
              <ApplicantCard key={a.applicationId} applicant={a} />
            ))}
          </ol>

          <div className="mt-12">
            <details className="border-t border-rule pt-6">
              <summary className="cursor-pointer smallcaps text-accent">
                Invite another student
              </summary>
              <div className="mt-6 max-w-md">
                <InviteForm />
              </div>
            </details>
          </div>
        </>
      )}
    </Prose>
  );
}

function EmptyState() {
  return (
    <div className="mt-4 max-w-2xl">
      <p className="mb-6">
        You&rsquo;re signed in. Now invite your student to start their
        ℝℙ² application — we&rsquo;ll email them a link to create their
        account and begin.
      </p>
      <InviteForm />
    </div>
  );
}

const InviteSchema = z.object({
  applicantEmail: z.string().email(),
  relationship: z.enum(['parent', 'guardian', 'other']),
});

function InviteForm() {
  const qc = useQueryClient();
  const [applicantEmail, setEmail] = useState('');
  const [relationship, setRelationship] = useState<'parent' | 'guardian' | 'other'>('parent');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: inviteApplicantFromParent,
    onSuccess: (_, vars) => {
      setSent(vars.applicantEmail);
      setEmail('');
      qc.invalidateQueries({ queryKey: ['parent', 'me'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { error?: string };
        if (body?.error === 'self_invite') {
          setError("That's your own email — enter your student's email address instead.");
        } else if (body?.error === 'email_is_guardian') {
          setError(
            'That email is already registered as a parent. Ask your student to use a different address for their application.',
          );
        } else if (body?.error === 'applicant_linked_elsewhere') {
          setError(
            'That student is already linked to a different parent. Write to us if this looks wrong.',
          );
        } else {
          setError('Could not send the invite. Please try again.');
        }
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Too many invites — try again in an hour.');
      } else {
        setError('Could not send the invite. Please try again.');
      }
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    const parsed = InviteSchema.safeParse({ applicantEmail, relationship });
    if (!parsed.success) {
      setError('Please enter a valid email address.');
      return;
    }
    mut.mutate(parsed.data);
  }

  return (
    <form onSubmit={onSubmit}>
      <label className="block">
        <span className="smallcaps text-muted">Student&rsquo;s email address</span>
        <input
          type="email"
          autoComplete="off"
          required
          value={applicantEmail}
          onChange={(e) => setEmail(e.target.value)}
          className="field-input mt-1"
          placeholder="student@example.com"
          disabled={mut.isPending}
        />
      </label>

      <fieldset className="mt-6">
        <legend className="smallcaps text-muted mb-1">
          Your relationship to the student
        </legend>
        {(['parent', 'guardian', 'other'] as const).map((r) => (
          <label key={r} className="flex items-baseline gap-3 py-1 cursor-pointer">
            <input
              type="radio"
              name="relationship"
              value={r}
              checked={relationship === r}
              onChange={() => setRelationship(r)}
              disabled={mut.isPending}
            />
            <span>
              {r === 'parent'
                ? 'Parent'
                : r === 'guardian'
                  ? 'Legal guardian'
                  : 'Other family member'}
            </span>
          </label>
        ))}
      </fieldset>

      {error && <p className="mt-4 text-accent">{error}</p>}
      {sent && (
        <p className="mt-4 text-ink">
          Sent an invitation to <em>{sent}</em>. The link expires in 15
          minutes; you can resend it by inviting the same email again.
        </p>
      )}

      <div className="mt-6">
        <button type="submit" className="btn btn-primary" disabled={mut.isPending}>
          {mut.isPending ? 'Sending…' : 'Send invitation'}
        </button>
      </div>
    </form>
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
        to="/parent/applicant/$appId"
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

export const parentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/parent',
  beforeLoad: ensureGuardian,
  component: ParentIndex,
});
