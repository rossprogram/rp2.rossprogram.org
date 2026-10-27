import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SurveyAnswers } from '@rp2/shared';
import { Prose } from '../../components/Layout';
import { ApiError, type SurveyEnvelope } from '../../api/client';
import { SurveyForm } from './SurveyForm';

/*
 * The body of both survey pages. The student's and the guardian's differ only
 * in which endpoints they call and who the questions are about.
 */
export function SurveyPage({
  queryKey,
  fetch,
  submit,
  back,
}: {
  queryKey: readonly unknown[];
  fetch: () => Promise<SurveyEnvelope>;
  submit: (answers: SurveyAnswers) => Promise<SurveyEnvelope>;
  back?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey, queryFn: fetch });
  const [justSent, setJustSent] = useState(false);

  const mut = useMutation({
    mutationFn: submit,
    onSuccess: (data) => {
      qc.setQueryData(queryKey, data);
      setJustSent(true);
      window.scrollTo({ top: 0 });
    },
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
        <h1 className="mb-4">We couldn&rsquo;t find a survey for you.</h1>
        <p className="text-muted">The survey is for enrolled ℝℙ² students and their families.</p>
        {back}
      </Prose>
    );
  }

  const env = q.data;
  if (!env.enrolled) {
    return (
      <Prose>
        <h1 className="mb-4">No survey right now.</h1>
        <p className="text-muted">The survey is for enrolled ℝℙ² students and their families.</p>
        {back}
      </Prose>
    );
  }

  const isGuardian = env.respondent === 'guardian';
  // Prefill the student's section from their offer; they can still change it.
  const initial: SurveyAnswers =
    env.answers ?? (!isGuardian && env.section ? { section: env.section } : {});

  const serverError =
    mut.error instanceof ApiError && mut.error.body && typeof mut.error.body === 'object'
      ? ((mut.error.body as { message?: string }).message ?? 'That did not save. Please try again.')
      : mut.isError
        ? 'That did not save. Please try again.'
        : null;

  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">{isGuardian ? 'Parent portal' : 'ℝℙ²'}</p>
      <h1 className="mb-2">{env.survey.title}</h1>
      {isGuardian && env.studentName ? (
        <p className="text-muted mb-4">
          About <em>{env.studentName}</em>.
        </p>
      ) : null}

      {justSent || env.submittedAt ? (
        <div className="rule-t rule-b py-4 my-6">
          <p className="text-ink">
            {justSent ? 'Thank you — your answers are in.' : 'You have already answered this survey. Thank you!'}
          </p>
          <p className="text-muted text-sm mt-1">
            You can change your answers below and submit again until the survey closes.
          </p>
        </div>
      ) : null}

      <p className="text-muted mb-10">{env.survey.intro}</p>

      <SurveyForm
        key={env.updatedAt ?? 0}
        survey={env.survey}
        initial={initial}
        submittedAt={env.submittedAt}
        pending={mut.isPending}
        serverError={serverError}
        onSubmit={(answers) => {
          setJustSent(false);
          mut.mutate(answers);
        }}
      />
      {back ? <div className="mt-10">{back}</div> : null}
    </Prose>
  );
}
