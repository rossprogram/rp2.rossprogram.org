/*
 * The signing panel.
 *
 * The case that matters is the one a real guardian got stuck on: she signed
 * the Code of Conduct, the panel left it expanded with a signed confirmation,
 * and the document she still owed sat collapsed below a screenful of text. She
 * stopped there. The panel must follow the remaining work.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgreementEnvelope, AgreementDoc } from '../src/api/client';
import { AgreementPanel } from '../src/features/agreements/AgreementPanel';

const CONDUCT: AgreementDoc = {
  key: 'code_of_conduct',
  version: '2026-09-21',
  title: 'Code of Conduct',
  signers: ['student', 'guardian'],
  signatureLabel: { student: 'Acknowledged', guardian: 'Acknowledged' },
  collectsGuardianContact: false,
  sections: [{ heading: null, blocks: [{ kind: 'p', text: 'Be kind.' }] }],
};

const PARTICIPATION: AgreementDoc = {
  key: 'participation_agreement',
  version: '2026-09-04',
  title: 'Program Participation Agreement',
  signers: ['guardian', 'student'],
  signatureLabel: { guardian: 'Signed', student: 'Acknowledged' },
  collectsGuardianContact: true,
  sections: [{ heading: null, blocks: [{ kind: 'p', text: 'Permission granted.' }] }],
};

function env(over: Partial<AgreementEnvelope> = {}): AgreementEnvelope {
  return {
    applicationId: 'app1',
    documents: [CONDUCT, PARTICIPATION],
    signatures: [],
    outstanding: [],
    fullySigned: false,
    guardianContact: null,
    enrolled: true,
    studentName: 'Bryan',
    studentLegalName: 'Bryan Ning',
    guardianName: 'Allison Ning',
    viewer: 'guardian',
    mine: [],
    theirs: [],
    ...over,
  };
}

function renderPanel(e: AgreementEnvelope) {
  return render(
    <AgreementPanel
      env={e}
      defaultEmail="allison@example.com"
      pendingDocument={null}
      errorFor={() => null}
      onSign={vi.fn()}
    />,
  );
}

/** Which document is expanded — the one showing a Hide button. */
function expandedDoc(): string | null {
  const hide = screen.queryAllByRole('button', { name: /hide/i })[0];
  if (!hide) return null;
  return hide.closest('div')?.querySelector('h3')?.textContent ?? null;
}

describe('which document is open', () => {
  it('opens the first one the viewer still owes', () => {
    renderPanel(
      env({
        mine: [
          { document: 'code_of_conduct', signerKind: 'guardian' },
          { document: 'participation_agreement', signerKind: 'guardian' },
        ],
      }),
    );
    expect(expandedDoc()).toBe('Code of Conduct');
  });

  /*
   * The regression. After the first signature lands the envelope changes, and
   * the panel must move on rather than sit on the finished document.
   */
  it('advances to the next document once the first is signed', () => {
    const before = env({
      mine: [
        { document: 'code_of_conduct', signerKind: 'guardian' },
        { document: 'participation_agreement', signerKind: 'guardian' },
      ],
    });
    const { rerender } = renderPanel(before);
    expect(expandedDoc()).toBe('Code of Conduct');

    // The Code of Conduct comes back signed; only the agreement is left.
    const after = env({
      mine: [{ document: 'participation_agreement', signerKind: 'guardian' }],
      signatures: [
        {
          document: 'code_of_conduct',
          signerKind: 'guardian',
          typedName: 'Allison Hu',
          signedAt: 1_790_000_000,
          documentVersion: '2026-09-21',
          stale: false,
        },
      ],
    });
    rerender(
      <AgreementPanel
        env={after}
        defaultEmail="allison@example.com"
        pendingDocument={null}
        errorFor={() => null}
        onSign={vi.fn()}
      />,
    );

    expect(expandedDoc()).toBe('Program Participation Agreement');
    // And the signed one is collapsed, offering a re-read rather than a signature.
    expect(screen.getByRole('button', { name: /read again/i })).toBeTruthy();
  });

  it('still lets someone open a document by hand', async () => {
    const user = userEvent.setup();
    renderPanel(
      env({
        mine: [
          { document: 'code_of_conduct', signerKind: 'guardian' },
          { document: 'participation_agreement', signerKind: 'guardian' },
        ],
      }),
    );
    expect(expandedDoc()).toBe('Code of Conduct');

    // The heading and its button are siblings inside the row's flex wrapper.
    const agreementRow =
      screen.getByText('Program Participation Agreement').closest('div')!.parentElement!;
    await user.click(within(agreementRow).getByRole('button', { name: /read and sign/i }));

    expect(expandedDoc()).toBe('Program Participation Agreement');
  });

  it('opens nothing once the viewer owes nothing', () => {
    renderPanel(env({ mine: [], theirs: [], fullySigned: true }));
    expect(expandedDoc()).toBeNull();
    expect(screen.getByText(/both signatures are in/i)).toBeTruthy();
  });
});

describe('the guardian contact block', () => {
  /*
   * The only place the program ever collects a guardian phone number, so the
   * signature cannot be given without one.
   */
  it('will not enable Sign until a phone number is entered', async () => {
    const user = userEvent.setup();
    renderPanel(env({ mine: [{ document: 'participation_agreement', signerKind: 'guardian' }] }));

    const sign = screen.getByRole('button', { name: /^sign$/i });
    expect((sign as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByPlaceholderText('Type your full name'), 'Allison Hu');
    expect((sign as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByPlaceholderText('+1 555 555 0100'), '555 0100');
    expect((sign as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not ask a student for contact details', () => {
    renderPanel(
      env({
        viewer: 'student',
        mine: [{ document: 'participation_agreement', signerKind: 'student' }],
      }),
    );
    expect(screen.queryByPlaceholderText('+1 555 555 0100')).toBeNull();
  });
});

/*
 * The wrong person at the keyboard.
 *
 * The participation agreement is written in the guardian's voice, and the
 * participant's acknowledgement sits directly beneath it. A parent reading it
 * over the student's shoulder, on the student's logged-in browser, types their
 * own name into the student's box — nine enrolled families did. The server
 * refuses it now; the panel has to say so while they are still looking at the
 * field, and say whose line it is before they start typing.
 */
describe('signing as the wrong person', () => {
  function studentSigning(over: Partial<AgreementEnvelope> = {}) {
    return env({
      viewer: 'student',
      mine: [{ document: 'participation_agreement', signerKind: 'student' }],
      ...over,
    });
  }

  function signButton() {
    return screen.getByRole('button', { name: /^sign$/i }) as HTMLButtonElement;
  }

  it('says whose line this is', () => {
    renderPanel(studentSigning());
    expect(screen.getByText(/this line is for/i)).toHaveTextContent(
      /Bryan Ning.*participant/i,
    );
  });

  it('blocks the guardian’s name and explains where they sign instead', async () => {
    const user = userEvent.setup();
    renderPanel(studentSigning());

    await user.type(screen.getByPlaceholderText('Type your full name'), 'Allison Ning');

    expect(signButton().disabled).toBe(true);
    expect(screen.getByText(/this line is the participant’s/i)).toBeInTheDocument();
    expect(screen.getByText(/from their own portal/i)).toBeInTheDocument();
  });

  it('recognises the name however it is spelled', async () => {
    const user = userEvent.setup();
    renderPanel(studentSigning());

    const box = screen.getByPlaceholderText('Type your full name');
    for (const typed of ['allison ning', 'Ning Allison', 'AllisonNing']) {
      await user.clear(box);
      await user.type(box, typed);
      expect(signButton().disabled, typed).toBe(true);
    }
  });

  it('lets the student sign their own name', async () => {
    const user = userEvent.setup();
    renderPanel(studentSigning());

    await user.type(screen.getByPlaceholderText('Type your full name'), 'Bryan Ning');
    expect(signButton().disabled).toBe(false);
  });

  it('blocks the student’s name on the guardian’s line too', async () => {
    const user = userEvent.setup();
    renderPanel(
      env({
        viewer: 'guardian',
        mine: [{ document: 'code_of_conduct', signerKind: 'guardian' }],
      }),
    );

    await user.type(screen.getByPlaceholderText('Type your full name'), 'Bryan Ning');
    expect(signButton().disabled).toBe(true);
    expect(screen.getByText(/this line is the parent or guardian’s/i)).toBeInTheDocument();
  });

  /*
   * A family recorded under one name on the application has nothing to tell
   * apart, and must not be locked out of signing at all.
   */
  it('does not lock out a family recorded under one name', async () => {
    const user = userEvent.setup();
    renderPanel(studentSigning({ guardianName: 'Bryan Ning' }));

    await user.type(screen.getByPlaceholderText('Type your full name'), 'Bryan Ning');
    expect(signButton().disabled).toBe(false);
  });
});
