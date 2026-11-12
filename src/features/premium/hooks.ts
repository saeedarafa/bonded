import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';

import type { SessionState } from '@/features/auth/session';
import { useSession } from '@/features/auth/session';
import type { ActiveCouple } from '@/features/couple/api';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { track } from '@/lib/analytics';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

import {
  claimOfferScreen,
  getEntitlements,
  getOffer,
  openExitOffer,
  openOffer,
  type EntitlementRow,
} from './api';
import { SERVER_OFFERS_ENABLED } from './flags';
import {
  DAY3_PERCENT,
  introPercent,
  monotonicNow,
  offerCountdown,
  offerRemainingMs,
  useExitOfferDevice,
  useOfferShown,
  type ServerOffer,
} from './offers';
import { premiumState } from './model';
import { syncPendingPurchase, usePendingPurchase } from './pendingPurchase';
import {
  checkIntroEligible,
  checkIntroIneligible,
  checkTrialEligible,
  identifyPurchaser,
  loadCancelOffer,
  loadOffering,
  onCustomerInfoHint,
  purchaseCancelOffer,
  purchasePlan,
  purchasesAvailable,
  resetPurchaser,
  restorePurchases,
  type CancelOffer,
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
export function usePremium({ enabled = true }: { enabled?: boolean } = {}) {
  const { userId } = useSession();
  const couple = useActiveCouple({ enabled: enabled && userId !== null });
  const query = useQuery<EntitlementRow[], AppError>({
    queryKey: queryKeys.entitlements(),
    queryFn: getEntitlements,
    enabled: enabled && userId !== null,
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
 * the server, otherwise 13 (no gift after pairing since D52: the gift comes with the 3-day badge). `null` while the couple or
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

/** The `day3` offering's yearly plan (coupon 15): the plan the gift sells. */
function day3Plan(offering: Offering | null | undefined): Plan | undefined {
  return offering?.plans.find((p) => p.kind === 'yearly') ?? offering?.plans[0];
}

/**
 * The phone's second gate on the gift (D52): RevenueCat says this person definitely can't get the
 * `day3` intro price. False while unknown, without a key, or with no `day3` offering.
 */
function useDay3StoreBlocked(enabled: boolean): { blocked: boolean; deciding: boolean } {
  const offering = useOffering('day3', { enabled });
  const plan = day3Plan(offering.data);
  const query = useQuery<boolean, Error>({
    queryKey: queryKeys.purchases.introIneligible(plan?.productId ?? ''),
    queryFn: () => (plan ? checkIntroIneligible(plan) : Promise.resolve(false)),
    enabled: enabled && offering.available && !!plan,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const deciding =
    enabled && offering.available && (offering.isPending || (!!plan && query.isPending));
  return { blocked: query.data === true, deciding };
}

/**
 * The couple's day-3 gift (`get_offer('day3')`, BE-47, D52). Read-only: asking never starts the
 * clock. Asked only for a complete couple that the server says isn't Premium; Premium (mine or my
 * partner's) hides it whatever was cached, and so does a definite "no" from the store (second gate).
 * Refetched on resume (focus) and when the countdown reaches zero: the server says when it's over.
 * - `offer`: the live gift, or null. `offer.opened` = the shared 12-hour clock runs.
 * - `status`: `loading` until both the server and the store gate have answered.
 */
export function useDay3Offer({ enabled = true }: { enabled?: boolean } = {}) {
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
    queryKey: queryKeys.offer('day3'),
    queryFn: () => getOffer('day3'),
    enabled: ready,
    staleTime: 0,
  });
  const live = ready && query.data?.eligible === true;
  const store = useDay3StoreBlocked(live);
  const offer = live && !store.blocked && !store.deciding ? (query.data ?? null) : null;
  const loading =
    SERVER_OFFERS_ENABLED &&
    enabled &&
    userId !== null &&
    (couple.isPending ||
      premium.status === 'loading' ||
      (ready && query.isPending) ||
      (live && store.deciding));
  const status: 'loading' | 'live' | 'none' = offer ? 'live' : loading ? 'loading' : 'none';
  return { offer, status, coupleId: couple.data?.id ?? null, refetch: query.refetch };
}

/**
 * Milliseconds left on the gift, ticking every second from the server's `expires_at - server_now`
 * on the phone's monotonic clock (CONTRACTS §2). 0 when unopened. At zero the offer is refetched,
 * so the chip and 15 go away when the server says it's over; it never comes back (no extension).
 */
export function useOfferCountdown(offer: ServerOffer | null): number {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => monotonicNow());
  const opened = offer?.opened === true;
  useEffect(() => {
    if (!opened) return;
    const id = setInterval(() => setNow(monotonicNow()), 1000);
    return () => clearInterval(id);
  }, [opened, offer?.receivedAt]);
  // A fresh answer is newer than the last tick: count from whichever is later.
  const left = offerRemainingMs(offer, Math.max(now, offer?.receivedAt ?? 0));
  const ended = opened && left === 0;
  useEffect(() => {
    if (ended) void qc.invalidateQueries({ queryKey: queryKeys.offer('day3') });
  }, [ended, qc]);
  return left;
}

/**
 * 14 "Open the gift": `open_offer('day3')` starts (or reads) the shared 12-hour clock; the answer
 * replaces the cached offer so 15 shows the countdown at once.
 */
export function useOpenOffer() {
  const qc = useQueryClient();
  return useMutation<ServerOffer, AppError, void>({
    mutationFn: () => openOffer('day3'),
    onSuccess: (offer) => qc.setQueryData(queryKeys.offer('day3'), offer),
  });
}

/**
 * Whether Today may open 14 by itself right now (D52), asked when the couple's first 3-day badge
 * is celebrated (or a live, unopened gift was never shown here). Reads the server fresh (the gift
 * is created with the badge, so a cached "no" may be stale), then the store gate, then claims the
 * day's one full-screen offer (`claim_offer_screen('gift')`). Any failure means "no": 52b shows.
 */
export function useGiftGate() {
  const qc = useQueryClient();
  const { userId } = useSession();
  const couple = useActiveCouple({ enabled: userId !== null });
  const premium = usePremium();
  const coupleId = couple.data?.id ?? null;
  const ready =
    SERVER_OFFERS_ENABLED &&
    userId !== null &&
    isCoupleComplete(couple.data) &&
    premium.status === 'ready' &&
    !premium.isPremium;
  /** Premium state still loading: wait before deciding between 14 and 52b. */
  const deciding = SERVER_OFFERS_ENABLED && userId !== null && premium.status === 'loading';
  const decide = async ({ unopenedOnly = false } = {}): Promise<boolean> => {
    if (!ready || !coupleId) return false;
    if (useOfferShown.getState().wasShown(coupleId, 'day3')) return false;
    try {
      const offer = await qc.fetchQuery({
        queryKey: queryKeys.offer('day3'),
        queryFn: () => getOffer('day3'),
        staleTime: 0,
      });
      if (!offer.eligible || (unopenedOnly && offer.opened)) return false;
      if (purchasesAvailable()) {
        const offering = await qc.fetchQuery({
          queryKey: queryKeys.purchases.offering('day3'),
          queryFn: () => loadOffering('day3'),
          staleTime: 5 * 60_000,
        });
        const plan = day3Plan(offering);
        if (plan && (await checkIntroIneligible(plan))) return false;
      }
      if (!(await claimOfferScreen('gift'))) return false;
    } catch {
      return false;
    }
    useOfferShown.getState().markShown(coupleId, 'day3');
    return true;
  };
  return { ready, deciding, decide };
}

/** The offering's plans from RevenueCat. Disabled (and `available: false`) without a key. */
export function useOffering(id: OfferingId, { enabled = true }: { enabled?: boolean } = {}) {
  const available = purchasesAvailable();
  const query = useQuery<Offering | null, Error>({
    queryKey: queryKeys.purchases.offering(id),
    queryFn: () => loadOffering(id),
    enabled: available && enabled,
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
  return useTrialEligibility(plan).eligible;
}

/** `useTrialEligible` plus whether the answer is in (`settled`: known, failed, or nothing to ask). */
export function useTrialEligibility(plan: Plan | undefined): {
  eligible: boolean;
  settled: boolean;
} {
  const available = purchasesAvailable();
  const enabled = available && !!plan?.trial;
  const query = useQuery<boolean, Error>({
    queryKey: queryKeys.purchases.trialEligible(plan?.productId ?? ''),
    queryFn: () => (plan ? checkTrialEligible(plan) : Promise.resolve(false)),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { eligible: !!plan?.trial && query.data === true, settled: !enabled || !query.isPending };
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
    onMutate: () => track('restore_tapped'),
    onSuccess: ({ outcome, confirmed }) =>
      track('restore_completed', { found: outcome.kind === 'restored' && confirmed }),
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

  // D57 (CONTRACTS §2): the P3 exit sheet showed before sign-in; tell the server once, now, so
  // 16 never shows it again. The answer is ignored; on an error it is tried again next launch.
  const exitToRecord = useExitOfferDevice((s) => s.toRecord);
  useEffect(() => {
    if (status !== 'signedIn' || !userId || !exitToRecord) return;
    openExitOffer('paywall_close', randomUUID()).then(
      () => useExitOfferDevice.getState().recorded(),
      () => {},
    );
  }, [status, userId, exitToRecord]);

  useEffect(
    () =>
      onCustomerInfoHint(() => void qc.invalidateQueries({ queryKey: queryKeys.entitlements() })),
    [qc],
  );
}

/**
 * What Today's gift chip and the Us Premium row show (D52) while the day-3 gift is live: the
 * server's offer, the time left on the shared clock, and the store's percentage (the decided 50%
 * until the `day3` offering loads). `null` when there is nothing to show, including the moment
 * the countdown reaches zero: the chip goes, and no extension or "last chance" follows.
 */
export function useGiftPromo({ enabled = true }: { enabled?: boolean } = {}) {
  const gift = useDay3Offer({ enabled });
  const offering = useOffering('day3', { enabled: gift.offer !== null });
  const left = useOfferCountdown(gift.offer);
  const offer = gift.offer;
  if (!offer || (offer.opened && left === 0)) return null;
  const plan = day3Plan(offering.data);
  return {
    opened: offer.opened,
    left,
    time: offerCountdown(left),
    percent: introPercent(plan) ?? DAY3_PERCENT,
    href: offer.opened ? ('/gift/opened' as const) : ('/gift' as const),
  };
}

/** The `exit30` offering's yearly plan: the plan the D57 exit sheet sells. */
export function exitPlan(offering: Offering | null | undefined): Plan | undefined {
  return offering?.plans.find((p) => p.kind === 'yearly');
}

/**
 * D57 (1): whether the person's × on P3 / 16 opens the exit offer sheet instead of 17. Asked once
 * per screen visit (later closes on that visit go on as before). Every gate must say yes, and any
 * failure means "no" (17 shows):
 * - purchases available and the `exit30` yearly plan carries a real intro discount (the % is
 *   read from the store's prices, never hard-coded);
 * - the store says this person gets the intro price (`checkIntroEligible`);
 * - signed in: the server's Premium says no, and `open_exit_offer('paywall_close')` returns
 *   eligible (which records it: once per person, ever; the server refuses `gift_live` while the
 *   couple's day-3 gift is live, so 17 shows then);
 * - signed out (P3, D50): not shown on this device before; the server is told after sign-in.
 * Resolves to the plan to sell, or null.
 */
export function useExitOfferGate({ signedOut }: { signedOut: boolean }) {
  const qc = useQueryClient();
  const premium = usePremium({ enabled: !signedOut });
  const asked = useRef(false);
  return async (): Promise<Plan | null> => {
    if (asked.current) return null;
    asked.current = true;
    if (!SERVER_OFFERS_ENABLED || !purchasesAvailable()) return null;
    if (signedOut) {
      if (useExitOfferDevice.getState().shown) return null;
    } else if (premium.status !== 'ready' || premium.isPremium) {
      return null;
    }
    try {
      const offering = await qc.fetchQuery({
        queryKey: queryKeys.purchases.offering('exit30'),
        queryFn: () => loadOffering('exit30'),
        staleTime: 5 * 60_000,
      });
      const plan = exitPlan(offering);
      if (!plan || introPercent(plan) === null) return null;
      if (!(await checkIntroEligible(plan))) return null;
      if (signedOut) {
        useExitOfferDevice.getState().markShown();
        return plan;
      }
      return (await openExitOffer('paywall_close', randomUUID())) ? plan : null;
    } catch {
      return null;
    }
  };
}

/**
 * D57 (2): Settings/Us → Manage subscription. iOS only: `open_exit_offer('cancel')` first (the
 * server's once-ever rule), then the `cancel30` promotional offer from RevenueCat; null means go
 * straight to the store page. Android never asks (v1: the Play page directly). Never throws.
 */
export function useCancelOfferGate() {
  return async (os: string): Promise<CancelOffer | null> => {
    if (os !== 'ios' || !SERVER_OFFERS_ENABLED || !purchasesAvailable()) return null;
    try {
      const offer = await loadCancelOffer(os);
      if (!offer) return null;
      return (await openExitOffer('cancel', randomUUID())) ? offer : null;
    } catch {
      return null;
    }
  };
}

/** Redeem the cancel offer, then wait for the server like any purchase. */
export function useCancelOfferPurchase() {
  const { userId } = useSession();
  return useMutation<PurchaseOutcome, Error, CancelOffer>({
    mutationFn: (offer) => purchaseCancelOffer(offer, userId),
  });
}
