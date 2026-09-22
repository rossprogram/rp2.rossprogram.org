import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  fetchGuardianAgreements,
  fetchMe,
  signGuardianAgreement,
  type SignPayload,
} from '../../api/client';
import { AgreementPanel } from './AgreementPanel';

/*
 * The guardian's half of the program agreements, mounted inside the parent
 * portal. Renders nothing until there is an offer to sign against — an
 * applicant still waiting on a decision has nothing to agree to yet.
 */
export function GuardianAgreements({ appId }: { appId: string }) {
  const qc = useQueryClient();
  // The contact block prefills from the signed-in guardian's own address.
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const q = useQuery({
    queryKey: ['parent', 'agreements', appId],
    queryFn: () => fetchGuardianAgreements(appId),
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDoc, setPendingDoc] = useState<string | null>(null);

  const sign = useMutation({
    mutationFn: ({ document, payload }: { document: string; payload: SignPayload }) =>
      signGuardianAgreement(appId, document, payload),
    onMutate: ({ document }) => {
      setPendingDoc(document);
      setErrors((e) => ({ ...e, [document]: '' }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['parent', 'agreements', appId] });
      void qc.invalidateQueries({ queryKey: ['parent', 'applicant', appId] });
    },
    onError: (err, { document }) => {
      const message =
        err instanceof ApiError && err.body && typeof err.body === 'object'
          ? ((err.body as { message?: string }).message ?? 'That did not save.')
          : 'That did not save.';
      setErrors((e) => ({ ...e, [document]: message }));
    },
    onSettled: () => setPendingDoc(null),
  });

  if (q.isPending || q.isError || !q.data) return null;
  const env = q.data;
  // Nothing to sign until the student has an offer in hand.
  if (!env.enrolled && env.signatures.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="font-serif text-2xl mb-2">Program agreements</h2>
      <p className="text-muted mb-6">
        Both you and {env.studentName ?? 'your student'} sign the Code of
        Conduct and the Program Participation Agreement before classes begin on
        September 27.
      </p>
      <AgreementPanel
        env={env}
        defaultEmail={me.data?.email ?? ''}
        pendingDocument={pendingDoc}
        errorFor={(doc) => errors[doc] || null}
        onSign={(document, payload) => sign.mutate({ document, payload })}
      />
    </section>
  );
}
