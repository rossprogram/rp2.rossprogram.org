import { useState } from 'react';
import { ApiError } from '../../api/client';
import { OfferTerms, formatDeadline, money } from './OfferTerms';
import { useOffer, useRespondToOffer, useStartCheckout } from './useOffer';

/*
 * The family's offer, for both the student's /status page and the guardian's
 * portal. Authorization is identical for the two, so this is one component
 * with no per-portal branching beyond a line naming who is acting.
 *
 * It renders nothing at all when there is no visible offer, so both pages can
 * mount it unconditionally.
 */
export function OfferPanel({ appId }: { appId: string | undefined }) {
  const q = useOffer(appId);
  const respond = useRespondToOffer(appId ?? '');
  const checkout = useStartCheckout(appId ?? '');
  const [confirming, setConfirming] = useState<'accept' | 'decline' | null>(null);

  const env = q.data;
  const offer = env?.offer;
  if (!env || !offer) return null;

  const params = new URLSearchParams(window.location.search);
  const justPaid = params.get('paid') === '1';
  const canceled = params.get('canceled') === '1';
  const outstanding = Math.max(0, offer.amountDueCents - offer.paidCents);
  const forWhom =
    env.actorKind === 'guardian' && env.studentName ? env.studentName : null;

  const errorText =
    respond.error instanceof ApiError
      ? messageOf(respond.error)
      : checkout.error instanceof ApiError
        ? messageOf(checkout.error)
        : null;

  /* -------- enrolled -------- */
  if (env.status === 'enrolled') {
    return (
      <section className="mb-10">
        <p className="smallcaps text-accent mb-4">Enrollment confirmed</p>
        <h2 className="mb-3">
          {forWhom ? `${forWhom} has a seat.` : 'You have a seat.'}
        </h2>
        <p className="text-muted mb-2">
          Everything is settled. Before classes begin we will send details about
          Zoom, Discord, and Gradescope, along with the first problem set.
        </p>
        <OfferTerms offer={offer} />
      </section>
    );
  }

  /* -------- declined -------- */
  if (env.status === 'declined') {
    const when = offer.respondedAt
      ? new Date(offer.respondedAt * 1000).toLocaleDateString(undefined, {
          dateStyle: 'long',
        })
      : null;
    return (
      <section className="mb-10">
        <p className="smallcaps text-muted mb-4">Offer declined</p>
        <p className="text-muted">
          This offer was declined{when ? ` on ${when}` : ''}
          {offer.respondedByKind === 'guardian' ? ' by a parent or guardian' : ''}.
          If that was a mistake, please email us and we will see what we can do.
        </p>
      </section>
    );
  }

  /* -------- awaiting payment -------- */
  if (env.status === 'awaiting_payment') {
    return (
      <section className="mb-10">
        <p className="smallcaps text-accent mb-4">Offer accepted</p>
        <h2 className="mb-3">One step left.</h2>

        {justPaid ? (
          <p className="text-muted mb-4">
            Payment received &mdash; we are confirming it with our payment
            processor. This page will update on its own, usually within a few
            seconds. You may safely close this page; we will email you either way.
          </p>
        ) : (
          <p className="text-muted mb-4">
            {forWhom ? `${forWhom}'s seat is` : 'Your seat is'} held. It becomes
            final once the balance of {money(outstanding)} is paid.
          </p>
        )}

        {canceled ? (
          <p className="text-muted mb-4 italic">
            Payment was not completed. You can try again whenever you are ready.
          </p>
        ) : null}

        <OfferTerms offer={offer} />

        {errorText ? <p className="text-sm text-accent mb-4">{errorText}</p> : null}

        <div className="flex flex-wrap items-center gap-4">
          {offer.paymentsEnabled ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={checkout.isPending || justPaid}
              onClick={() => checkout.mutate()}
            >
              {checkout.isPending ? 'Opening payment…' : `Pay ${money(outstanding)}`}
            </button>
          ) : (
            <p className="text-sm text-muted italic">
              We will email you an invoice for {money(outstanding)}.
            </p>
          )}

          <button
            type="button"
            className="btn btn-ghost"
            disabled={respond.isPending}
            onClick={() => setConfirming('decline')}
          >
            Decline the offer
          </button>
        </div>

        {confirming === 'decline' ? (
          <ConfirmDecline
            pending={respond.isPending}
            onCancel={() => setConfirming(null)}
            onConfirm={() => {
              respond.mutate('decline');
              setConfirming(null);
            }}
          />
        ) : null}
      </section>
    );
  }

  /* -------- an offer awaiting a response -------- */
  if (env.status !== 'accepted' || offer.response !== null) return null;

  if (offer.pastDeadline) {
    return (
      <section className="mb-10">
        <p className="smallcaps text-muted mb-4">Offer expired</p>
        <h2 className="mb-3">This offer has expired.</h2>
        <p className="text-muted mb-2">
          The deadline was {formatDeadline(offer.enrollmentDeadline)}. Please
          email us &mdash; if a seat is still open we would be glad to talk.
        </p>
        <OfferTerms offer={offer} />
      </section>
    );
  }

  const freeSeat = outstanding === 0;

  return (
    <section className="mb-10">
      <p className="smallcaps text-accent mb-4">Offer of admission</p>
      <h2 className="mb-3">
        {forWhom ? `${forWhom} is invited to join us.` : 'You are invited to join us.'}
      </h2>
      <p className="text-muted mb-2">
        Here are the details of the offer. A seat is provisional until it is
        accepted{freeSeat ? '' : ' and the balance is paid'}.
      </p>

      <OfferTerms offer={offer} />

      {errorText ? <p className="text-sm text-accent mb-4">{errorText}</p> : null}

      {confirming === null ? (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="btn btn-primary"
            disabled={respond.isPending}
            onClick={() => setConfirming('accept')}
          >
            Accept the offer
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={respond.isPending}
            onClick={() => setConfirming('decline')}
          >
            Decline
          </button>
        </div>
      ) : confirming === 'accept' ? (
        <div className="rule-t pt-5">
          <p className="text-ink mb-4">
            {freeSeat
              ? 'Accepting confirms the seat and enrolls the student immediately. There is nothing to pay.'
              : `Accepting confirms the seat. The next step is paying the balance of ${money(outstanding)}.`}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="btn btn-primary"
              disabled={respond.isPending}
              onClick={() => {
                respond.mutate('accept');
                setConfirming(null);
              }}
            >
              {respond.isPending ? 'Confirming…' : 'Yes, accept'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setConfirming(null)}
            >
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <ConfirmDecline
          pending={respond.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            respond.mutate('decline');
            setConfirming(null);
          }}
        />
      )}
    </section>
  );
}

function ConfirmDecline({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="rule-t pt-5 mt-5">
      <p className="text-ink mb-4">
        Declining releases the seat to another applicant. This cannot be undone
        from here.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? 'Declining…' : 'Yes, decline'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onCancel}>
          Keep the offer
        </button>
      </div>
    </div>
  );
}

function messageOf(err: ApiError): string {
  const body = err.body as { message?: string } | null;
  return body?.message ?? 'Something went wrong. Please try again.';
}
