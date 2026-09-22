import { useState } from 'react';
import { createRoute, redirect, useSearch } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import {
  ApiError,
  fetchAgreements,
  fetchMe,
  resendGuardianInvite,
  signAgreement,
  type SignPayload,
} from '../api/client';
import { AgreementPanel } from '../features/agreements/AgreementPanel';

/*
 * The student's side of getting ready for term: sign both documents, see what
 * their guardian still owes, and — once enrolled and fully signed — link
 * Discord.
 */

const Search = z.object({
  /** Set by the Discord OAuth callback on its way back. */
  discord: z
    .enum(['joined', 'taken', 'failed', 'state', 'not_cleared', 'error'])
    .optional(),
});

async function ensureAuth() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  return { me };
}

const DISCORD_MESSAGES: Record<string, string> = {
  joined: 'You are in — check Discord.',
  taken: 'That Discord account is already linked to another student.',
  failed: 'Discord did not complete the sign-in. Please try again.',
  state: 'That link expired. Please try again.',
  not_cleared: 'Both signatures need to be in before you can join Discord.',
  error: 'Something went wrong talking to Discord. Please try again.',
};

function AgreementsPage() {
  const qc = useQueryClient();
  const search = useSearch({ from: agreementsRoute.id });
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const q = useQuery({ queryKey: ['agreements'], queryFn: fetchAgreements });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingDoc, setPendingDoc] = useState<string | null>(null);
  const [resend, setResend] = useState<'idle' | 'pending' | 'sent'>('idle');

  const sign = useMutation({
    mutationFn: ({ document, payload }: { document: string; payload: SignPayload }) =>
      signAgreement(document, payload),
    onMutate: ({ document }) => {
      setPendingDoc(document);
      setErrors((e) => ({ ...e, [document]: '' }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agreements'] });
      void qc.invalidateQueries({ queryKey: ['application'] });
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

  const nudge = useMutation({
    mutationFn: resendGuardianInvite,
    onMutate: () => setResend('pending'),
    onSuccess: () => setResend('sent'),
    onError: () => setResend('idle'),
  });

  if (q.isPending) {
    return (
      <Prose>
        <p className="text-muted italic">Loading…</p>
      </Prose>
    );
  }

  if (q.isError || !q.data) {
    return (
      <Prose>
        <h1 className="mb-4">Nothing to sign yet.</h1>
        <p className="text-muted">
          These documents appear once you have an application with us.
        </p>
      </Prose>
    );
  }

  const env = q.data;
  const discord = env.discord;
  const notice = search.discord ? DISCORD_MESSAGES[search.discord] : null;

  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Before classes begin</p>
      <h1 className="mb-4">Program agreements</h1>
      <p className="text-muted mb-8">
        Every family signs the Code of Conduct and the Program Participation
        Agreement before term starts on September 27. Both the participant and
        a parent or guardian sign each one.
      </p>

      {notice ? (
        <p
          className={`mb-6 text-sm ${search.discord === 'joined' ? 'text-ink' : 'text-accent'}`}
        >
          {notice}
        </p>
      ) : null}

      <AgreementPanel
        env={env}
        defaultEmail={me.data?.email ?? ''}
        pendingDocument={pendingDoc}
        errorFor={(doc) => errors[doc] || null}
        onSign={(document, payload) => sign.mutate({ document, payload })}
        onResendGuardian={env.theirs.length > 0 ? () => nudge.mutate() : undefined}
        resendState={resend}
        footer={
          <div className="mt-10">
            {!env.fullySigned ? null : !env.enrolled ? (
              <p className="text-muted">
                Thank you. Discord opens up once your enrollment is complete.
              </p>
            ) : discord?.enabled !== true ? (
              <p className="text-muted">
                Thank you — you are all set. We will email you about Discord,
                Zoom, and Gradescope before classes begin.
              </p>
            ) : discord.linked ? (
              <div>
                <h2 className="font-serif text-2xl mb-2">Discord</h2>
                <p className="text-muted">
                  Linked{discord.username ? ` as ${discord.username}` : ''}. You
                  have been added to the program server with your course and
                  group.
                </p>
              </div>
            ) : (
              <div>
                <h2 className="font-serif text-2xl mb-2">Join the Discord server</h2>
                <p className="text-muted mb-4">
                  We will add you to the server directly and set your name and
                  course so staff and classmates know who you are. There is no
                  invite link to share.
                </p>
                {/* A plain link, not fetch(): this is an OAuth redirect. */}
                <a href="/api/discord/link" className="btn btn-primary no-underline">
                  Link my Discord account →
                </a>
              </div>
            )}
          </div>
        }
      />
    </Prose>
  );
}

export const agreementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agreements',
  validateSearch: Search,
  beforeLoad: ensureAuth,
  component: AgreementsPage,
});
