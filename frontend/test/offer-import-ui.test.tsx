/*
 * The admin import UI. A mistake here lands on every family at once, so the
 * guards under test are: publish is impossible while any row errors, the
 * blank-cell rule is stated where the decision is made, and publishing never
 * emails anyone by itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ImportPreview, ImportRow } from '../src/api/client';

const previewOfferImport = vi.fn();
const publishOfferImport = vi.fn();
const notifyImport = vi.fn();
const fetchImports = vi.fn();

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>();
  return {
    ...actual,
    previewOfferImport: (...a: unknown[]) => previewOfferImport(...a),
    publishOfferImport: (...a: unknown[]) => publishOfferImport(...a),
    notifyImport: (...a: unknown[]) => notifyImport(...a),
    fetchImports: (...a: unknown[]) => fetchImports(...a),
  };
});

const { OfferImport } = await import('../src/features/admin/OfferImport');

function row(over: Partial<ImportRow> = {}): ImportRow {
  return {
    row: 2,
    appId: 'app1',
    studentName: 'Ada Lovelace',
    studentEmail: 'ada@example.com',
    currentStatus: 'submitted',
    changes: [],
    errors: [],
    warnings: [],
    ...over,
  };
}

function preview(over: Partial<ImportPreview> = {}): ImportPreview {
  return {
    fileHash: 'hash123',
    filename: 'offers.csv',
    rowCount: 1,
    appliedColumns: ['status', 'course'],
    absentColumns: ['notes', 'schedule'],
    unknownColumns: [],
    changedRows: [],
    errorRows: [],
    warningRows: [],
    unchangedCount: 0,
    errorCount: 0,
    fatal: [],
    ...over,
  };
}

const CHANGED = row({
  changes: [
    { field: 'status', column: 'status', before: 'submitted', after: 'accepted' },
    { field: 'amountDueCents', column: 'amount_due', before: 0, after: 75_000 },
  ],
});

function renderUI() {
  fetchImports.mockResolvedValue([]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <OfferImport />
    </QueryClientProvider>,
  );
}

async function upload(p: ImportPreview) {
  previewOfferImport.mockResolvedValue(p);
  const user = userEvent.setup();
  renderUI();
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  await user.upload(input, new File(['a,b\n1,2'], 'offers.csv', { type: 'text/csv' }));
  await waitFor(() => expect(previewOfferImport).toHaveBeenCalled());
  return user;
}

beforeEach(() => vi.clearAllMocks());

describe('before a file is chosen', () => {
  it('offers both template formats, recommending Excel', async () => {
    renderUI();
    const excel = screen.getByRole('link', { name: /download excel/i });
    expect(excel).toHaveAttribute('href', expect.stringContaining('format=xlsx'));
    expect(screen.getByRole('link', { name: /download csv/i })).toHaveAttribute(
      'href',
      expect.stringContaining('format=csv'),
    );
    // Excel is the primary action because only it carries the instructions sheet.
    expect(excel.className).toContain('btn-primary');
  });

  it('says an unchanged re-upload is a no-op, so trying it feels safe', () => {
    renderUI();
    expect(screen.getByText(/re-upload unchanged makes no changes/i)).toBeInTheDocument();
  });
});

describe('the preview legend', () => {
  it('states the blank-cell rule where the decision is being made', async () => {
    await upload(preview({ changedRows: [CHANGED] }));
    expect(await screen.findByText(/clears that field/i)).toBeInTheDocument();
  });

  it('names the columns it will write and the ones it will not touch', async () => {
    await upload(preview({ changedRows: [CHANGED] }));
    expect(await screen.findByText('status, course')).toBeInTheDocument();
    expect(screen.getByText('notes, schedule')).toBeInTheDocument();
    expect(screen.getByText(/left untouched on every row/i)).toBeInTheDocument();
  });

  it('reports ignored columns without making them look like errors', async () => {
    await upload(
      preview({ changedRows: [CHANGED], unknownColumns: ['reviewer_initials'] }),
    );
    expect(await screen.findByText('reviewer_initials')).toBeInTheDocument();
  });
});

describe('the diff', () => {
  it('shows each change as before to after, with money as dollars', async () => {
    await upload(preview({ changedRows: [CHANGED] }));
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('submitted')).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();
    // Integer cents must never reach the admin's eyes as 75000.
    expect(screen.getByText('$750')).toBeInTheDocument();
    expect(screen.queryByText('75000')).not.toBeInTheDocument();
  });

  it('says plainly when a file changes nothing', async () => {
    await upload(preview({ unchangedCount: 3, rowCount: 3 }));
    expect(
      await screen.findByText(/nothing in this file differs from what we already have/i),
    ).toBeInTheDocument();
  });
});

describe('publishing', () => {
  it('is blocked while any row has an error', async () => {
    await upload(
      preview({
        errorCount: 1,
        errorRows: [
          row({
            errors: [
              { row: 2, column: 'course', code: 'unknown_course', message: '"algebra" is not a course.' },
            ],
          }),
        ],
      }),
    );

    expect(await screen.findByText(/"algebra" is not a course/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled();
    expect(screen.getByText(/nothing is written until every row is clean/i)).toBeInTheDocument();
  });

  it('is blocked when the file cannot be read at all', async () => {
    await upload(
      preview({
        fatal: [
          { row: 1, column: 'app_id', code: 'missing_key_column', message: 'The sheet has no app_id column.' },
        ],
      }),
    );
    expect(await screen.findByText(/no app_id column/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  // Warnings inform; they must never stop the work.
  it('is allowed despite warnings', async () => {
    await upload(
      preview({
        changedRows: [CHANGED],
        warningRows: [
          row({
            warnings: [
              { row: 2, column: null, code: 'rewrites_answered_offer', message: 'This family already accepted their offer; this rewrites it.' },
            ],
          }),
        ],
      }),
    );
    expect(await screen.findByText(/already accepted their offer/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish/i })).toBeEnabled();
  });

  it('sends the previewed hash so a swapped file is caught', async () => {
    const user = await upload(preview({ changedRows: [CHANGED] }));
    publishOfferImport.mockResolvedValue({
      importId: 'imp1', applied: 1, changedAppIds: ['app1'], alreadyPublished: false,
    });

    await user.click(await screen.findByRole('button', { name: /publish 1 change/i }));
    await waitFor(() => expect(publishOfferImport).toHaveBeenCalled());
    expect(publishOfferImport.mock.calls[0]![2]).toBe('hash123');
  });

  it('reuses one import id, so a double click cannot publish twice', async () => {
    const user = await upload(preview({ changedRows: [CHANGED] }));
    publishOfferImport.mockResolvedValue({
      importId: 'imp1', applied: 1, changedAppIds: ['app1'], alreadyPublished: false,
    });
    const btn = await screen.findByRole('button', { name: /publish 1 change/i });
    await user.click(btn);
    await waitFor(() => expect(publishOfferImport).toHaveBeenCalled());
    const firstId = publishOfferImport.mock.calls[0]![1];
    expect(typeof firstId).toBe('string');
    expect((firstId as string).length).toBeGreaterThanOrEqual(8);
  });
});

describe('notifying', () => {
  async function publishThen() {
    const user = await upload(preview({ changedRows: [CHANGED] }));
    publishOfferImport.mockResolvedValue({
      importId: 'imp1', applied: 1, changedAppIds: ['app1'], alreadyPublished: false,
    });
    await user.click(await screen.findByRole('button', { name: /publish 1 change/i }));
    return user;
  }

  // The whole reason publish and notify are separate steps.
  it('does not email anyone as part of publishing', async () => {
    await publishThen();
    await screen.findByText(/published 1 change/i);
    expect(notifyImport).not.toHaveBeenCalled();
    // Sending is a distinct action still waiting to be taken.
    expect(screen.getByRole('button', { name: /notify 1 family/i })).toBeInTheDocument();
  });

  it('tells you before publishing that nobody will be emailed yet', async () => {
    await upload(preview({ changedRows: [CHANGED] }));
    // Split across an <em>, so match on the element's whole text.
    const note = await screen.findByText((_t, el) =>
      el?.tagName === 'P' && /Families are\s*not\s*emailed yet/i.test(el.textContent ?? ''),
    );
    expect(note).toBeInTheDocument();
  });

  it('explains who gets mail, and that it does not name the decision', async () => {
    await publishThen();
    expect(await screen.findByText(/student/i)).toBeInTheDocument();
    expect(screen.getByText(/does not name the decision/i)).toBeInTheDocument();
  });

  it('sends only when asked, then reports the recipients', async () => {
    const user = await publishThen();
    notifyImport.mockResolvedValue({
      sent: 2, skipped: 0, recipients: ['ada@example.com', 'parent@example.com'],
    });

    await user.click(await screen.findByRole('button', { name: /notify 1 family/i }));
    await waitFor(() => expect(notifyImport).toHaveBeenCalledWith('imp1'));
    expect(await screen.findByText(/sent 2 emails/i)).toBeInTheDocument();
  });

  it('surfaces failed sends rather than reporting success', async () => {
    const user = await publishThen();
    notifyImport.mockResolvedValue({ sent: 1, skipped: 1, recipients: ['ada@example.com'] });
    await user.click(await screen.findByRole('button', { name: /notify 1 family/i }));
    expect(await screen.findByText(/1 failed/i)).toBeInTheDocument();
  });
});
