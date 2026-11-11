import type { Plan } from './purchases';

/**
 * Price arithmetic for the paywalls (D52, REL BIZ-01/BIZ-13). Every input is a number the store
 * gave RevenueCat; nothing here knows a price or a currency. When a number is missing, the caller
 * leaves the line out instead of guessing.
 */

/**
 * "Save [X]%": 1 − yearly ÷ (12 × monthly), rounded **down** so it is never overstated. Null when
 * either price is unknown, the currencies differ, or yearly saves nothing.
 */
export function savePercent(yearly: Plan | undefined, monthly: Plan | undefined): number | null {
  if (!yearly || !monthly) return null;
  const y = yearly.amount;
  const m = monthly.amount;
  if (y === null || m === null || !(y > 0) || !(m > 0)) return null;
  if (yearly.currencyCode && monthly.currencyCode && yearly.currencyCode !== monthly.currencyCode)
    return null;
  const pct = Math.floor((1 - y / (12 * m)) * 100 + 1e-9);
  return pct >= 1 && pct < 100 ? pct : null;
}

/** Formats an amount in the store's currency, or null if this device can't. */
function formatAmount(amount: number, currencyCode: string): string | null {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(
      amount,
    );
  } catch {
    return null;
  }
}

/**
 * 16 / P3 "[PRICE] per person / month": the store's yearly price ÷ 12 ÷ 2 (one plan covers two
 * people), formatted in the store's currency with the device's number format. Null when the store
 * gave no amount or currency, or this device can't format it (the card then shows the yearly price).
 */
export function perPersonMonthly(yearly: Plan | undefined): string | null {
  if (!yearly || yearly.kind !== 'yearly') return null;
  if (yearly.amount === null || !(yearly.amount > 0) || !yearly.currencyCode) return null;
  return formatAmount(yearly.amount / 24, yearly.currencyCode);
}
