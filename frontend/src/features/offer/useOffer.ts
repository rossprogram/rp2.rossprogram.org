import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCheckoutSession,
  fetchOffer,
  respondToOffer,
  type OfferEnvelope,
} from '../../api/client';

export const offerKey = (appId: string) => ['offer', appId] as const;

/**
 * The family's offer.
 *
 * While a payment is in flight the query polls: the Stripe webhook is what
 * actually enrolls, and it may land before or after the browser returns from
 * Checkout, so the page cannot rely on the redirect to tell it anything.
 */
export function useOffer(appId: string | undefined) {
  return useQuery({
    queryKey: offerKey(appId ?? ''),
    queryFn: () => fetchOffer(appId!),
    enabled: Boolean(appId),
    refetchInterval: (q) => {
      const data = q.state.data as OfferEnvelope | undefined;
      return data?.status === 'awaiting_payment' ? 2000 : false;
    },
  });
}

export function useRespondToOffer(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (response: 'accept' | 'decline') => respondToOffer(appId, response),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offerKey(appId) });
      void qc.invalidateQueries({ queryKey: ['application'] });
      void qc.invalidateQueries({ queryKey: ['parent'] });
    },
  });
}

export function useStartCheckout(appId: string) {
  return useMutation({
    mutationFn: () => createCheckoutSession(appId),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });
}
