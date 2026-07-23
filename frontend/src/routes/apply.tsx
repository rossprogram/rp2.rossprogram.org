import { useQuery } from '@tanstack/react-query';
import { createRoute, Link, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import { fetchMe, fetchApplication, listFiles } from '../api/client';
import { useApplication } from '../features/applicant/useApplication';
import { SavedIndicator } from '../features/applicant/SavedIndicator';
import { SECTIONS } from '@rp2/shared';
import {
  sectionProgress,
  firstIncompleteSlug,
  allRenderableRequiredComplete,
} from '../features/applicant/SectionNav';
import { useSubmitApplication } from '../features/applicant/useApplication';
import { GuardianStatusPanel } from '../features/applicant/GuardianStatusPanel';

async function ensureAuthAndPreload({
  context,
}: {
  context: { queryClient: import('@tanstack/react-query').QueryClient };
}) {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  if (me.roles.includes('guardian') && !me.roles.includes('applicant')) {
    throw redirect({ to: '/parent' });
  }
  const app = await context.queryClient.ensureQueryData({
    queryKey: ['application'],
    queryFn: fetchApplication,
  });
  if (app.status !== 'draft' && app.status !== 'awaiting_guardian') {
    throw redirect({ to: '/status' });
  }
  return { me };
}

function ApplyIndex() {
  const q = useApplication();
  const filesQuery = useQuery({
    queryKey: ['files'],
    queryFn: async () => (await listFiles()).files,
  });
  const submit = useSubmitApplication();
  const responses = q.data?.responses ?? {};
  const files = filesQuery.data ?? [];

  const canSubmit =
    q.data?.status === 'draft' && allRenderableRequiredComplete(responses, files);

  return (
    <Prose>
      <div className="flex items-baseline justify-between mb-2">
        <p className="smallcaps text-accent">Application · Draft</p>
        <SavedIndicator
          updatedAt={q.data?.updatedAt ?? null}
          saving={submit.isPending}
        />
      </div>
      <h1 className="mb-4">Your application</h1>
      <p className="text-muted mb-6">
        Save your work at any time — everything you type autosaves. You can return
        to any section in any order before submitting.
      </p>

      <GuardianStatusPanel
        guardian={q.data?.guardian}
        guardianName={
          typeof responses['guardian_name'] === 'string'
            ? (responses['guardian_name'] as string)
            : undefined
        }
      />

      <ol className="rule-t divide-y divide-rule">
        {SECTIONS.map((s) => {
          const progress = sectionProgress(s.key, responses, files);
          return (
            <li key={s.key} className="py-5">
              <Link
                to="/apply/$section"
                params={{ section: s.slug }}
                className="flex items-baseline gap-4 no-underline hover:no-underline group"
              >
                <span className="text-accent font-serif italic tabular-nums w-8">
                  §{s.index}
                </span>
                <span className="flex-1">
                  <span className="text-ink group-hover:underline underline-offset-4">
                    {s.title}
                  </span>
                  <ProgressText state={progress} />
                </span>
                <span className="text-muted smallcaps">Open →</span>
              </Link>
            </li>
          );
        })}
      </ol>

      <hr />

      <div className="flex items-center justify-between">
        <Link
          to="/apply/$section"
          params={{ section: firstIncompleteSlug(responses, files) }}
          className="btn btn-primary no-underline"
        >
          Continue where I left off
        </Link>
        <button
          className="btn btn-ghost"
          disabled={!canSubmit || submit.isPending}
          onClick={() => submit.mutate()}
          title={
            canSubmit
              ? undefined
              : 'Complete every required question in every section before you can submit.'
          }
        >
          {submit.isPending ? 'Submitting…' : 'Submit application'}
        </button>
      </div>

    </Prose>
  );
}

function ProgressText({
  state,
}: {
  state: ReturnType<typeof sectionProgress>;
}) {
  const label =
    state === 'complete'
      ? 'Complete'
      : state === 'partial'
        ? 'In progress'
        : 'Not started';
  const color =
    state === 'complete'
      ? 'text-accent'
      : state === 'partial'
        ? 'text-ink'
        : 'text-muted';
  return <span className={`block text-sm italic ${color}`}>{label}</span>;
}

export const applyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/apply',
  beforeLoad: ensureAuthAndPreload,
  component: ApplyIndex,
});
