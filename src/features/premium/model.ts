import type { EntitlementRow } from './api';

export type PremiumState = {
  /** Either current member has an active, unexpired premium row (`is_couple_premium`, D29). */
  isPremium: boolean;
  /** My own subscription. */
  mine: boolean;
  /** My current partner's subscription. */
  partner: boolean;
};

function active(row: EntitlementRow | undefined, now: number): boolean {
  if (!row?.is_active) return false;
  return row.expires_at === null || Date.parse(row.expires_at) > now;
}

/**
 * Mirrors `private.is_couple_premium()`: only my row and my **current** partner's count. RLS can
 * also return a recently unpaired partner's row (ended couples, 30 days); that one doesn't cover me.
 */
export function premiumState(
  rows: readonly EntitlementRow[] | undefined,
  myId: string | null,
  partnerId: string | null,
  now: number,
): PremiumState {
  const mine =
    myId !== null &&
    active(
      rows?.find((r) => r.user_id === myId),
      now,
    );
  const partner =
    partnerId !== null &&
    active(
      rows?.find((r) => r.user_id === partnerId),
      now,
    );
  return { isPremium: mine || partner, mine, partner };
}
