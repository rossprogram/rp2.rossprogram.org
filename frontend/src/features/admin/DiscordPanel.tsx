import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, reconcileDiscord, type ReconcileResult } from '../../api/client';

/*
 * Reconciling the Discord guild against the portal.
 *
 * Dry run first, always. Applying can add people to — and remove people from —
 * a server full of minors, so the live run is a second, deliberate click on a
 * report you have already read.
 */

function countOutcomes(r: ReconcileResult): [string, number][] {
  const tally = new Map<string, number>();
  for (const row of r.results) {
    const o = row.outcome as { status?: string; reason?: string };
    const key = o.status === 'skipped' ? `skipped — ${o.reason ?? 'unknown'}` : (o.status ?? '?');
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return [...tally].sort((a, b) => b[1] - a[1]);
}

export function DiscordPanel() {
  const [report, setReport] = useState<ReconcileResult | null>(null);
  const [allowCreate, setAllowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => reconcileDiscord({ dryRun, allowCreate }),
    onMutate: () => setError(null),
    onSuccess: (r) => setReport(r),
    onError: (err) => {
      setError(
        err instanceof ApiError && err.status === 503
          ? 'Discord is switched off on the server (DISCORD_ENABLED).'
          : 'Discord did not respond. Nothing was changed.',
      );
    },
  });

  const dryRunDone = report?.dryRun === true;

  return (
    <div>
      <p className="text-muted mb-6">
        Compares every cleared student against the guild and applies the
        difference: section and group roles, and the display name. Roles that
        already exist are matched by name and reused — they carry your channel
        permissions, so the bot never creates a duplicate unless you ask.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={run.isPending}
          onClick={() => run.mutate(true)}
        >
          {run.isPending ? 'Checking…' : 'Dry run'}
        </button>
        {dryRunDone ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={run.isPending}
            onClick={() => run.mutate(false)}
          >
            Apply
          </button>
        ) : null}
        <label className="text-sm text-muted flex items-center gap-2">
          <input
            type="checkbox"
            checked={allowCreate}
            onChange={(e) => setAllowCreate(e.target.checked)}
          />
          Create roles that don&rsquo;t exist
        </label>
      </div>

      {error ? <p className="mt-4 text-error">{error}</p> : null}

      {report ? (
        <div className="mt-6">
          <p className="text-ink mb-3">
            {report.dryRun ? 'Dry run — nothing was changed.' : 'Applied.'}
          </p>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm mb-4">
            <dt className="smallcaps text-muted">Cleared students</dt>
            <dd className="text-ink tabular-nums">{report.cleared}</dd>
            <dt className="smallcaps text-muted">Discord linked</dt>
            <dd className="text-ink tabular-nums">{report.linked}</dd>
            <dt className="smallcaps text-muted">Roles matched</dt>
            <dd className="text-ink tabular-nums">{report.rolesAdopted.length}</dd>
            {report.rolesCreated.length > 0 ? (
              <>
                <dt className="smallcaps text-muted">Roles created</dt>
                <dd className="text-ink tabular-nums">{report.rolesCreated.length}</dd>
              </>
            ) : null}
          </dl>

          {/*
           * A missing role is a naming disagreement between the code and the
           * guild, and it means those students cannot be placed at all — so it
           * is the loudest thing on the page.
           */}
          {report.rolesMissing.length > 0 ? (
            <div className="border border-accent/40 rounded p-4 mb-4">
              <p className="text-accent mb-2">
                {report.rolesMissing.length} role
                {report.rolesMissing.length === 1 ? '' : 's'} named in the portal
                {report.rolesMissing.length === 1 ? ' does' : ' do'} not exist in
                the guild. Nothing was created.
              </p>
              <ul className="text-sm text-ink list-disc pl-6 space-y-0.5">
                {report.rolesMissing.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              <p className="text-sm text-muted mt-3">
                Either the roles are named differently in Discord — fix{' '}
                <code>COURSES</code> in <code>shared/src/offers.ts</code> — or
                they genuinely need creating, in which case tick the box above.
              </p>
            </div>
          ) : null}

          {report.results.length > 0 ? (
            <div>
              <p className="smallcaps text-muted mb-1">Members</p>
              <ul className="text-sm space-y-0.5">
                {countOutcomes(report).map(([key, count]) => (
                  <li key={key}>
                    <span className="text-ink tabular-nums mr-2">{count}</span>
                    <span className="text-muted">{key}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
