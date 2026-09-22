import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchOnboarding,
  sendReminders,
  type OnboardingFamily,
  type OnboardingList,
  type RemindResult,
} from '../../api/client';

/*
 * Who has not signed, and chasing them.
 *
 * Preview before send, the same way the offer import previews before publish:
 * these are emails to the families of minors, and an email cannot be recalled.
 */

type Filter = 'all' | 'student' | 'guardian' | 'never_logged_in';

function owes(f: OnboardingFamily, who: 'student' | 'guardian'): boolean {
  return f.outstanding.some((o) => o.signerKind === who);
}

/**
 * Who still owes THIS document — 'student', 'guardian', 'both', or nobody.
 *
 * Laid out per document rather than per signer because the cell then holds one
 * short word instead of a stack of document titles, which is the difference
 * between a table you can scan and one that wraps to four lines a row.
 */
function owedBy(f: OnboardingFamily, document: string): string | null {
  const kinds = f.outstanding.filter((o) => o.document === document).map((o) => o.signerKind);
  if (kinds.length === 0) return null;
  if (kinds.length === 2) return 'both';
  return kinds[0]!;
}

export function OnboardingBoard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'onboarding'], queryFn: fetchOnboarding });

  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<RemindResult | null>(null);
  const [sent, setSent] = useState<RemindResult | null>(null);

  const list = q.data;

  const families = useMemo(() => {
    const rows = list?.families ?? [];
    switch (filter) {
      case 'student':
        return rows.filter((f) => owes(f, 'student'));
      case 'guardian':
        return rows.filter((f) => owes(f, 'guardian'));
      case 'never_logged_in':
        return rows.filter((f) => !f.guardianAccepted);
      default:
        return rows;
    }
  }, [list, filter]);

  // An empty selection means "everyone outstanding", which is what the API
  // does with no ids. Selecting narrows it.
  const targetIds = selected.size > 0 ? [...selected] : undefined;

  const previewMut = useMutation({
    mutationFn: () => sendReminders({ dryRun: true, ...(targetIds ? { applicationIds: targetIds } : {}) }),
    onSuccess: (r) => {
      setPreview(r);
      setSent(null);
    },
  });

  const sendMut = useMutation({
    mutationFn: () => sendReminders({ dryRun: false, ...(targetIds ? { applicationIds: targetIds } : {}) }),
    onSuccess: (r) => {
      setSent(r);
      setPreview(null);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['admin', 'onboarding'] });
    },
  });

  if (q.isPending) return <p className="text-muted italic">Loading…</p>;
  if (q.isError || !list) return <p className="text-error">Failed to load.</p>;

  if (list.outstandingCount === 0) {
    return (
      <p className="text-lg text-ink/90">
        Every enrolled family has signed both documents. Nothing outstanding.
      </p>
    );
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <p className="text-lg text-ink/90 mb-1">
        {list.outstandingCount} famil{list.outstandingCount === 1 ? 'y has' : 'ies have'} a
        signature outstanding.
      </p>
      {list.neverLoggedIn > 0 ? (
        <p className="text-muted mb-6">
          {list.neverLoggedIn} of them have a guardian who has{' '}
          <b className="text-ink">never logged in</b>. A reminder about signing is
          the wrong email for those — they get their portal invite again instead.
        </p>
      ) : (
        <p className="text-muted mb-6">Every guardian has accepted their portal invite.</p>
      )}

      <div className="flex flex-wrap items-baseline gap-4 mb-6">
        <select
          className="field-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
        >
          <option value="all">Everyone outstanding</option>
          <option value="student">Waiting on the student</option>
          <option value="guardian">Waiting on the guardian</option>
          <option value="never_logged_in">Guardian never logged in</option>
        </select>
        <span className="text-sm text-muted">
          {selected.size > 0
            ? `${selected.size} selected`
            : `${families.length} shown · none selected, so a send reaches everyone outstanding`}
        </span>
        {selected.size > 0 ? (
          <button type="button" className="btn btn-ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-rule">
            <tr className="text-left smallcaps text-muted">
              <th className="py-2 pr-3"></th>
              <th className="py-2 pr-4">Student</th>
              {list.documents.map((d) => (
                <th key={d.key} className="py-2 pr-4">
                  {d.title.replace(/^Program /, '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {families.map((f) => (
              <tr key={f.applicationId} className="border-b border-rule/60 align-top">
                <td className="py-3 pr-3">
                  <input
                    type="checkbox"
                    checked={selected.has(f.applicationId)}
                    onChange={() => toggle(f.applicationId)}
                    aria-label={`Select ${f.studentName ?? f.studentEmail}`}
                  />
                </td>
                {/* Student and guardian share a cell: the guardian is an
                    attribute of the family, and a separate column pushed the
                    "never logged in" flag off the side of the table. */}
                <td className="py-3 pr-4">
                  <div className="text-ink">{f.studentName ?? '(no name)'}</div>
                  <div className="text-xs text-muted break-all">{f.studentEmail}</div>
                  <div className="text-xs text-muted break-all mt-1">
                    {f.guardianEmail ?? '(no guardian)'}
                    {!f.guardianAccepted ? (
                      <span className="text-accent"> · never logged in</span>
                    ) : null}
                  </div>
                </td>
                {list.documents.map((d) => {
                  const who = owedBy(f, d.key);
                  return (
                    <td key={d.key} className="py-3 pr-4 whitespace-nowrap">
                      {who ? (
                        <span className="text-ink">{who}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rule-t mt-8 pt-6">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={previewMut.isPending}
            onClick={() => previewMut.mutate()}
          >
            {previewMut.isPending ? 'Checking…' : 'Preview who gets an email'}
          </button>
          {preview && preview.dryRun ? (
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
              {preview.planned.length} email
              {preview.planned.length === 1 ? '' : 's'} to {preview.families} famil
              {preview.families === 1 ? 'y' : 'ies'}. Nothing has been sent.
            </p>
            <ul className="text-sm space-y-1">
              {preview.planned.map((p, i) => (
                <li key={i}>
                  <span className="smallcaps text-muted mr-2">
                    {p.kind === 'guardian_invite' ? 'portal invite' : p.kind}
                  </span>
                  <span className="text-ink">{p.to}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {sent && !sent.dryRun ? (
          <p className="mt-5 text-ink">
            Sent {sent.sent}
            {sent.skipped > 0 ? `, ${sent.skipped} failed` : ''} across {sent.families} famil
            {sent.families === 1 ? 'y' : 'ies'}.
          </p>
        ) : null}

        {previewMut.isError || sendMut.isError ? (
          <p className="mt-4 text-error">That did not work. Nothing was sent.</p>
        ) : null}
      </div>
    </div>
  );
}
