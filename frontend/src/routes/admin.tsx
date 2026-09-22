import { createRoute, Link, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import {
  fetchAdminApplications,
  fetchMe,
  type AdminListRow,
  type ApplicationStatus,
} from '../api/client';

async function ensureAdmin() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  if (!me.roles.includes('admin')) throw redirect({ to: '/' });
}

function AdminIndexPage() {
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | 'all'>(
    'all',
  );
  const [query, setQuery] = useState('');

  const q = useQuery({
    queryKey: ['admin', 'applications', includeDrafts],
    queryFn: () => fetchAdminApplications(includeDrafts),
  });

  const rows = q.data?.applications ?? [];
  const filtered = rows.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (!query) return true;
    const needle = query.toLowerCase();
    return (
      r.applicantEmail.toLowerCase().includes(needle) ||
      (r.legalName ?? '').toLowerCase().includes(needle) ||
      (r.location ?? '').toLowerCase().includes(needle)
    );
  });

  return (
    <Prose>
      <p className="smallcaps text-accent mb-4">Admin</p>
      <h1 className="mb-2">Applications</h1>
      <p className="text-muted mb-6">
        {q.isLoading
          ? 'Loading…'
          : `${filtered.length} of ${rows.length} shown`}
        {' · '}
        <Link to="/admin/offers" className="text-ink">
          Offers &amp; import
        </Link>
        {' · '}
        <Link to="/admin/onboarding" className="text-ink">
          Onboarding
        </Link>
      </p>

      <div className="flex flex-wrap items-baseline gap-4 mb-6">
        <input
          type="search"
          placeholder="Search name, email, location"
          className="field-input flex-1 min-w-[16rem]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="field-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | 'all')}
        >
          <option value="all">All statuses</option>
          <option value="submitted">Submitted</option>
          <option value="awaiting_guardian">Awaiting guardian</option>
          <option value="under_review">Under review</option>
          <option value="accepted">Accepted</option>
          <option value="awaiting_payment">Awaiting payment</option>
          <option value="enrolled">Enrolled</option>
          <option value="declined">Declined</option>
          <option value="waitlisted">Waitlisted</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="draft">Draft</option>
        </select>
        <label className="text-sm text-muted flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeDrafts}
            onChange={(e) => setIncludeDrafts(e.target.checked)}
          />
          Include drafts
        </label>
      </div>

      {q.isError && <p className="text-error">Failed to load applications.</p>}

      {filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-rule">
              <tr className="text-left smallcaps text-muted">
                <th className="py-2 pr-4">Applicant</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Submitted</th>
                <th className="py-2 pr-4">Course prefs</th>
                <th className="py-2 pr-4">Files</th>
                <th className="py-2 pr-4">Guardian</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <ApplicantRow key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Prose>
  );
}

function ApplicantRow({ row }: { row: AdminListRow }) {
  const submitted = row.submittedAt
    ? new Date(row.submittedAt * 1000).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';
  return (
    <tr className="border-b border-rule/60 align-top">
      <td className="py-3 pr-4">
        <Link
          to="/admin/applications/$id"
          params={{ id: row.id }}
          className="text-ink no-underline hover:underline"
        >
          <span className="font-medium">
            {row.legalName ?? '(no name)'}
          </span>
        </Link>
        <div className="text-xs text-muted">{row.applicantEmail}</div>
        {row.location && (
          <div className="text-xs text-muted">{row.location}</div>
        )}
      </td>
      <td className="py-3 pr-4">
        <StatusPill status={row.status} />
      </td>
      <td className="py-3 pr-4 text-xs text-muted">{submitted}</td>
      <td className="py-3 pr-4">
        {row.coursePreferences.length > 0 ? (
          <span className="font-mono text-xs">
            {row.coursePreferences.join(', ')}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="py-3 pr-4 text-xs">
        {row.fileCount > 0 ? (
          <span>{row.fileCount}</span>
        ) : (
          <span className="text-muted">0</span>
        )}
      </td>
      <td className="py-3 pr-4">
        {row.guardianEmail ? (
          <div>
            <div className="text-xs">{row.guardianEmail}</div>
            <div className="text-xs text-muted">
              {row.guardianAccepted ? 'accepted' : 'invited'}
            </div>
          </div>
        ) : (
          <span className="text-muted text-xs">none</span>
        )}
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: ApplicationStatus }) {
  const label = status.replace(/_/g, ' ');
  const cls =
    status === 'submitted' || status === 'under_review'
      ? 'text-accent'
      : status === 'accepted' || status === 'awaiting_payment'
        ? 'text-accent font-medium'
        : status === 'enrolled'
          ? 'text-accent font-medium underline decoration-1 underline-offset-4'
          : status === 'waitlisted'
            ? 'text-muted'
            : status === 'rejected' || status === 'withdrawn' || status === 'declined'
              ? 'text-muted line-through'
              : 'text-muted';
  return <span className={`smallcaps ${cls}`}>{label}</span>;
}

export const adminIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  beforeLoad: ensureAdmin,
  component: AdminIndexPage,
});
