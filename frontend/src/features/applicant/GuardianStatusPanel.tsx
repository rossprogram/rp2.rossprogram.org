import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, resendGuardianInvite, type GuardianStatus } from '../../api/client';

type Props = {
  guardian: GuardianStatus | undefined;
  guardianName?: string | undefined;
};

export function GuardianStatusPanel({ guardian, guardianName }: Props) {
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => resendGuardianInvite(),
    onSuccess: () => {
      setError(null);
      setFlash('Invite sent.');
    },
    onError: (err) => {
      setFlash(null);
      if (err instanceof ApiError && err.status === 429) {
        setError('Please wait a bit before resending — we don’t want to spam your parent.');
      } else {
        setError('Could not send the invite. Please try again.');
      }
    },
  });

  if (!guardian || !guardian.hasLink || !guardian.guardianEmail) {
    return null;
  }

  const status = guardian.taskComplete
    ? 'complete'
    : guardian.acceptedAt
      ? 'in_progress'
      : 'not_started';
  const label =
    status === 'complete'
      ? 'Parent portal: complete'
      : status === 'in_progress'
        ? 'Parent portal: in progress'
        : 'Parent portal: not started';
  const dot =
    status === 'complete' ? 'bg-accent' : status === 'in_progress' ? 'bg-ink' : 'bg-muted';
  const displayName = guardianName?.trim() || guardian.guardianEmail;

  return (
    <aside className="rule-t rule-b py-4 my-6 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
      <span className="inline-flex items-baseline gap-2">
        <span
          aria-hidden
          className={`inline-block w-2 h-2 rounded-full self-center ${dot}`}
        />
        <span className="smallcaps text-muted">{label}</span>
      </span>
      <span className="text-ink">
        We’ve emailed <em>{displayName}</em> at{' '}
        <span className="font-mono">{guardian.guardianEmail}</span>.
      </span>
      {status !== 'complete' && (
        <button
          type="button"
          className="text-accent hover:underline text-sm"
          disabled={mut.isPending}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? 'Sending…' : 'Resend invite'}
        </button>
      )}
      {flash && <span className="text-muted italic">{flash}</span>}
      {error && <span className="text-accent">{error}</span>}
    </aside>
  );
}
