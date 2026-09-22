import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchOnboarding,
  sendReminders,
  voidSignature,
  type OnboardingFamily,
  type OnboardingList,
  type RemindResult,
  type SuspectSignature,
  type VoidRecord,
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

function formatWhen(unixSeconds: number): string {
  try {
    return new Date(unixSeconds * 1000).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '';
  }
}

function titleOf(documents: { key: string; title: string }[], key: string): string {
  return documents.find((d) => d.key === key)?.title ?? key;
}

/*
 * Signatures that look like the wrong person typed them, and the only control
 * anywhere that removes one.
 *
 * These families are not on the chase list — they are not waiting on anything,
 * which is the whole problem: a signature made by the wrong person reads as
 * done. Voiding puts the slot back to outstanding so the right person is asked
 * again, and writes a tombstone carrying the original row, who voided it and
 * why. Hence the required reason and the two-step confirm: this is the one
 * action on this screen that destroys a consent record.
 */
function SuspectList({
  suspect,
  documents,
}: {
  suspect: SuspectSignature[];
  documents: { key: string; title: string }[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const keyOf = (s: SuspectSignature) => `${s.applicationId}:${s.document}:${s.signerKind}`;

  const voidMut = useMutation({
    mutationFn: (s: SuspectSignature) =>
      voidSignature(s.applicationId, {
        document: s.document,
        signerKind: s.signerKind,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setOpen(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['admin', 'onboarding'] });
    },
  });

  if (suspect.length === 0) return null;

  return (
    <section className="rule-t mt-10 pt-6">
      <h3 className="font-serif text-xl">Signatures that need a look</h3>
      <p className="text-muted mt-1 mb-1">
        {suspect.length} signature{suspect.length === 1 ? '' : 's'} where the
        name typed looks like the wrong person’s — usually a parent signing the
        participant’s line from the student’s own browser.
      </p>
      <p className="text-muted text-sm mb-6">
        These families show as fully signed, so nothing else surfaces them.
        Voiding a signature puts that line back to unsigned, drops the student
        out of “cleared”, and is written to the record with your name and
        reason. The next Discord reconcile will strip their role until it is
        signed again.
      </p>

      <ul className="space-y-5">
        {suspect.map((s) => {
          const k = keyOf(s);
          const isOpen = open === k;
          const busy = voidMut.isPending && isOpen;

          return (
            <li key={k} className="border-b border-rule/60 pb-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <div className="text-ink">
                    {s.studentName ?? '(no name)'}{' '}
                    <span className="text-muted text-sm">· {s.studentEmail}</span>
                  </div>
                  <div className="text-sm text-muted mt-1">
                    {titleOf(documents, s.document)} ·{' '}
                    {s.signerKind === 'student' ? 'participant' : 'parent or guardian'} line ·
                    signed {formatWhen(s.signedAt)}
                  </div>
                  <div className="text-sm mt-1">
                    Typed <b className="text-ink">“{s.typedName}”</b>
                    <span className="text-muted">
                      {' — '}
                      {s.reason === 'other_partys_name'
                        ? s.signerKind === 'student'
                          ? 'the guardian named on the application'
                          : 'the participant’s own name'
                        : 'the same name stands in both halves of this document'}
                    </span>
                    {s.signedFromEmail ? (
                      <span className="text-muted"> · from {s.signedFromEmail}</span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost shrink-0"
                  onClick={() => {
                    setOpen(isOpen ? null : k);
                    setReason('');
                  }}
                >
                  {isOpen ? 'Cancel' : 'Void this signature'}
                </button>
              </div>

              {isOpen ? (
                <div className="mt-4 pl-4 border-l-2 border-accent/40">
                  <label className="block">
                    <span className="block text-sm text-ink">
                      Why is this being voided?
                    </span>
                    <span className="block text-muted text-sm italic mt-1">
                      Goes in the record, verbatim, next to your name. Write it
                      for someone reading this file a year from now.
                    </span>
                    <textarea
                      className="field-input mt-2 w-full"
                      rows={3}
                      value={reason}
                      disabled={busy}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <div className="flex items-center gap-4 mt-3">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={reason.trim().length < 10 || busy}
                      onClick={() => voidMut.mutate(s)}
                    >
                      {busy ? 'Voiding…' : 'Void signature'}
                    </button>
                    {reason.trim().length < 10 ? (
                      <span className="text-sm text-muted">
                        A reason of at least 10 characters is required.
                      </span>
                    ) : null}
                  </div>
                  {voidMut.isError && isOpen ? (
                    <p className="text-error text-sm mt-3">
                      That did not work. The signature is unchanged.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The void ledger. Permanently visible, so voiding never becomes routine. */
function VoidLedger({
  voids,
  documents,
}: {
  voids: VoidRecord[];
  documents: { key: string; title: string }[];
}) {
  if (voids.length === 0) return null;

  return (
    <section className="rule-t mt-10 pt-6">
      <h3 className="font-serif text-xl">Voided signatures</h3>
      <p className="text-muted mt-1 mb-5 text-sm">
        Every signature ever taken back. The original row is kept in full — this
        is the record of its removal, not a replacement for it.
      </p>
      <ul className="space-y-4 text-sm">
        {voids.map((v, i) => (
          <li key={i} className="border-b border-rule/60 pb-4">
            <div className="text-ink">
              {v.studentName ?? '(no name)'} · {titleOf(documents, v.document)} ·{' '}
              {v.signerKind === 'student' ? 'participant' : 'parent or guardian'} line
            </div>
            <div className="text-muted mt-1">
              Signed “{v.typedName}” {formatWhen(v.signedAt)} · voided{' '}
              {formatWhen(v.voidedAt)} by {v.voidedByEmail ?? '(unknown)'}
            </div>
            <div className="text-ink/90 mt-1 italic">{v.reason}</div>
          </li>
        ))}
      </ul>
    </section>
  );
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

  /* The suspect list and the ledger are not about who is outstanding, so they
   * have to survive the empty chase list — which is precisely the state a
   * wrong-name signature produces. */
  if (list.outstandingCount === 0) {
    return (
      <div>
        <p className="text-lg text-ink/90">
          Every enrolled family has signed both documents. Nothing outstanding.
        </p>
        <SuspectList suspect={list.suspect} documents={list.documents} />
        <VoidLedger voids={list.voids} documents={list.documents} />
      </div>
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

      <SuspectList suspect={list.suspect} documents={list.documents} />
      <VoidLedger voids={list.voids} documents={list.documents} />
    </div>
  );
}
