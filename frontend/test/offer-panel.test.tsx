/*
 * OfferPanel is the one screen a family acts on, and it renders five mutually
 * exclusive states from a single envelope. These tests pin the state machine:
 * which state shows the buttons, which hides them, and what the confirmation
 * step commits the family to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OfferEnvelope, OfferView } from '../src/api/client';

const fetchOffer = vi.fn();
const respondToOffer = vi.fn();
const createCheckoutSession = vi.fn();

vi.mock('../src/api/client', async (orig) => {
  const actual = await orig<typeof import('../src/api/client')>();
  return {
    ...actual,
    fetchOffer: (...a: unknown[]) => fetchOffer(...a),
    respondToOffer: (...a: unknown[]) => respondToOffer(...a),
    createCheckoutSession: (...a: unknown[]) => createCheckoutSession(...a),
  };
});

const { OfferPanel } = await import('../src/features/offer/OfferPanel');

function offer(over: Partial<OfferView> = {}): OfferView {
  return {
    courseKey: 'topology',
    courseLabel: 'Point-Set Topology',
    section: 'TOPOLOGY-2',
    cohort: '5',
    problemSession: 'Sun 09:00',
    officeHours: 'Sat 09:00',
    tuitionCents: 150_000,
    aidAmountCents: 75_000,
    amountDueCents: 75_000,
    enrollmentDeadline: '2026-09-19',
    notes: null,
    response: null,
    respondedAt: null,
    respondedByKind: null,
    paidCents: 0,
    pastDeadline: false,
    paymentsEnabled: true,
    ...over,
  };
}

function envelope(over: Partial<OfferEnvelope> = {}): OfferEnvelope {
  return {
    applicationId: 'app1',
    status: 'accepted',
    actorKind: 'student',
    studentName: 'Ada Lovelace',
    offer: offer(),
    ...over,
  };
}

function renderPanel(env: OfferEnvelope) {
  fetchOffer.mockResolvedValue(env);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <OfferPanel appId="app1" />
    </QueryClientProvider>,
  );
}

/**
 * jsdom cannot navigate, and stubbing window.location leaks between tests, so
 * rebuild it fresh each time. Returns the assign spy for redirect assertions.
 */
let assign: ReturnType<typeof vi.fn>;

function setUrl(search = ''): void {
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: `http://localhost/status${search}`, pathname: '/status', search, assign },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setUrl();
});

describe('when there is nothing to show', () => {
  it('renders nothing at all, so host pages can mount it unconditionally', async () => {
    const { container } = renderPanel(envelope({ offer: null, status: 'submitted' }));
    await waitFor(() => expect(fetchOffer).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('an offer awaiting an answer', () => {
  it('shows the terms and both buttons', async () => {
    renderPanel(envelope());
    expect(await screen.findByText('Point-Set Topology')).toBeInTheDocument();
    expect(screen.getByText('TOPOLOGY-2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Sun 09:00')).toBeInTheDocument();
    expect(screen.getByText('Sat 09:00')).toBeInTheDocument();
    expect(screen.getByText(/times are shown in your own local time/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept the offer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
  });

  it('shows the full arithmetic: tuition minus aid equals balance', async () => {
    renderPanel(envelope());
    expect(await screen.findByText('$1,500')).toBeInTheDocument();
    expect(screen.getByText('−$750')).toBeInTheDocument();
    expect(screen.getByText('Amount due')).toBeInTheDocument();
  });

  // A single click must not commit a family to a seat.
  it('requires a confirmation step before accepting', async () => {
    const user = userEvent.setup();
    renderPanel(envelope());
    await user.click(await screen.findByRole('button', { name: /accept the offer/i }));

    expect(respondToOffer).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /yes, accept/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /yes, accept/i }));
    await waitFor(() => expect(respondToOffer).toHaveBeenCalledWith('app1', 'accept'));
  });

  it('lets the family back out of the confirmation', async () => {
    const user = userEvent.setup();
    renderPanel(envelope());
    await user.click(await screen.findByRole('button', { name: /accept the offer/i }));
    await user.click(screen.getByRole('button', { name: /not yet/i }));

    expect(respondToOffer).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /accept the offer/i })).toBeInTheDocument();
  });

  it('warns that declining releases the seat, and needs confirming', async () => {
    const user = userEvent.setup();
    renderPanel(envelope());
    await user.click(await screen.findByRole('button', { name: /^decline$/i }));

    expect(screen.getByText(/releases the seat to another applicant/i)).toBeInTheDocument();
    expect(respondToOffer).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /yes, decline/i }));
    await waitFor(() => expect(respondToOffer).toHaveBeenCalledWith('app1', 'decline'));
  });
});

describe('a full scholarship', () => {
  const freeRide = envelope({
    offer: offer({ aidAmountCents: 150_000, amountDueCents: 0 }),
  });

  // The requirement: a $0 balance is still an offer, not an automatic seat.
  it('still asks the family to accept or decline', async () => {
    renderPanel(freeRide);
    expect(await screen.findByRole('button', { name: /accept the offer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
  });

  it('says accepting enrolls immediately, with nothing to pay', async () => {
    const user = userEvent.setup();
    renderPanel(freeRide);
    await user.click(await screen.findByRole('button', { name: /accept the offer/i }));

    expect(screen.getByText(/enrolls the student immediately/i)).toBeInTheDocument();
    // "nothing to pay" appears twice on a full ride — once in the terms block
    // and once in this confirmation. Both are intended.
    expect(screen.getAllByText(/nothing to pay/i)).toHaveLength(2);
  });

  it('names the balance in the confirmation when there is one', async () => {
    const user = userEvent.setup();
    renderPanel(envelope());
    await user.click(await screen.findByRole('button', { name: /accept the offer/i }));
    expect(screen.getByText(/paying the balance of \$750/i)).toBeInTheDocument();
  });

  it('tells a full-aid family their award covers tuition', async () => {
    renderPanel(freeRide);
    expect(await screen.findByText(/award covers full tuition/i)).toBeInTheDocument();
  });
});

describe('awaiting payment', () => {
  const owing = envelope({
    status: 'awaiting_payment',
    offer: offer({ response: 'accepted', respondedAt: 1_780_000_000 }),
  });

  it('offers to pay the outstanding balance', async () => {
    renderPanel(owing);
    expect(await screen.findByRole('button', { name: /pay \$750/i })).toBeInTheDocument();
  });

  it('starts checkout and hands the browser to Stripe', async () => {
    const user = userEvent.setup();
    createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.test/x' });
    renderPanel(owing);
    await user.click(await screen.findByRole('button', { name: /pay \$750/i }));

    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledWith('app1'));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/x'),
    );
  });

  it('subtracts a partial payment from what is still owed', async () => {
    renderPanel(
      envelope({
        status: 'awaiting_payment',
        offer: offer({ response: 'accepted', paidCents: 37_500 }),
      }),
    );
    expect(await screen.findByRole('button', { name: /pay \$375/i })).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  // With PAYMENTS_ENABLED off the seat is still held; we invoice out of band.
  it('promises an invoice instead when online payment is off', async () => {
    renderPanel(
      envelope({
        status: 'awaiting_payment',
        offer: offer({ response: 'accepted', paymentsEnabled: false }),
      }),
    );
    expect(await screen.findByText(/email you an invoice for \$750/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pay /i })).not.toBeInTheDocument();
  });

  it('shows a confirming message after returning from checkout', async () => {
    setUrl('?paid=1');
    renderPanel(owing);
    expect(await screen.findByText(/payment received/i)).toBeInTheDocument();
    // The pay button is suppressed so nobody double-pays while we confirm.
    expect(screen.getByRole('button', { name: /pay \$750/i })).toBeDisabled();
  });

  it('invites another try after a cancelled checkout', async () => {
    setUrl('?canceled=1');
    renderPanel(owing);
    expect(await screen.findByText(/payment was not completed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pay \$750/i })).toBeEnabled();
  });
});

describe('past the deadline', () => {
  it('withdraws the buttons and explains why', async () => {
    renderPanel(
      envelope({ offer: offer({ pastDeadline: true, enrollmentDeadline: '2026-09-19' }) }),
    );
    expect(await screen.findByText(/this offer has expired/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /decline/i })).not.toBeInTheDocument();
    // The terms stay visible so the family can see what lapsed.
    expect(screen.getByText('Point-Set Topology')).toBeInTheDocument();
  });
});

describe('settled outcomes', () => {
  it('confirms enrollment and stops offering actions', async () => {
    renderPanel(
      envelope({
        status: 'enrolled',
        offer: offer({ response: 'accepted', paidCents: 75_000 }),
      }),
    );
    expect(await screen.findByText(/enrollment confirmed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('records a decline, and does not offer to undo it in the portal', async () => {
    renderPanel(
      envelope({
        status: 'declined',
        offer: offer({ response: 'declined', respondedAt: 1_780_000_000 }),
      }),
    );
    expect(await screen.findByText(/offer declined/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/please email us/i)).toBeInTheDocument();
  });

  it('says who declined when it was the guardian', async () => {
    renderPanel(
      envelope({
        status: 'declined',
        offer: offer({
          response: 'declined',
          respondedAt: 1_780_000_000,
          respondedByKind: 'guardian',
        }),
      }),
    );
    expect(await screen.findByText(/by a parent or guardian/i)).toBeInTheDocument();
  });
});

describe('the guardian view', () => {
  it('names the student it is acting on behalf of', async () => {
    renderPanel(envelope({ actorKind: 'guardian' }));
    expect(
      await screen.findByText(/Ada Lovelace is invited to join us/i),
    ).toBeInTheDocument();
  });

  it('addresses the student directly in their own portal', async () => {
    renderPanel(envelope({ actorKind: 'student' }));
    expect(await screen.findByText(/You are invited to join us/i)).toBeInTheDocument();
  });
});
