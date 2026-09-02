import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  fetchImports,
  notifyImport,
  offerTemplateUrl,
  previewOfferImport,
  publishOfferImport,
  type ImportPreview,
  type NotifyResult,
  type PublishResult,
} from '../../api/client';
import { ImportPreviewTable } from './ImportPreviewTable';

/**
 * Download → edit → preview → publish → notify.
 *
 * Publishing and notifying are separate steps on purpose: a mistaken import
 * that has not been announced can be corrected by importing again, but an
 * email cannot be recalled.
 */
export function OfferImport() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [notified, setNotified] = useState<NotifyResult | null>(null);
  // Generated once per preview, so a double-clicked Publish is a no-op.
  const [importId, setImportId] = useState<string>('');

  const imports = useQuery({ queryKey: ['admin', 'imports'], queryFn: fetchImports });

  const previewMut = useMutation({
    mutationFn: (f: File) => previewOfferImport(f),
    onSuccess: (p) => {
      setPreview(p);
      setPublished(null);
      setNotified(null);
      setImportId(newId());
    },
  });

  const publishMut = useMutation({
    mutationFn: () => publishOfferImport(file!, importId, preview!.fileHash),
    onSuccess: (r) => {
      setPublished(r);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  const notifyMut = useMutation({
    mutationFn: () => notifyImport(published!.importId),
    onSuccess: (r) => {
      setNotified(r);
      void qc.invalidateQueries({ queryKey: ['admin', 'imports'] });
    },
  });

  function choose(f: File | null) {
    setFile(f);
    setPreview(null);
    setPublished(null);
    setNotified(null);
    if (f) previewMut.mutate(f);
  }

  const unreadable = preview !== null && preview.fatal.length > 0;
  const blocked = preview !== null && preview.errorCount > 0;
  const nothingToDo = preview !== null && preview.changedRows.length === 0;

  return (
    <section>
      <div className="rule-b pb-6 mb-6">
        <p className="smallcaps text-muted mb-3">1 &middot; Download</p>
        <p className="text-sm text-muted mb-4">
          The template comes prefilled with everyone&rsquo;s current values, so
          a file you download and re-upload unchanged makes no changes at all.
          Edit only the cells you mean to change.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <a className="btn btn-primary no-underline" href={offerTemplateUrl('xlsx')}>
            Download Excel
          </a>
          <a className="btn btn-ghost no-underline" href={offerTemplateUrl('csv')}>
            Download CSV
          </a>
        </div>
        <p className="text-sm text-muted mt-3 italic">
          The Excel file opens on an Instructions sheet explaining each column
          &mdash; edit the <span className="not-italic">offers</span> sheet
          beside it. The CSV carries the same guidance in a{' '}
          <span className="not-italic">#</span> row, which the importer ignores.
        </p>
      </div>

      <div className="rule-b pb-6 mb-6">
        <p className="smallcaps text-muted mb-3">2 &middot; Upload &amp; review</p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="field-input"
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
        {previewMut.isPending ? (
          <p className="text-muted mt-3">Reading {file?.name}…</p>
        ) : null}
        {previewMut.error ? (
          <p className="text-accent mt-3">{errorText(previewMut.error)}</p>
        ) : null}
      </div>

      {preview ? <ImportPreviewTable preview={preview} /> : null}

      {preview && !unreadable && !published ? (
        <div className="rule-t pt-6 mt-6">
          <p className="smallcaps text-muted mb-3">3 &middot; Publish</p>
          {blocked ? (
            <p className="text-muted mb-4">
              Fix the {preview.errorCount} error
              {preview.errorCount === 1 ? '' : 's'} above, then upload the file
              again. Nothing is written until every row is clean.
            </p>
          ) : nothingToDo ? (
            <p className="text-muted mb-4">
              There is nothing to publish from this file.
            </p>
          ) : (
            <p className="text-muted mb-4">
              This writes {preview.changedRows.length} change
              {preview.changedRows.length === 1 ? '' : 's'}. Families are{' '}
              <em>not</em> emailed yet &mdash; that is the next step.
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={blocked || nothingToDo || publishMut.isPending}
            onClick={() => publishMut.mutate()}
          >
            {publishMut.isPending
              ? 'Publishing…'
              : `Publish ${preview.changedRows.length} change${preview.changedRows.length === 1 ? '' : 's'}`}
          </button>
          {publishMut.error ? (
            <p className="text-accent mt-3">{errorText(publishMut.error)}</p>
          ) : null}
        </div>
      ) : null}

      {published ? (
        <div className="rule-t pt-6 mt-6">
          <p className="smallcaps text-muted mb-3">4 &middot; Notify</p>
          <p className="text-ink mb-2">
            Published {published.applied} change
            {published.applied === 1 ? '' : 's'}
            {published.alreadyPublished ? ' (already applied earlier)' : ''}.
          </p>
          {notified ? (
            <div className="text-sm text-muted">
              <p className="mb-2">
                Sent {notified.sent} email{notified.sent === 1 ? '' : 's'}
                {notified.skipped > 0 ? `, ${notified.skipped} failed` : ''}.
              </p>
              <details>
                <summary className="cursor-pointer">Recipients</summary>
                <ul className="mt-2 space-y-1">
                  {notified.recipients.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            <>
              <p className="text-muted mb-4">
                This emails the student <em>and</em> the parent or guardian for
                each of the {published.changedAppIds.length} changed profile
                {published.changedAppIds.length === 1 ? '' : 's'}, telling them
                to check the portal. The email does not name the decision.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={notifyMut.isPending || published.changedAppIds.length === 0}
                onClick={() => notifyMut.mutate()}
              >
                {notifyMut.isPending
                  ? 'Sending…'
                  : `Notify ${published.changedAppIds.length} famil${published.changedAppIds.length === 1 ? 'y' : 'ies'}`}
              </button>
              {notifyMut.error ? (
                <p className="text-accent mt-3">{errorText(notifyMut.error)}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {imports.data && imports.data.length > 0 ? (
        <div className="rule-t pt-6 mt-10">
          <p className="smallcaps text-muted mb-4">Recent imports</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="rule-b">
                <th className="text-left font-normal smallcaps text-muted pb-2">When</th>
                <th className="text-left font-normal smallcaps text-muted pb-2">File</th>
                <th className="text-left font-normal smallcaps text-muted pb-2">Changed</th>
                <th className="text-left font-normal smallcaps text-muted pb-2">Notified</th>
              </tr>
            </thead>
            <tbody>
              {imports.data.map((r) => (
                <tr key={r.id} className="border-b border-rule/60">
                  <td className="py-2 text-muted">
                    {new Date(r.createdAt * 1000).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="py-2 text-ink">{r.filename}</td>
                  <td className="py-2 tabular-nums">{r.changedCount}</td>
                  <td className="py-2 text-muted">
                    {r.notifiedAt ? `${r.notifiedCount ?? 0} sent` : 'not yet'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; error?: string } | null;
    return body?.message ?? body?.error ?? `Request failed (${err.status}).`;
  }
  return 'Something went wrong.';
}
