import { Platform } from 'react-native';
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  LOG_LEVEL,
  PACKAGE_TYPE,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';

import { revenueCatKey } from '@/lib/env';

/**
 * The only file that talks to the RevenueCat SDK (MOB-19, CONTRACTS §6).
 *
 * - Configured lazily from the public `EXPO_PUBLIC_REVENUECAT_*` key. Without a key (CI, Jest,
 *   local) every call is a safe no-op and `purchasesAvailable()` is false: the paywall shows
 *   "Not available right now".
 * - The SDK's customer info is only a **hint** to refetch the server entitlement (`usePremium`):
 *   premium is what the database says (D29: the partner's purchase counts).
 * - Prices, trial lengths and discounts come only from the offering's store products (D31).
 * - Nothing here logs: no receipts, customer info, prices or error details reach the console,
 *   analytics or crash reports. The SDK's own log level is lowered to errors.
 */

export const ENTITLEMENT_ID = 'premium';

export type PlanKind = 'yearly' | 'monthly';

/** A free intro period from the store product (`introPrice.price === 0`). */
export type Trial = {
  count: number;
  unit: 'day' | 'week' | 'month' | 'year';
  /** Length in days when the unit allows it (day / week), else null. */
  days: number | null;
};

export type Plan = {
  /** The RevenueCat package identifier (`$rc_annual`, `$rc_monthly`, or a custom id). */
  id: string;
  kind: PlanKind;
  /** The store's localized price string, e.g. "€39.99". Never built in the app. */
  price: string;
  /** The SDK's per-month price for a yearly plan (store-localized), when the store gives one. */
  pricePerMonth: string | null;
  /** The store product id (for the trial eligibility check). */
  productId: string;
  /** The store's price as a number, for "Save [X]%" and per-person math only (never shown raw). */
  amount: number | null;
  /** ISO 4217 code of `amount`, from the store. */
  currencyCode: string | null;
  /** The store product's free intro period. Whether **this person** gets it: `trialEligible`. */
  trial: Trial | null;
  /**
   * A **paid** introductory price on the store product (D52: the `day3` offering's first-year
   * price on yearly). The store's own price string and amount; never computed in the app.
   */
  introOffer: { price: string; amount: number | null } | null;
};

export type Offering = { id: string; plans: Plan[] };

/** D52: `default` (16, 17, 34, P3) and `day3` (coupon 15). `intro` and `winback` are retired. */
export type OfferingId = 'default' | 'day3';

export type PurchaseFailure =
  /** No connection, or the store timed out. */
  | 'network'
  /** This store account already owns the subscription: restore it. */
  | 'alreadyOwned'
  /** Ask-to-buy / deferred payment: nothing to do until the store approves it. */
  | 'pending'
  /** The store refused the payment (57 "Payment didn't go through"). */
  | 'payment'
  /** Purchases aren't set up (no key, product missing, configuration error). */
  | 'unavailable'
  | 'unknown';

export type PurchaseOutcome =
  | { kind: 'purchased'; premiumHint: boolean }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: PurchaseFailure };

export type RestoreOutcome =
  { kind: 'restored'; premiumHint: boolean } | { kind: 'failed'; reason: PurchaseFailure };

let configuredKey: string | null = null;
/** The user RevenueCat is logged in as (null = anonymous / unknown), and any logIn in flight. */
let identifiedAs: string | null = null;
let identifying: Promise<void> | null = null;
/** Packages from the last loaded offerings, by offering id then package id (never persisted). */
const packages = new Map<string, Map<string, PurchasesPackage>>();

function ensureConfigured(): boolean {
  const key = revenueCatKey(Platform.OS);
  if (!key) return false;
  if (configuredKey !== null) return true;
  try {
    void Purchases.setLogLevel(LOG_LEVEL.ERROR).catch(() => {});
    Purchases.configure({ apiKey: key });
    configuredKey = key;
    return true;
  } catch {
    return false;
  }
}

/** True when this build has a RevenueCat key for this platform (and the SDK accepted it). */
export function purchasesAvailable(): boolean {
  return ensureConfigured();
}

/** `Purchases.logIn(userId)` after sign-in: the RevenueCat app user id **is** the Supabase id. */
export async function identifyPurchaser(userId: string): Promise<void> {
  if (!ensureConfigured()) return;
  const attempt = (async () => {
    try {
      await Purchases.logIn(userId);
      identifiedAs = userId;
    } catch {
      // Silent: a purchase or restore tries again first (`ensureIdentified`).
      identifiedAs = null;
    }
  })();
  identifying = attempt;
  await attempt;
  if (identifying === attempt) identifying = null;
}

/**
 * A purchase made while RevenueCat is anonymous never reaches `entitlements` by itself (BE-18
 * ignores anonymous ids), so the paywalls inside the app buy and restore only once logged in as
 * the signed-in user. The one exception is P3 (D50): it buys signed out (`signedOut`), and
 * `logIn(uid)` + `revenuecat-sync` move the purchase to the account at sign-in
 * (`pendingPurchase.ts`).
 */
export async function ensureIdentified(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  if (identifying) await identifying;
  if (identifiedAs !== userId) await identifyPurchaser(userId);
  return identifiedAs === userId;
}

/**
 * Who a purchase or restore runs as: the signed-in user, or (P3 only, `signedOut`) RevenueCat's
 * anonymous id while nobody is signed in. False when neither holds.
 */
async function readyToBuy(userId: string | null, signedOut: boolean): Promise<boolean> {
  if (userId) return ensureIdentified(userId);
  if (!signedOut) return false;
  if (identifying) await identifying;
  // Signed out: the session hook has logged RevenueCat out, so the SDK's user is anonymous.
  return identifiedAs === null;
}

/** `Purchases.logOut()` on sign-out. Logging out an anonymous user is an expected error. */
export async function resetPurchaser(): Promise<void> {
  if (!ensureConfigured()) return;
  identifiedAs = null;
  try {
    await Purchases.logOut();
  } catch {
    // LOG_OUT_ANONYMOUS_USER_ERROR or offline: nothing to undo.
  }
}

/** Customer info updates from the SDK, as a hint only. Returns the unsubscribe. */
export function onCustomerInfoHint(listener: () => void): () => void {
  if (!ensureConfigured()) return () => {};
  const wrapped = (_info: CustomerInfo) => listener();
  Purchases.addCustomerInfoUpdateListener(wrapped);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(wrapped);
  };
}

function trialOf(pkg: PurchasesPackage): Trial | null {
  const intro = pkg.product.introPrice;
  if (!intro || intro.price !== 0) return null;
  const count = intro.periodNumberOfUnits * Math.max(1, intro.cycles);
  if (!Number.isFinite(count) || count <= 0) return null;
  const unit = intro.periodUnit.toUpperCase();
  if (unit === 'DAY') return { count, unit: 'day', days: count };
  if (unit === 'WEEK') return { count, unit: 'week', days: count * 7 };
  if (unit === 'MONTH') return { count, unit: 'month', days: null };
  if (unit === 'YEAR') return { count, unit: 'year', days: null };
  return null;
}

function introOfferOf(pkg: PurchasesPackage): Plan['introOffer'] {
  const intro = pkg.product.introPrice;
  if (!intro || !(intro.price > 0) || !intro.priceString) return null;
  return { price: intro.priceString, amount: Number.isFinite(intro.price) ? intro.price : null };
}

function kindOf(pkg: PurchasesPackage): PlanKind | null {
  if (pkg.packageType === PACKAGE_TYPE.ANNUAL) return 'yearly';
  if (pkg.packageType === PACKAGE_TYPE.MONTHLY) return 'monthly';
  return null;
}

/**
 * The named offering (falls back to the dashboard's current offering for `default`), mapped to
 * yearly-then-monthly plans. Null when purchases aren't available or the offering is missing.
 * Throws a `PurchaseFailure` string on an SDK error (the query shows its error state).
 */
export async function loadOffering(id: OfferingId): Promise<Offering | null> {
  if (!ensureConfigured()) return null;
  let offerings;
  try {
    offerings = await Purchases.getOfferings();
  } catch (error) {
    throw new Error(failureOf(error));
  }
  const offering = offerings.all[id] ?? (id === 'default' ? offerings.current : null);
  if (!offering) return null;
  const byId = new Map<string, PurchasesPackage>();
  const plans: Plan[] = [];
  for (const pkg of offering.availablePackages) {
    const kind = kindOf(pkg);
    if (!kind) continue;
    byId.set(pkg.identifier, pkg);
    plans.push({
      id: pkg.identifier,
      kind,
      price: pkg.product.priceString,
      pricePerMonth: kind === 'yearly' ? (pkg.product.pricePerMonthString ?? null) : null,
      productId: pkg.product.identifier,
      amount: Number.isFinite(pkg.product.price) ? pkg.product.price : null,
      currencyCode: pkg.product.currencyCode || null,
      trial: trialOf(pkg),
      introOffer: introOfferOf(pkg),
    });
  }
  plans.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'yearly' ? -1 : 1));
  packages.set(id, byId);
  return plans.length > 0 ? { id, plans } : null;
}

/**
 * Whether this person still gets the plan's free trial (D52: 17's "Try Premium free for 7 days").
 * - No free intro period on the product: false.
 * - Android: Google Play only returns offers the account is eligible for, so a trial on the
 *   product means eligible (RevenueCat's check always says UNKNOWN there).
 * - iOS: RevenueCat's eligibility check must say ELIGIBLE; UNKNOWN or an error counts as not
 *   eligible, so trial copy is never shown to someone who wouldn't get it (REL BIZ-10).
 * Never throws.
 */
export async function checkTrialEligible(plan: Plan, os: string = Platform.OS): Promise<boolean> {
  if (!plan.trial) return false;
  if (!ensureConfigured()) return false;
  if (os === 'android') return true;
  try {
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility([plan.productId]);
    return (
      result[plan.productId]?.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE
    );
  } catch {
    return false;
  }
}

/**
 * The phone's second gate on the day-3 gift (D52): true only when the store **definitely** says
 * this person can't get the plan's introductory price (iOS `INELIGIBLE`; Android: Google Play
 * returned the product without the offer, which it does for an ineligible account). Unknown, an
 * error or no key reads as false: the server already decided the gift, and the store applies the
 * real price at checkout. Never throws.
 */
export async function checkIntroIneligible(plan: Plan, os: string = Platform.OS): Promise<boolean> {
  if (!ensureConfigured()) return false;
  if (os === 'android') return plan.introOffer === null;
  try {
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility([plan.productId]);
    return (
      result[plan.productId]?.status ===
      INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE
    );
  } catch {
    return false;
  }
}

function hasPremium(info: CustomerInfo | null | undefined): boolean {
  return Boolean(info?.entitlements?.active?.[ENTITLEMENT_ID]);
}

function failureOf(error: unknown): PurchaseFailure {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case PURCHASES_ERROR_CODE.NETWORK_ERROR:
    case PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR:
    case PURCHASES_ERROR_CODE.PRODUCT_REQUEST_TIMED_OUT_ERROR:
      return 'network';
    case PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR:
    case PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR:
      return 'alreadyOwned';
    case PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR:
      return 'pending';
    case PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR:
    case PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR:
    case PURCHASES_ERROR_CODE.PURCHASE_INVALID_ERROR:
    case PURCHASES_ERROR_CODE.INELIGIBLE_ERROR:
      return 'payment';
    case PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR:
    case PURCHASES_ERROR_CODE.CONFIGURATION_ERROR:
    case PURCHASES_ERROR_CODE.INVALID_CREDENTIALS_ERROR:
    case PURCHASES_ERROR_CODE.UNSUPPORTED_ERROR:
      return 'unavailable';
    default:
      return 'unknown';
  }
}

function isCancelled(error: unknown): boolean {
  const e = error as { code?: unknown; userCancelled?: unknown } | null;
  return e?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR || e?.userCancelled === true;
}

/**
 * Buy a plan from a loaded offering. Never throws. `signedOut` (P3 only) lets a person without an
 * account buy under RevenueCat's anonymous id.
 */
export async function purchasePlan(
  offeringId: OfferingId,
  planId: string,
  userId: string | null,
  { signedOut = false }: { signedOut?: boolean } = {},
): Promise<PurchaseOutcome> {
  if (!ensureConfigured()) return { kind: 'failed', reason: 'unavailable' };
  const pkg = packages.get(offeringId)?.get(planId);
  if (!pkg) return { kind: 'failed', reason: 'unavailable' };
  if (!(await readyToBuy(userId, signedOut))) return { kind: 'failed', reason: 'network' };
  try {
    const result = await Purchases.purchasePackage(pkg);
    return { kind: 'purchased', premiumHint: hasPremium(result.customerInfo) };
  } catch (error) {
    if (isCancelled(error)) return { kind: 'cancelled' };
    return { kind: 'failed', reason: failureOf(error) };
  }
}

/**
 * Restore this store account's purchases onto the signed-in user (or, P3 `signedOut`, onto the
 * anonymous id, moved to the account at sign-in). Never throws.
 */
export async function restorePurchases(
  userId: string | null,
  { signedOut = false }: { signedOut?: boolean } = {},
): Promise<RestoreOutcome> {
  if (!ensureConfigured()) return { kind: 'failed', reason: 'unavailable' };
  if (!(await readyToBuy(userId, signedOut))) return { kind: 'failed', reason: 'network' };
  try {
    const info = await Purchases.restorePurchases();
    return { kind: 'restored', premiumHint: hasPremium(info) };
  } catch (error) {
    return { kind: 'failed', reason: failureOf(error) };
  }
}

/** The store's own subscription management page (57 "Manage payment method"). */
export function manageSubscriptionsUrl(os: string): string {
  return os === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
}

/** Test seam: forget the configuration and loaded packages. */
export function resetPurchasesForTests(): void {
  configuredKey = null;
  identifiedAs = null;
  identifying = null;
  packages.clear();
}
