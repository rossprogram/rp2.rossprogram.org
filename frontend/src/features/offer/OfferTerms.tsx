import type { OfferView } from '../../api/client';

/** Integer cents as "$1,500" / "$1,234.56". Mirrors formatCents on the server. */
export function money(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const rem = Math.abs(cents) % 100;
  const grouped = dollars.toLocaleString('en-US');
  return `$${rem === 0 ? grouped : `${grouped}.${String(rem).padStart(2, '0')}`}`;
}

export function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    dateStyle: 'long',
    timeZone: 'UTC',
  });
}

/**
 * Presentational only — no state, no mutations — so the admin detail page can
 * render exactly what the family sees.
 */
export function OfferTerms({ offer }: { offer: OfferView }) {
  const deadline = formatDeadline(offer.enrollmentDeadline);
  const outstanding = Math.max(0, offer.amountDueCents - offer.paidCents);

  return (
    <div className="rule-t rule-b py-5 my-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-sm">
        {offer.courseLabel ? (
          <>
            <dt className="smallcaps text-muted">Course</dt>
            <dd className="text-ink">{offer.courseLabel}</dd>
          </>
        ) : null}
        {offer.section ? (
          <>
            <dt className="smallcaps text-muted">Section</dt>
            <dd className="text-ink">{offer.section}</dd>
          </>
        ) : null}
        {offer.cohort ? (
          <>
            <dt className="smallcaps text-muted">Group</dt>
            <dd className="text-ink">{offer.cohort}</dd>
          </>
        ) : null}
        {offer.problemSession ? (
          <>
            <dt className="smallcaps text-muted">Problem session</dt>
            <dd className="text-ink">{offer.problemSession}</dd>
          </>
        ) : null}
        {offer.officeHours ? (
          <>
            <dt className="smallcaps text-muted">Office hours</dt>
            <dd className="text-ink">{offer.officeHours}</dd>
          </>
        ) : null}
        <dt className="smallcaps text-muted">Term</dt>
        <dd className="text-ink">Sep 27 &ndash; Dec 12, 2026</dd>
      </dl>

      {offer.problemSession || offer.officeHours ? (
        <p className="text-sm text-muted mt-3 italic">
          Times are shown in your own local time zone.
        </p>
      ) : null}

      <div className="mt-6 pt-4 rule-t">
        <table className="text-sm w-full max-w-sm">
          <tbody>
            <tr>
              <td className="py-1 text-muted">Tuition</td>
              <td className="py-1 text-right tabular-nums text-ink">
                {money(offer.tuitionCents)}
              </td>
            </tr>
            {offer.aidAmountCents > 0 ? (
              <tr>
                <td className="py-1 text-muted">Financial aid</td>
                <td className="py-1 text-right tabular-nums text-accent">
                  &minus;{money(offer.aidAmountCents)}
                </td>
              </tr>
            ) : null}
            {offer.paidCents > 0 ? (
              <tr>
                <td className="py-1 text-muted">Paid</td>
                <td className="py-1 text-right tabular-nums text-accent">
                  &minus;{money(offer.paidCents)}
                </td>
              </tr>
            ) : null}
            <tr className="border-t border-rule">
              <td className="pt-2 font-medium text-ink">
                {outstanding === 0 ? 'Balance' : 'Amount due'}
              </td>
              <td className="pt-2 text-right tabular-nums font-medium text-ink">
                {money(outstanding)}
              </td>
            </tr>
          </tbody>
        </table>

        {outstanding === 0 && offer.aidAmountCents >= offer.tuitionCents ? (
          <p className="text-sm text-muted mt-3 italic">
            Your award covers full tuition &mdash; there is nothing to pay.
          </p>
        ) : null}

        {deadline ? (
          <p className="text-sm text-muted mt-3">
            Please respond by <span className="text-ink">{deadline}</span>.
          </p>
        ) : null}
      </div>

      {offer.notes ? (
        <div className="mt-6 pt-4 rule-t">
          <p className="smallcaps text-muted mb-2">A note from us</p>
          <p className="text-sm text-ink whitespace-pre-wrap">{offer.notes}</p>
        </div>
      ) : null}
    </div>
  );
}
