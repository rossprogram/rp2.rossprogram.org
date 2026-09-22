/*
 * The admin onboarding board.
 *
 * The button on this page emails the families of minors, so the guards under
 * test are: nothing sends without a preview first, the preview is what the
 * send is based on, an empty selection means EVERYONE (the easiest thing to
 * get wrong), and a guardian who has never logged in is called out rather than
 * buried — a reminder about signing is useless to someone who cannot reach the
 * portal at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OnboardingList, ReconcileResult } from '../src/api/client';

const fetchOnboarding = vi.fn();
const sendReminders = vi.fn();
const reconcileDiscord = vi.fn();
const voidSignature = vi.fn();

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>();
  return {
    ...actual,
    fetchOnboarding: (...a: unknown[]) => fetchOnboarding(...a),
    sendReminders: (...a: unknown[]) => sendReminders(...a),
    reconcileDiscord: (...a: unknown[]) => reconcileDiscord(...a),
    voidSignature: (...a: unknown[]) => voidSignature(...a),
  };
});

const { OnboardingBoard } = await import('../src/features/admin/OnboardingBoard');
const { DiscordPanel } = await import('../src/features/admin/DiscordPanel');

const DOCS = [
  { key: 'code_of_conduct', title: 'Code of Conduct', version: '2026-09-21' },
  { key: 'participation_agreement', title: 'Program Participation Agreement', version: '2026-09-04' },
];

function list(over: Partial<OnboardingList> = {}): OnboardingList {
  return {
    documents: DOCS,
    outstandingCount: 2,
    neverLoggedIn: 1,
    families: [
      {
        applicationId: 'app1',
        studentName: 'Ada Lovelace',
        studentEmail: 'ada@example.com',
        guardianEmail: 'parent@example.com',
        guardianAccepted: true,
        outstanding: [{ document: 'code_of_conduct', signerKind: 'guardian' }],
      },
      {
        applicationId: 'app2',
        studentName: 'Alan Turing',
        studentEmail: 'alan@example.com',
        guardianEmail: 'mum@example.com',
        guardianAccepted: false,
        outstanding: [
          { document: 'code_of_conduct', signerKind: 'student' },
          { document: 'participation_agreement', signerKind: 'guardian' },
        ],
      },
    ],
    suspect: [],
    voids: [],
    ...over,
  };
}

function renderBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <OnboardingBoard />
    </QueryClientProvider>,
  );
}

function renderDiscord() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <DiscordPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('the chase list', () => {
  /*
   * One column per document, and the cell says WHO still owes it. Ada has
   * signed her own half, so her Code of Conduct cell reads 'guardian'; Alan
   * has signed neither document, so his reads 'both'.
   */
  it('shows, per document, which party still owes it', async () => {
    fetchOnboarding.mockResolvedValue(
      list({
        families: [
          {
            applicationId: 'app1',
            studentName: 'Ada Lovelace',
            studentEmail: 'ada@example.com',
            guardianEmail: 'parent@example.com',
            guardianAccepted: true,
            outstanding: [{ document: 'code_of_conduct', signerKind: 'guardian' }],
          },
          {
            applicationId: 'app2',
            studentName: 'Alan Turing',
            studentEmail: 'alan@example.com',
            guardianEmail: 'mum@example.com',
            guardianAccepted: false,
            outstanding: [
              { document: 'code_of_conduct', signerKind: 'student' },
              { document: 'code_of_conduct', signerKind: 'guardian' },
            ],
          },
        ],
      }),
    );
    renderBoard();

    const adaCells = (await screen.findByText('Ada Lovelace')).closest('tr')!.querySelectorAll('td');
    expect(adaCells[2]!.textContent).toBe('guardian');
    // Nobody owes the participation agreement, so that cell is empty.
    expect(adaCells[3]!.textContent).toBe('—');

    const alanCells = screen.getByText('Alan Turing').closest('tr')!.querySelectorAll('td');
    expect(alanCells[2]!.textContent).toBe('both');
  });

  it('calls out a guardian who has never logged in', async () => {
    fetchOnboarding.mockResolvedValue(list());
    renderBoard();

    // Once in the summary above the table...
    await screen.findByText('Ada Lovelace');
    expect(screen.getByText(/1 of them have a guardian who has/i)).toBeTruthy();
    // ...and again on the row it applies to, beside that guardian's address.
    const alanRow = screen.getByText('Alan Turing').closest('tr')!;
    expect(alanRow.textContent).toContain('never logged in');
    // Ada's guardian has logged in, so her row carries no such flag.
    const adaRow = screen.getByText('Ada Lovelace').closest('tr')!;
    expect(adaRow.textContent).not.toContain('never logged in');
  });

  it('says so when nothing is outstanding', async () => {
    fetchOnboarding.mockResolvedValue(list({ outstandingCount: 0, families: [] }));
    renderBoard();
    expect(await screen.findByText(/every enrolled family has signed/i)).toBeTruthy();
  });
});

describe('sending reminders', () => {
  it('offers no send button until a preview has been run', async () => {
    fetchOnboarding.mockResolvedValue(list());
    renderBoard();
    await screen.findByText('Ada Lovelace');

    expect(screen.queryByRole('button', { name: /^send/i })).toBeNull();
  });

  /*
   * An empty selection means everyone outstanding — the API treats a missing
   * id list that way, and the UI must not quietly send to one person while
   * saying "everyone", or vice versa.
   */
  it('sends to everyone outstanding when nothing is selected', async () => {
    fetchOnboarding.mockResolvedValue(list());
    sendReminders.mockResolvedValue({
      dryRun: true,
      families: 2,
      planned: [
        { to: 'ada@example.com', kind: 'student' },
        { to: 'parent@example.com', kind: 'guardian' },
        { to: 'mum@example.com', kind: 'guardian_invite' },
      ],
    });
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Ada Lovelace');

    await user.click(screen.getByRole('button', { name: /preview who gets an email/i }));
    await waitFor(() => expect(sendReminders).toHaveBeenCalled());

    expect(sendReminders).toHaveBeenCalledWith({ dryRun: true });

    // Scope to the preview list — these addresses also appear in the table.
    const plan = (await screen.findByText('portal invite')).closest('ul')!;
    expect(within(plan).getByText('mum@example.com')).toBeTruthy();
    expect(within(plan).getByText('ada@example.com')).toBeTruthy();
    // The invite case is labelled differently from a plain reminder.
    expect(within(plan).getByText('portal invite')).toBeTruthy();
  });

  it('narrows to the selected families', async () => {
    fetchOnboarding.mockResolvedValue(list());
    sendReminders.mockResolvedValue({ dryRun: true, families: 1, planned: [] });
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Ada Lovelace');

    await user.click(screen.getByLabelText('Select Ada Lovelace'));
    await user.click(screen.getByRole('button', { name: /preview who gets an email/i }));
    await waitFor(() => expect(sendReminders).toHaveBeenCalled());

    expect(sendReminders).toHaveBeenCalledWith({ dryRun: true, applicationIds: ['app1'] });
  });

  it('only sends for real after the preview, and reports the result', async () => {
    fetchOnboarding.mockResolvedValue(list());
    sendReminders.mockResolvedValueOnce({
      dryRun: true,
      families: 2,
      planned: [{ to: 'ada@example.com', kind: 'student' }],
    });
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Ada Lovelace');

    await user.click(screen.getByRole('button', { name: /preview who gets an email/i }));
    const send = await screen.findByRole('button', { name: /send 1 email/i });

    sendReminders.mockResolvedValueOnce({
      dryRun: false,
      families: 2,
      sent: 1,
      skipped: 0,
      recipients: ['ada@example.com'],
    });
    await user.click(send);

    await waitFor(() => expect(sendReminders).toHaveBeenLastCalledWith({ dryRun: false }));
    expect(await screen.findByText(/sent 1/i)).toBeTruthy();
  });
});

describe('the Discord panel', () => {
  function report(over: Partial<ReconcileResult> = {}): ReconcileResult {
    return {
      dryRun: true,
      cleared: 3,
      linked: 2,
      rolesCreated: [],
      rolesAdopted: ['Quadratic-Forms-2'],
      rolesMissing: [],
      results: [],
      ...over,
    };
  }

  it('will not apply before a dry run', async () => {
    renderDiscord();
    expect(screen.queryByRole('button', { name: /^apply$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /dry run/i })).toBeTruthy();
  });

  it('runs dry by default and offers Apply afterwards', async () => {
    reconcileDiscord.mockResolvedValue(report());
    const user = userEvent.setup();
    renderDiscord();

    await user.click(screen.getByRole('button', { name: /dry run/i }));
    await waitFor(() => expect(reconcileDiscord).toHaveBeenCalled());

    expect(reconcileDiscord).toHaveBeenCalledWith({ dryRun: true, allowCreate: false });
    expect(await screen.findByText(/nothing was changed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeTruthy();
  });

  /*
   * A missing role means those students cannot be placed at all, and creating
   * one would make a permissionless duplicate of a role that already carries
   * channel permissions. It has to be loud.
   */
  it('surfaces a naming mismatch prominently', async () => {
    reconcileDiscord.mockResolvedValue(
      report({ rolesMissing: ['Point-Set-Topology-1', 'PST-1-Group-2'] }),
    );
    const user = userEvent.setup();
    renderDiscord();

    await user.click(screen.getByRole('button', { name: /dry run/i }));

    expect(await screen.findByText(/do not exist in the guild/i)).toBeTruthy();
    expect(screen.getByText('Point-Set-Topology-1')).toBeTruthy();
    expect(screen.getByText(/nothing was created/i)).toBeTruthy();
  });

  it('does not ask to create roles unless told to', async () => {
    reconcileDiscord.mockResolvedValue(report());
    const user = userEvent.setup();
    renderDiscord();

    await user.click(screen.getByLabelText(/create roles that don/i));
    await user.click(screen.getByRole('button', { name: /dry run/i }));

    expect(reconcileDiscord).toHaveBeenCalledWith({ dryRun: true, allowCreate: true });
  });

  it('explains a switched-off integration rather than showing a raw error', async () => {
    const { ApiError } = await import('../src/api/client');
    reconcileDiscord.mockRejectedValue(new ApiError(503, { error: 'discord_disabled' }));
    const user = userEvent.setup();
    renderDiscord();

    await user.click(screen.getByRole('button', { name: /dry run/i }));
    expect(await screen.findByText(/switched off on the server/i)).toBeTruthy();
  });
});

/*
 * Signatures the wrong person made, and taking one back.
 *
 * These families are not on the chase list — a signature made by the wrong
 * person reads as done, which is exactly why nothing else surfaces them. The
 * section therefore has to survive an empty chase list, and voiding has to be
 * hard enough to be deliberate: it destroys a consent record.
 */
describe('signatures that need a look', () => {
  const SUSPECT = {
    applicationId: 'app9',
    studentName: 'Emya Jain',
    studentEmail: 'student@example.com',
    guardianName: 'Anshu Jain',
    document: 'participation_agreement',
    signerKind: 'student' as const,
    typedName: 'Anshu Jain',
    signedAt: 1_790_090_978,
    signedFromEmail: 'student@example.com',
    reason: 'other_partys_name' as const,
  };

  async function openVoidForm() {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText(/signatures that need a look/i);
    await user.click(screen.getByRole('button', { name: /void this signature/i }));
    return user;
  }

  it('shows a suspect signature even when nothing is outstanding', async () => {
    fetchOnboarding.mockResolvedValue(
      list({ outstandingCount: 0, families: [], suspect: [SUSPECT] }),
    );
    renderBoard();

    await screen.findByText(/nothing outstanding/i);
    expect(screen.getByText(/signatures that need a look/i)).toBeInTheDocument();
    expect(screen.getByText(/Emya Jain/)).toBeInTheDocument();
    expect(screen.getByText(/“Anshu Jain”/)).toBeInTheDocument();
  });

  it('will not void without a reason', async () => {
    fetchOnboarding.mockResolvedValue(list({ suspect: [SUSPECT] }));
    const user = await openVoidForm();

    const confirm = screen.getByRole('button', { name: /^void signature$/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByRole('textbox'), 'too short');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(voidSignature).not.toHaveBeenCalled();
  });

  it('sends the slot and the reason, and nothing else', async () => {
    fetchOnboarding.mockResolvedValue(list({ suspect: [SUSPECT] }));
    voidSignature.mockResolvedValue({ voided: true, outstanding: [], fullySigned: false });
    const user = await openVoidForm();

    await user.type(
      screen.getByRole('textbox'),
      'Parent signed the participant line by mistake; confirmed by email.',
    );
    await user.click(screen.getByRole('button', { name: /^void signature$/i }));

    await waitFor(() => expect(voidSignature).toHaveBeenCalledTimes(1));
    expect(voidSignature).toHaveBeenCalledWith('app9', {
      document: 'participation_agreement',
      signerKind: 'student',
      reason: 'Parent signed the participant line by mistake; confirmed by email.',
    });
  });

  it('says the signature is unchanged when the void fails', async () => {
    fetchOnboarding.mockResolvedValue(list({ suspect: [SUSPECT] }));
    voidSignature.mockRejectedValue(new Error('nope'));
    const user = await openVoidForm();

    await user.type(screen.getByRole('textbox'), 'A reason long enough to pass.');
    await user.click(screen.getByRole('button', { name: /^void signature$/i }));

    expect(await screen.findByText(/the signature is unchanged/i)).toBeInTheDocument();
  });

  it('keeps every void on the page, with who did it and why', async () => {
    fetchOnboarding.mockResolvedValue(
      list({
        outstandingCount: 0,
        families: [],
        voids: [
          {
            applicationId: 'app9',
            studentName: 'Emya Jain',
            document: 'participation_agreement',
            signerKind: 'student',
            typedName: 'Anshu Jain',
            signedAt: 1_790_090_978,
            voidedAt: 1_790_100_000,
            voidedByEmail: 'jim@example.com',
            reason: 'Parent signed the participant line by mistake.',
          },
        ],
      }),
    );
    renderBoard();

    await screen.findByText(/voided signatures/i);
    expect(screen.getByText(/jim@example.com/)).toBeInTheDocument();
    expect(
      screen.getByText(/Parent signed the participant line by mistake\./),
    ).toBeInTheDocument();
  });
});
