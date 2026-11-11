import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { SessionState } from '@/features/auth/session';
import { useSession } from '@/features/auth/session';
import type { ActiveCouple } from '@/features/couple/api';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

import {
  getEntitlements,
  getOffer,
  type EntitlementRow,
  type OfferKind,
  type ServerOffer,
} from './api';
import { SERVER_OFFERS_ENABLED } from './flags';
import { offerRemainingMs } from './offers';
import { premiumState } from './model';
import { syncPendingPurchase, usePendingPurchase } from './pendingPurchase';
import {
  checkTrialEligible,
  identifyPurchaser,
  loadOffering,
  onCustomerInfoHint,
  purchasePlan,
  purchasesAvailable,
  resetPurchaser,
  restorePurchases,
  type Offering,
  type OfferingId,
  type Plan,
  type PurchaseOutcome,
  type RestoreOutcome,
} from './purchases';

/**
 * After a purchase or restore the webhook (BE-18) writes `entitlements` a moment later, so the
 * app polls the server until it says premium. Mutable for tests.
 */
export const confirmTiming = { attempts: 10, intervalMs: 2000 };

function partnerIdOf(couple: ActiveCouple | null | undefined, myId: string | null): string | null {
  return (
    couple?.couple_members.find((m) => m.left_at === null && m.user_id !== myId)?.user_id ?? null
  );
}

export type PremiumStatus = 'loading' | 'error' | 'ready';

/**
 * Premium as the **server** sees it (CONTRACTS §6, D29): my active entitlement or my current
 * partner's. The SDK's customer info never decides it; it only triggers a refetch.
 */
export function usePremium() {
  const { userId } = useSession();
  const couple = useActiveCouple({ enabled: userId !== null });
  const query = useQuery<EntitlementRow[], AppError>({
    queryKey: queryKeys.entitlements(),
    queryFn: getEntitlements,
    enabled: userId !== null,
  });
  const partnerId = partnerIdOf(couple.data, userId);
  // Expiry is judged at fetch time (render stays pure); focus/reconnect refetches keep it fresh and
  // the server enforces the exact boundary anyway.
  const state = premiumState(query.data, userId, partnerId, query.dataUpdatedAt);
  const status: PremiumStatus =
    query.data !== undefined ? 'ready' : query.isError ? 'error' : 'loading';
  return {
    status,
    ...state,
    /** Covered by the partner's plan, not my own (J8 "on Maya's plan"). */
    viaPartner: !state.mine && state.partner,
    refetch: query.refetch,
  };
}

/**
 * Where a joiner goes after J6 (MOB-47, D29): J8 "on Maya's plan" when the couple is premium on
 * the server, otherwise 13 (which offers gift 14 to a free couple). `null` while the couple or
 * the entitlements are still loading, so the choice is never made on half the data. An
 * entitlement error falls back to 13: it still shows the plan card once the data arrives.
 */
export function useJoinedNext(): '/join/done' | '/paired' | null {
  const { userId } = useSession();
  const couple = useActiveCouple({ enabled: userId !== null });
  const premium = usePremium();
  if (userId === null) return null;
  if (couple.isPending) return null;
  if (premium.status === 'loading') return null;
  return premium.status === 'ready' && premium.isPremium ? '/join/done' : '/paired';
}

/** Poll the server entitlement until it says premium (or give up). Never throws. */
async function confirmServerPremium(
  qc: QueryClient,
  userId: string | null,
  attempts: number,
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const rows = await qc.fetchQuery({
        queryKey: queryKeys.entitlements(),
        queryFn: getEntitlements,
        staleTime: 0,
      });
      const couple = qc.getQueryData<ActiveCouple | null>(queryKeys.couple.active());
      if (premiumState(rows, userId, partnerIdOf(couple, userId), Date.now()).isPremium) {
        return true;
      }
    } catch {
      // Offline or a server error: try again on the next tick.
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, confirmTiming.intervalMs));
  }
  return false;
}

/**
 * The server's offer for this couple (`get_offer`, BE-17). Only asked for a complete, non-premium
 * couple: the first eligible call starts the shared 24-hour clock, so it is asked only where the
 * offer is about to be shown (13 -> 14, Today on day 3 -> 36, a paywall).
 */
export function useOffer(kind: OfferKind, { enabled = true }: { enabled?: boolean } = {}) {
  const { userId } = useSession();
  const couple = useActiveCouple({ enabled: userId !== null });
  const premium = usePremium();
  const ready =
    SERVER_OFFERS_ENABLED &&
    enabled &&
    userId !== null &&
    isCoupleComplete(couple.data) &&
    premium.status === 'ready' &&
    !premium.isPremium;
  const query = useQuery<ServerOffer, AppError>({
    queryKey: queryKeys.offer(kind),
    queryFn: () => getOffer(kind),
    enabled: ready,
  });
  // Premium (mine or my partner's) suppresses every offer, whatever was cached.
  const offer = ready && query.data?.eligible ? query.data : null;
  const loading =
    SERVER_OFFERS_ENABLED &&
    enabled &&
    userId !== null &&
    (couple.isPending || premium.status === 'loading' || (ready && query.isPending));
  const status: 'loading' | 'live' | 'none' = offer ? 'live' : loading ? 'loading' : 'none';
  return { ...query, ready, offer, status, coupleId: couple.data?.id ?? null };
}

/**
 * Milliseconds left on a server offer, ticking every second from `expires_at` (clamped to the
 * 24-hour window for clock skew). At zero the offer is refetched: the server says when it's over.
 */
export function useOfferCountdown(expiresAt: string | null, kind: OfferKind): number {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  const left = offerRemainingMs(expiresAt, now);
  const ended = expiresAt !== null && left === 0;
  useEffect(() => {
    if (ended) {
      void qc.invalidateQueries({ queryKey: queryKeys.offer(kind) });
      void qc.invalidateQueries({ queryKey: queryKeys.offerClocksAll() });
    }
  }, [ended, kind, qc]);
  return left;
}

/** The offering's plans from RevenueCat. Disabled (and `available: false`) without a key. */
export function useOffering(id: OfferingId) {
  const available = purchasesAvailable();
  const query = useQuery<Offering | null, Error>({
    queryKey: queryKeys.purchases.offering(id),
    queryFn: () => loadOffering(id),
    enabled: available,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return { ...query, available };
}

/**
 * Whether this person still gets the plan's free trial (D52: 17's main button). `false` while
 * unknown (loading, error, no key, no trial on the product): trial copy only on a definite yes.
 */
export function useTrialEligible(plan: Plan | undefined): boolean {
  const available = purchasesAvailable();
  const query = useQuery<boolean, Error>({
    queryKey: queryKeys.purchases.trialEligible(plan?.productId ?? ''),
    queryFn: () => (plan ? checkTrialEligible(plan) : Promise.resolve(false)),
    enabled: available && !!plan?.trial,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return !!plan?.trial && query.data === true;
}

export type PurchaseResult = { outcome: PurchaseOutcome; confirmed: boolean };
export type RestoreResult = { outcome: RestoreOutcome; confirmed: boolean };

/** Buy a plan, then wait for the server to confirm premium. */
export function usePurchase() {
  const qc = useQueryClient();
  const { userId } = useSession();
  return useMutation<PurchaseResult, Error, { offeringId: OfferingId; planId: string }>({
    mutationFn: async ({ offeringId, planId }) => {
      const outcome = await purchasePlan(offeringId, planId, userId);
      if (outcome.kind !== 'purchased') return { outcome, confirmed: false };
      return { outcome, confirmed: await confirmServerPremium(qc, userId, confirmTiming.attempts) };
    },
  });
}

/**
 * P3 (D50): buy before there is an account. Signed out, the purchase runs under RevenueCat's
 * anonymous id and is only **marked** (`pendingPurchase`): sign-in moves it to the account and the
 * server entitlement decides premium. A signed-in person (a brand-new account sent through
 * onboarding, D40) buys as itself; P3 doesn't wait for the server either way (the setup after it
 * refetches `entitlements`), so `confirmed` is always false here.
 */
export function useSignedOutPurchase() {
  const { userId } = useSession();
  return useMutation<PurchaseResult, Error, { offeringId: OfferingId; planId: string }>({
    mutationFn: async ({ offeringId, planId }) => {
      const outcome = await purchasePlan(offeringId, planId, userId, { signedOut: true });
      if (outcome.kind === 'purchased' && !userId) usePendingPurchase.getState().mark();
      return { outcome, confirmed: false };
    },
  });
}

/** P3 Restore: like `useSignedOutPurchase`, a signed-out restore is moved to the account at sign-in. */
export function useSignedOutRestore() {
  const { userId } = useSession();
  return useMutation<RestoreResult, Error, void>({
    mutationFn: async () => {
      const outcome = await restorePurchases(userId, { signedOut: true });
      if (outcome.kind === 'restored' && outcome.premiumHint && !userId) {
        usePendingPurchase.getState().mark();
      }
      return { outcome, confirmed: false };
    },
  });
}

/** Restore, then check the server. With nothing restored, one refetch (a partner may cover us). */
export function useRestore() {
  const qc = useQueryClient();
  const { userId } = useSession();
  return useMutation<RestoreResult, Error, void>({
    mutationFn: async () => {
      const outcome = await restorePurchases(userId);
      if (outcome.kind !== 'restored') return { outcome, confirmed: false };
      const attempts = outcome.premiumHint ? confirmTiming.attempts : 1;
      return { outcome, confirmed: await confirmServerPremium(qc, userId, attempts) };
    },
  });
}

/** Re-check the server entitlement once (the "Check again" action after a slow webhook). */
export function useConfirmPremium() {
  const qc = useQueryClient();
  const { userId } = useSession();
  return useMutation<boolean, Error, void>({
    mutationFn: () => confirmServerPremium(qc, userId, 1),
  });
}

/** Retries of a P3 purchase sync that didn't go through (429 waits out the 30 s limit). */
export const pendingSyncTiming = { attempts: 4, intervalMs: 31_000 };

/**
 * RevenueCat identity follows the session (CONTRACTS §6): `logIn(user.id)` once signed in,
 * `logOut()` when signed out. Customer-info updates from the SDK only refetch the server row.
 * A P3 purchase made signed out (D50) is moved to the account right after `logIn`:
 * `revenuecat-sync`, then the `entitlements` refetch (retried a few times; again on next launch).
 */
export function usePurchasesIdentity({ status, userId }: SessionState) {
  const qc = useQueryClient();
  const identified = useRef<string | null | undefined>(undefined);
  const pending = usePendingPurchase((s) => s.pending);

  useEffect(() => {
    if (status === 'loading') return;
    const next = status === 'signedIn' ? userId : null;
    if (identified.current === next) return;
    identified.current = next;
    if (next) {
      void identifyPurchaser(next).then(() =>
        qc.invalidateQueries({ queryKey: queryKeys.purchases.all }),
      );
    } else {
      void resetPurchaser();
    }
  }, [qc, status, userId]);

  useEffect(() => {
    if (status !== 'signedIn' || !userId || !pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (n: number) => {
      void syncPendingPurchase(userId).then((result) => {
        // `ok` clears the flag (this effect's cleanup runs first), so refetch before the check.
        if (result === 'ok') {
          void qc.invalidateQueries({ queryKey: queryKeys.entitlements() });
          return;
        }
        if (cancelled) return;
        if (result === 'none' || result === 'signedOut') return;
        if (n + 1 < pendingSyncTiming.attempts) {
          timer = setTimeout(() => attempt(n + 1), pendingSyncTiming.intervalMs);
        }
      });
    };
    attempt(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [qc, status, userId, pending]);

  useEffect(
    () =>
      onCustomerInfoHint(() => void qc.invalidateQueries({ queryKey: queryKeys.entitlements() })),
    [qc],
  );
}
