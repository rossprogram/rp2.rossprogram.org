import type { ImportPreview, ImportRow } from '../../api/client';
import { money } from '../offer/OfferTerms';

/*
 * The preview: errors first, then warnings, then the changes about to be
 * applied. The column legend at the top is load-bearing, not decoration — it
 * is where an admin learns that a column they deleted will be left alone and
 * an emptied cell will be cleared.
 */
export function ImportPreviewTable({ preview }: { preview: ImportPreview }) {
  if (preview.fatal.length > 0) {
    return (
      <div className="rule-t rule-b py-5 my-6">
        <p className="smallcaps text-accent mb-3">This file cannot be read</p>
        <ul className="text-sm text-ink space-y-1">
          {preview.fatal.map((f, i) => (
            <li key={i}>{f.message}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="my-6">
      <ColumnLegend preview={preview} />

      <div className="rule-t py-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <Stat n={preview.rowCount} label="rows read" />
        <Stat n={preview.changedRows.length} label="to change" accent />
        <Stat n={preview.unchangedCount} label="unchanged" />
        <Stat n={preview.errorRows.length} label="with errors" />
      </div>

      {preview.errorRows.length > 0 ? (
        <IssueBlock
          title="Errors — these must be fixed before publishing"
          rows={preview.errorRows}
          kind="errors"
        />
      ) : null}

      {preview.warningRows.length > 0 ? (
        <IssueBlock
          title="Warnings — publishing is still allowed"
          rows={preview.warningRows}
          kind="warnings"
        />
      ) : null}

      {preview.changedRows.length > 0 ? (
        <div className="rule-t pt-5 mt-6">
          <p className="smallcaps text-muted mb-4">
            {preview.changedRows.length} profile
            {preview.changedRows.length === 1 ? '' : 's'} will change
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="rule-b">
                <th className="text-left font-normal smallcaps text-muted pb-2">Row</th>
                <th className="text-left font-normal smallcaps text-muted pb-2">Applicant</th>
                <th className="text-left font-normal smallcaps text-muted pb-2">Changes</th>
              </tr>
            </thead>
            <tbody>
              {preview.changedRows.map((r) => (
                <tr key={r.appId} className="border-b border-rule/60 align-top">
                  <td className="py-3 pr-4 tabular-nums text-muted">{r.row}</td>
                  <td className="py-3 pr-4">
                    <div className="text-ink">{r.studentName ?? '(no name)'}</div>
                    <div className="text-xs text-muted">{r.studentEmail}</div>
                  </td>
                  <td className="py-3">
                    <ul className="space-y-1">
                      {r.changes.map((c, i) => (
                        <li key={i}>
                          <span className="smallcaps text-muted">{c.column}</span>{' '}
                          <span className="text-muted">
                            {display(c.column, c.before)}
                          </span>
                          <span className="text-muted"> → </span>
                          <span className="text-ink">{display(c.column, c.after)}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rule-t pt-5 mt-6 text-muted italic">
          Nothing in this file differs from what we already have.
        </p>
      )}
    </div>
  );
}

function ColumnLegend({ preview }: { preview: ImportPreview }) {
  return (
    <div className="rule-t rule-b py-4 text-sm space-y-2">
      <p>
        <span className="smallcaps text-muted">Applying</span>{' '}
        <span className="text-ink">
          {preview.appliedColumns.length > 0
            ? preview.appliedColumns.join(', ')
            : 'nothing — no editable columns found'}
        </span>
      </p>
      {preview.absentColumns.length > 0 ? (
        <p>
          <span className="smallcaps text-muted">Not in this file</span>{' '}
          <span className="text-muted">{preview.absentColumns.join(', ')}</span>{' '}
          <span className="text-muted italic">— left untouched on every row.</span>
        </p>
      ) : null}
      {preview.unknownColumns.length > 0 ? (
        <p>
          <span className="smallcaps text-muted">Ignoring</span>{' '}
          <span className="text-muted">{preview.unknownColumns.join(', ')}</span>
        </p>
      ) : null}
      <p className="text-muted italic pt-1">
        An empty cell in a column that <em>is</em> present clears that field.
      </p>
    </div>
  );
}

function IssueBlock({
  title,
  rows,
  kind,
}: {
  title: string;
  rows: ImportRow[];
  kind: 'errors' | 'warnings';
}) {
  return (
    <div className="rule-t pt-5 mt-6">
      <p className="smallcaps text-muted mb-4">{title}</p>
      <ul className="space-y-3 text-sm">
        {rows.map((r) =>
          r[kind].map((issue, i) => (
            <li key={`${r.appId}-${kind}-${i}`} className="flex gap-3">
              <span className="tabular-nums text-muted shrink-0">
                Row {issue.row}
              </span>
              <span>
                {issue.column ? (
                  <span className="smallcaps text-muted mr-2">{issue.column}</span>
                ) : null}
                <span className={kind === 'errors' ? 'text-ink' : 'text-muted'}>
                  {issue.message}
                </span>
              </span>
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <span>
      <span className={`tabular-nums ${accent && n > 0 ? 'text-accent' : 'text-ink'}`}>
        {n}
      </span>{' '}
      <span className="text-muted">{label}</span>
    </span>
  );
}

/** Money columns arrive as integer cents; render them as dollars. */
function display(column: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if ((column === 'aid_amount' || column === 'amount_due') && typeof v === 'number') {
    return money(v);
  }
  return String(v);
}
