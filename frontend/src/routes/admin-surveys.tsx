import { useState } from 'react';
import { createRoute, Link, redirect } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SURVEY_ROUND } from '@rp2/shared';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import {
  fetchAdminSurveys,
  fetchMe,
  requestSurveys,
  surveyExportUrl,
  type SurveyRequestResult,
} from '../api/client';

/*
 * The term survey: who has answered, the download, and asking the rest.
 *
 * Preview before send, like the signature reminders — an email to the family
 * of a minor cannot be recalled.
 */

async function ensureAdmin() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  if (!me.roles.includes('admin')) throw redirect({ to: '/' });
}

function formatWhen(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function AdminSurveysPage() {
  const q = useQuery({ queryKey: ['admin', 'surveys'], queryFn: fetchAdminSurveys });
  const [includeResponded, setIncludeResponded] = useState(false);
  const [preview, setPreview] = useState<SurveyRequestResult | null>(null);
  const [sent, setSent] = useState<SurveyRequestResult | null>(null);

  const previewMut = useMutation({
    mutationFn: () => requestSurveys({ dryRun: true, includeResponded }),
    onSuccess: (r) => {
      setPreview(r);
      setSent(null);
    },
  });
  const sendMut = useMutation({
    mutationFn: () => requestSurveys({ dryRun: false, includeResponded }),
    onSuccess: (r) => {
      setSent(r);
      setPreview(null);
    },
  });

  const list = q.data;

  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Admin</p>
      <h1 className="mb-2">Surveys</h1>
      <p className="text-muted mb-10">
        Round <span className="font-mono">{SURVEY_ROUND}</span>. Enrolled students answer at{' '}
        <span className="font-mono">/survey</span>; their parents answer from the parent portal,
        once per student.{' '}
        <Link to="/admin" className="text-ink">
          Applications
        </Link>
        {' · '}
        <Link to="/admin/onboarding" className="text-ink">
          Onboarding
        </Link>
      </p>

      {q.isPending ? <p className="text-muted italic">Loading…</p> : null}
      {q.isError ? <p className="text-error">Failed to load.</p> : null}

      {list ? (
        <>
          <p className="text-lg text-ink/90 mb-8">
            {list.studentResponses} of {list.enrolledCount} students and {list.guardianResponses}{' '}
            of {list.enrolledCount} parents have answered.
          </p>

          <h2 className="font-serif text-2xl mb-4">Download</h2>
          <div className="flex flex-wrap gap-4 mb-12">
            <a href={surveyExportUrl('xlsx', 'student')} className="btn btn-primary no-underline">
              Both surveys (.xlsx)
            </a>
            <a href={surveyExportUrl('csv', 'student')} className="btn btn-ghost no-underline">
              Students (.csv)
            </a>
            <a href={surveyExportUrl('csv', 'guardian')} className="btn btn-ghost no-underline">
              Parents (.csv)
            </a>
          </div>

          <h2 className="font-serif text-2xl mb-4">Ask families to answer</h2>
          <label className="flex items-center gap-2 text-sm text-muted mb-4">
            <input
              type="checkbox"
              checked={includeResponded}
              onChange={(e) => {
                setIncludeResponded(e.target.checked);
                setPreview(null);
              }}
            />
            Also email people who have already answered
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={previewMut.isPending}
              onClick={() => previewMut.mutate()}
            >
              {previewMut.isPending ? 'Checking…' : 'Preview who gets an email'}
            </button>
            {preview && preview.dryRun && preview.planned.length > 0 ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={sendMut.isPending}
                onClick={() => sendMut.mutate()}
              >
                {sendMut.isPending
                  ? 'Sending…'
                  : `Send ${preview.planned.length} email${preview.planned.length === 1 ? '' : 's'}`}
              </button>
            ) : null}
          </div>

          {preview && preview.dryRun ? (
            <div className="mt-5">
              <p className="text-muted mb-2">
                {preview.planned.length === 0
                  ? 'Nobody to email.'
                  : `${preview.planned.length} email${preview.planned.length === 1 ? '' : 's'}. Nothing has been sent.`}
              </p>
              <ul className="text-sm space-y-1">
                {preview.planned.map((p, i) => (
                  <li key={i}>
                    <span className="smallcaps text-muted mr-2">
                      {p.kind === 'guardian' ? 'parent' : 'student'}
                    </span>
                    <span className="text-ink">{p.to}</span>
                    {p.kind === 'guardian' && p.students.length > 0 ? (
                      <span className="text-muted"> · about {p.students.join(', ')}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {sent && !sent.dryRun ? (
            <p className="mt-5 text-ink">
              Sent {sent.sent}
              {sent.skipped > 0 ? `, ${sent.skipped} failed` : ''}.
            </p>
          ) : null}
          {previewMut.isError || sendMut.isError ? (
            <p className="mt-4 text-error">That did not work. Nothing was sent.</p>
          ) : null}

          <h2 className="font-serif text-2xl mt-16 mb-4">Who has answered</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-rule">
                <tr className="text-left smallcaps text-muted">
                  <th className="py-2 pr-4">Student</th>
                  <th className="py-2 pr-4">Section</th>
                  <th className="py-2 pr-4">Student</th>
                  <th className="py-2 pr-4">Parent</th>
                </tr>
              </thead>
              <tbody>
                {list.families.map((f) => (
                  <tr key={f.applicationId} className="border-b border-rule/60 align-top">
                    <td className="py-3 pr-4">
                      <div className="text-ink">{f.studentName ?? '(no name)'}</div>
                      <div className="text-xs text-muted break-all">{f.studentEmail}</div>
                      <div className="text-xs text-muted break-all">
                        {f.guardianEmail ?? '(no guardian)'}
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs">{f.section ?? '—'}</td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {f.studentRespondedAt ? formatWhen(f.studentRespondedAt) : <span className="text-muted">—</span>}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {f.guardianRespondedAt ? formatWhen(f.guardianRespondedAt) : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Prose>
  );
}

export const adminSurveysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/surveys',
  beforeLoad: ensureAdmin,
  component: AdminSurveysPage,
});
