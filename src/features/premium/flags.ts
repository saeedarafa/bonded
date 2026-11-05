import type { OfferingId } from './purchases';

/**
 * `get_offer(kind)` (BE-17, D28) decides when a couple sees the `intro` or `winback` offering.
 * It isn't merged yet, so this stays off and every paywall uses `default`. When BE-17 lands, turn
 * it on and fill in `serverOfferingFor()` from the RPC (the server decides eligibility and expiry).
 */
export const SERVER_OFFERS_ENABLED = false;

/** The offering the server grants right now, or null for `default`. Stub until BE-17. */
export async function serverOfferingFor(): Promise<Exclude<OfferingId, 'default'> | null> {
  return null;
}
