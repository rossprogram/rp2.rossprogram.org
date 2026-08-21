import { createRoute, Link, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import {
  adminFileDownloadUrl,
  fetchAdminApplication,
  fetchMe,
  type AdminApplicationDetail,
} from '../api/client';
import { QUESTIONS, SECTIONS, questionByKey } from '@rp2/shared';

async function ensureAdmin() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  if (!me.roles.includes('admin')) throw redirect({ to: '/' });
}

function AdminApplicationPage() {
  const { id } = adminApplicationRoute.useParams();
  const q = useQuery({
    queryKey: ['admin', 'application', id],
    queryFn: () => fetchAdminApplication(id),
  });

  if (q.isLoading) {
    return (
      <Prose>
        <p className="text-muted">Loading…</p>
      </Prose>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Prose>
        <p className="text-error">Failed to load application.</p>
      </Prose>
    );
  }

  const app = q.data.application;
  return (
    <Prose>
      <p className="smallcaps text-accent mb-2">
        <Link to="/admin" className="text-accent no-underline hover:underline">
          ← All applications
        </Link>
      </p>
      <Header app={app} />
      <Files app={app} />
      {SECTIONS.map((section) => (
        <SectionBlock key={section.key} app={app} sectionKey={section.key} />
      ))}
      <AvailabilityBlock app={app} />
      <RawJson app={app} />
    </Prose>
  );
}

function Header({ app }: { app: AdminApplicationDetail }) {
  const submitted = app.submittedAt
    ? new Date(app.submittedAt * 1000).toLocaleString(undefined, {
        dateStyle: 'long',
        timeStyle: 'short',
      })
    : null;
  const name =
    (typeof app.responses['student_legal_name'] === 'string' &&
      (app.responses['student_legal_name'] as string)) ||
    '(no name)';
  return (
    <>
      <h1 className="mb-2">{name}</h1>
      <p className="text-muted mb-8 text-sm">
        <span className="smallcaps">{app.status.replace(/_/g, ' ')}</span> ·{' '}
        {app.applicantEmail}
        {submitted && <> · submitted {submitted}</>}
      </p>
    </>
  );
}

function Files({ app }: { app: AdminApplicationDetail }) {
  if (app.files.length === 0) {
    return (
      <section className="mb-10">
        <h2 className="mb-2">Files</h2>
        <p className="text-muted">No files uploaded.</p>
      </section>
    );
  }
  return (
    <section className="mb-10">
      <h2 className="mb-3">Files</h2>
      <ul className="space-y-2">
        {app.files.map((f) => (
          <li key={f.id} className="flex flex-wrap items-baseline gap-3">
            <span className="smallcaps text-accent text-xs">{f.kind}</span>
            <a
              href={adminFileDownloadUrl(app.id, f.id)}
              target="_blank"
              rel="noreferrer"
              className="text-ink"
            >
              {f.filename}
            </a>
            <span className="text-xs text-muted">
              {(f.size / 1024).toFixed(1)} KB · {f.contentType}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionBlock({
  app,
  sectionKey,
}: {
  app: AdminApplicationDetail;
  sectionKey: (typeof SECTIONS)[number]['key'];
}) {
  const section = SECTIONS.find((s) => s.key === sectionKey)!;
  const questions = QUESTIONS.filter((q) => q.section === sectionKey);
  const answered = questions.filter((q) => q.key in app.responses);
  if (answered.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="flex items-baseline gap-4 mb-4">
        <span className="smallcaps text-accent">§{section.index}</span>
        <h2 className="m-0">{section.title}</h2>
      </div>
      <dl className="space-y-4">
        {questions.map((q) => {
          const raw = app.responses[q.key];
          return (
            <div key={q.key}>
              <dt className="smallcaps text-muted text-xs">{q.prompt}</dt>
              <dd className="mt-1 whitespace-pre-wrap">
                <ResponseView questionKey={q.key} value={raw} />
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function ResponseView({
  questionKey,
  value,
}: {
  questionKey: string;
  value: unknown;
}) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-muted">—</span>;
  }
  const q = questionByKey(questionKey);
  if (Array.isArray(value)) {
    // Course preferences: string of course keys, in rank order.
    if (
      q &&
      q.type === 'ranked' &&
      value.every((v) => typeof v === 'string')
    ) {
      return (
        <ol className="list-decimal list-inside">
          {(value as string[]).map((v, i) => (
            <li key={`${v}-${i}`}>{optionLabel(questionKey, v)}</li>
          ))}
        </ol>
      );
    }
    return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
  }
  if (typeof value === 'object') {
    return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
  }
  const str = String(value);
  const label = optionLabel(questionKey, str);
  if (label !== str) {
    return (
      <>
        {label} <span className="text-muted text-xs">({str})</span>
      </>
    );
  }
  return <>{str}</>;
}

function optionLabel(questionKey: string, value: string): string {
  const q = questionByKey(questionKey);
  if (q && 'options' in q && Array.isArray(q.options)) {
    const opt = q.options.find((o) => o.value === value);
    if (opt) return opt.label;
  }
  return value;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function AvailabilityBlock({ app }: { app: AdminApplicationDetail }) {
  if (app.availability.length === 0) return null;
  const sorted = [...app.availability].sort(
    (a, b) => a.weekday - b.weekday || a.startMin - b.startMin,
  );
  return (
    <section className="mb-10">
      <h2 className="mb-3">Availability</h2>
      <ul className="text-sm">
        {sorted.map((a, i) => (
          <li key={i} className="text-muted">
            <span className="text-ink">{WEEKDAYS[a.weekday]}</span>{' '}
            {fmtMin(a.startMin)}–{fmtMin(a.endMin)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function fmtMin(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function RawJson({ app }: { app: AdminApplicationDetail }) {
  return (
    <details className="mt-12 text-xs">
      <summary className="cursor-pointer text-muted smallcaps">Raw JSON</summary>
      <pre className="mt-2 p-3 bg-accent-soft overflow-x-auto">
        {JSON.stringify(app, null, 2)}
      </pre>
    </details>
  );
}

export const adminApplicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/applications/$id',
  beforeLoad: ensureAdmin,
  component: AdminApplicationPage,
});
