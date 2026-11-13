import { useEffect, useRef } from 'react';

import { setPersonProperties, track, type EventProps } from '@/lib/analytics';

import type { OfferingId, Plan, PurchaseOutcome } from './purchases';

/**
 * Money funnel (ANALYTICS §3.9, MOB-24c): intent only. Prices, revenue and renewals come from
 * RevenueCat's own PostHog integration, never from the app.
 */
export type PaywallId = EventProps<'paywall_viewed'>['paywall'];
export type PaywallTrigger = EventProps<'paywall_viewed'>['trigger'];
type Product = EventProps<'purchase_started'>['product'];

/** 16's `?from=` → the catalogue trigger. Unknown or missing: no `paywall_viewed`. */
const TRIGGER_BY_FROM: Record<string, PaywallTrigger> = {
  settings: 'settings',
  recap: 'recap',
  voice: 'voice',
  answer: 'long_answer',
  little_things: 'little_things_limit',
  streak_saver: 'streak_saver',
  pack: 'pack',
  dark: 'dark',
  gift: 'gift',
  history: 'history',
};

export function paywallTrigger(from: string | undefined): PaywallTrigger | null {
  return (from && TRIGGER_BY_FROM[from]) || null;
}

/**
 * The analytics `product` label (ANALYTICS §3.9), from the offering and the package type only
 * (PO 2026-11-13): never from a store product id, so the RevenueCat Test Store's `_v2` products
 * (`yearly_v2`, `yearly_day3_v2`, `yearly_exit30_v2`) and the real store ids give the same labels.
 * Yearly in `default` = `yearly` (7-day trial, D52), in `day3` = `yearly_day3`, in `exit30` =
 * `yearly_exit30` (D57); Monthly = `monthly`.
 */
export function productOf(plan: Pick<Plan, 'kind'>, offering?: OfferingId): Product {
  if (plan.kind !== 'yearly') return 'monthly';
  if (offering === 'exit30') return 'yearly_exit30';
  if (offering === 'day3') return 'yearly_day3';
  return 'yearly';
}

/** When the store last said "purchased" (memory only), for `premium_confirmed`. */
let purchasedAt: number | null = null;

/** `premium_confirmed` once, the first time the server says premium after a store purchase. */
export function trackPremiumConfirmed(now = Date.now()): void {
  if (purchasedAt === null) return;
  track('premium_confirmed', {
    seconds_after_purchase: Math.max(0, Math.round((now - purchasedAt) / 1000)),
  });
  purchasedAt = null;
}

/** A store purchase on this phone that the server has not confirmed yet. */
export function purchasePending(): boolean {
  return purchasedAt !== null;
}

/** Tests: forget the last purchase. */
export function resetPurchaseClockForTests(): void {
  purchasedAt = null;
}

/** The store said "purchased": `plan` on the person, and the clock for `premium_confirmed`. */
export function notePurchased(plan: Pick<Plan, 'kind'>): void {
  purchasedAt = Date.now();
  setPersonProperties({ plan: plan.kind });
}

export type PurchaseContext = {
  paywall: PaywallId;
  plan: Pick<Plan, 'kind'>;
  offering: OfferingId;
};

export function trackPurchaseStarted({ paywall, plan, offering }: PurchaseContext): void {
  track('purchase_started', { paywall, product: productOf(plan, offering), offering });
}

/** The store's answer: cancelled, failed (the failure kind, never a message) or completed. */
export function trackPurchaseOutcome(
  { paywall, plan, offering }: PurchaseContext,
  outcome: PurchaseOutcome,
  { isTrial, beforeSignIn }: { isTrial: boolean; beforeSignIn: boolean },
): void {
  const product = productOf(plan, offering);
  if (outcome.kind === 'cancelled') track('purchase_cancelled', { paywall, product });
  else if (outcome.kind === 'failed') {
    track('purchase_failed', { paywall, product, error_code: outcome.reason });
  } else {
    notePurchased(plan);
    track('purchase_completed', {
      paywall,
      product,
      is_trial: isTrial,
      before_sign_in: beforeSignIn,
    });
  }
}

/**
 * `paywall_viewed` once per screen visit, when the plans are on screen. `trial_eligible` is only
 * sent when the screen offers a trial at all.
 */
export function usePaywallViewed(
  view: Omit<EventProps<'paywall_viewed'>, 'trigger'> & { trigger: PaywallTrigger | null },
  ready: boolean,
): void {
  const sent = useRef(false);
  const { paywall, trigger, offering, trial_eligible, goal_keys } = view;
  // A stable dependency for the list (a fresh array each render must not re-run the effect).
  const goalKeys = goal_keys?.join(',');
  useEffect(() => {
    if (!ready || sent.current || !trigger) return;
    sent.current = true;
    track('paywall_viewed', {
      paywall,
      trigger,
      ...(offering ? { offering } : {}),
      ...(trial_eligible !== undefined ? { trial_eligible } : {}),
      ...(goal_keys ? { goal_keys } : {}),
    });
    // goal_keys is read through goalKeys (same content).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, paywall, trigger, offering, trial_eligible, goalKeys]);
}

/** × or back on a paywall that opens 17: the close, then 17 itself. */
export function trackExitSheet(from: PaywallId): void {
  track('paywall_closed', { paywall: from });
  track('exit_sheet_viewed');
}
