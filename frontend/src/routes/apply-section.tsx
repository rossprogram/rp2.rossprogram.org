import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createRoute, Link, useParams, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { fetchMe, fetchApplication, listFiles } from '../api/client';
import { SectionHeading } from '../components/Layout';
import { SavedIndicator } from '../features/applicant/SavedIndicator';
import { SectionNav, nextSectionSlug } from '../features/applicant/SectionNav';
import { Field, RequiredMark } from '../features/applicant/Field';
import { useApplication, useSaveResponses } from '../features/applicant/useApplication';
import { sectionBySlug, questionsInSection } from '@rp2/shared';

async function ensureAuthAndSection({
  context,
  params,
}: {
  context: { queryClient: import('@tanstack/react-query').QueryClient };
  params: { section: string };
}) {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  const section = sectionBySlug(params.section);
  if (!section) throw redirect({ to: '/apply' });
  const app = await context.queryClient.ensureQueryData({
    queryKey: ['application'],
    queryFn: fetchApplication,
  });
  if (app.status !== 'draft' && app.status !== 'awaiting_guardian') {
    throw redirect({ to: '/status' });
  }
}

function SectionPage() {
  const { section: slug } = useParams({ from: applySectionRoute.id });
  const q = useApplication();
  const filesQuery = useQuery({
    queryKey: ['files'],
    queryFn: async () => (await listFiles()).files,
  });
  const save = useSaveResponses();

  const section = useMemo(() => sectionBySlug(slug)!, [slug]);
  const questions = useMemo(() => questionsInSection(section.key), [section.key]);

  const responses = q.data?.responses ?? {};
  const files = filesQuery.data ?? [];
  const locked =
    q.data?.status !== undefined &&
    q.data.status !== 'draft' &&
    q.data.status !== 'awaiting_guardian';
  const next = nextSectionSlug(section.key);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-10">
      <aside className="md:sticky md:top-6 md:self-start">
        <div className="mb-6">
          <p className="smallcaps text-accent mb-2">Application</p>
          <SavedIndicator
            updatedAt={q.data?.updatedAt ?? null}
            saving={save.isPending}
          />
        </div>
        <SectionNav
          responses={responses}
          files={files}
          currentSection={section.key}
        />
      </aside>

      <main>
        <SectionHeading number={section.index}>{section.title}</SectionHeading>
        <p className="text-muted italic text-sm mt-3">
          Fields marked <RequiredMark /> are required.
        </p>

        <div className="mt-8 prose-mm">
          {questions.map((question) => (
            <Field
              key={question.key}
              question={question}
              value={responses[question.key]}
              disabled={!!locked || save.isPending}
              onSave={(value) => save.mutate({ [question.key]: value })}
            />
          ))}
        </div>

        <hr />

        <div className="flex items-center justify-between">
          <Link to="/apply" className="btn btn-ghost no-underline">
            Save and exit
          </Link>
          {next ? (
            <Link
              to="/apply/$section"
              params={{ section: next }}
              className="btn btn-primary no-underline"
              onClick={() => {
                // ensure current field focus commits a blur-based save
                (document.activeElement as HTMLElement | null)?.blur?.();
              }}
            >
              Save and continue →
            </Link>
          ) : (
            <Link to="/apply" className="btn btn-primary no-underline">
              Review before submitting
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}

export const applySectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/apply/$section',
  beforeLoad: ensureAuthAndSection,
  component: SectionPage,
});
