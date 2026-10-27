import { useState } from 'react';
import {
  surveyAnswersSchema,
  type SurveyAnswers,
  type SurveyDefinition,
  type SurveyQuestion,
} from '@rp2/shared';
import { RequiredMark } from '../applicant/Field';

/*
 * One survey, rendered from its shared definition. Used by both the student's
 * /survey page and the guardian's per-student survey page; the server
 * validates against the same definition.
 *
 * Answers are held locally and sent in one submit — unlike the application
 * there is nothing here worth autosaving, and a half-answered survey is not a
 * response.
 */

type Props = {
  survey: SurveyDefinition;
  initial: SurveyAnswers;
  submittedAt: number | null;
  pending: boolean;
  serverError: string | null;
  onSubmit: (answers: SurveyAnswers) => void;
};

export function SurveyForm({ survey, initial, submittedAt, pending, serverError, onSubmit }: Props) {
  const [answers, setAnswers] = useState<SurveyAnswers>(initial);
  const [missing, setMissing] = useState<Set<string>>(new Set());

  const set = (key: string, value: SurveyAnswers[string]) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setMissing((m) => {
      if (!m.has(key)) return m;
      const next = new Set(m);
      next.delete(key);
      return next;
    });
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = surveyAnswersSchema(survey).safeParse(answers);
    if (!parsed.success) {
      setMissing(new Set(parsed.error.issues.map((i) => String(i.path[0]))));
      return;
    }
    setMissing(new Set());
    onSubmit(parsed.data as SurveyAnswers);
  }

  return (
    <form onSubmit={submit} noValidate>
      {survey.questions.map((q, i) => (
        <fieldset key={q.key} className="mb-10">
          <legend className="block text-ink leading-snug mb-1">
            <span className="text-muted font-mono text-sm mr-2">{i + 1}.</span>
            {q.prompt}
            {q.required && <RequiredMark />}
          </legend>
          {q.help ? <p className="text-muted text-sm italic mt-1">{q.help}</p> : null}
          <div className="mt-3">
            <QuestionInput question={q} value={answers[q.key]} onChange={(v) => set(q.key, v)} disabled={pending} />
          </div>
          {missing.has(q.key) ? (
            <p className="text-accent text-sm mt-2">Please answer this question.</p>
          ) : null}
        </fieldset>
      ))}

      <div className="rule-t pt-6 flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Sending…' : submittedAt ? 'Update my answers' : 'Submit survey'}
        </button>
        {missing.size > 0 ? (
          <span className="text-accent text-sm">Some required questions are unanswered.</span>
        ) : null}
        {serverError ? <span className="text-accent text-sm">{serverError}</span> : null}
      </div>
    </form>
  );
}

function QuestionInput({
  question: q,
  value,
  onChange,
  disabled,
}: {
  question: SurveyQuestion;
  value: SurveyAnswers[string] | undefined;
  onChange: (v: SurveyAnswers[string]) => void;
  disabled: boolean;
}) {
  switch (q.type) {
    case 'dropdown':
      return (
        <select
          className="field-input"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Choose…</option>
          {q.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );

    case 'single_choice':
      return (
        <div className="space-y-2">
          {q.options.map((o) => (
            <label key={o} className="flex items-baseline gap-3 cursor-pointer group">
              <input
                type="radio"
                name={q.key}
                checked={value === o}
                disabled={disabled}
                onChange={() => onChange(o)}
                className="accent-accent shrink-0 translate-y-[2px]"
              />
              <span className="group-hover:text-ink text-ink/95">{o}</span>
            </label>
          ))}
        </div>
      );

    case 'scale':
      return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-muted text-sm">1 = {q.minLabel}</span>
          <div className="flex gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="flex flex-col items-center cursor-pointer">
                <input
                  type="radio"
                  name={q.key}
                  checked={value === n}
                  disabled={disabled}
                  onChange={() => onChange(n)}
                  className="accent-accent"
                />
                <span className="text-sm font-mono mt-1">{n}</span>
              </label>
            ))}
          </div>
          <span className="text-muted text-sm">5 = {q.maxLabel}</span>
        </div>
      );

    case 'grid': {
      const grid = value && typeof value === 'object' ? value : {};
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted">
                <th className="text-left font-normal py-2 pr-3"></th>
                {q.columns.map((c) => (
                  <th key={c} className="font-normal px-1 py-2 text-center text-xs leading-tight w-16">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.rows.map((r) => (
                <tr key={r.key} className="border-t border-rule/60">
                  <td className="py-3 pr-3 text-ink/95">{r.label}</td>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <td key={n} className="text-center px-1">
                      <input
                        type="radio"
                        name={`${q.key}.${r.key}`}
                        aria-label={`${r.label}: ${q.columns[n - 1]}`}
                        checked={grid[r.key] === n}
                        disabled={disabled}
                        onChange={() => onChange({ ...grid, [r.key]: n })}
                        className="accent-accent"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'long_text':
      return (
        <textarea
          className="field-input w-full"
          rows={5}
          maxLength={5000}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
