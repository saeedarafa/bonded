import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

import { toServerOffer, type OfferKind, type ServerOffer } from './offers';

export type EntitlementRow = Pick<Tables<'entitlements'>, 'user_id' | 'is_active' | 'expires_at'>;

/**
 * Premium state (CONTRACTS §2 "Premium state", §6): my row and my partner's. Written only by the
 * RevenueCat webhook (BE-18); RLS returns mine plus a current or recent partner's.
 */
export async function getEntitlements(): Promise<EntitlementRow[]> {
  return unwrap(await supabase.from('entitlements').select('user_id, is_active, expires_at')) ?? [];
}

/**
 * `get_offer('day3')` (CONTRACTS §2, BE-47, D52): read-only, never starts anything. The server
 * alone decides whether the couple's day-3 gift is live; `server_now` drives the countdown.
 */
export async function getOffer(kind: OfferKind): Promise<ServerOffer> {
  return toServerOffer(unwrap(await supabase.rpc('get_offer', { p_kind: kind })));
}

/**
 * `open_offer('day3')`: the first open by either partner starts the shared 12-hour clock
 * (`expires_at = first_opened_at + 12 h`); later calls change nothing and never extend it.
 * Grants nothing: the purchase is the RevenueCat `day3` offering.
 */
export async function openOffer(kind: OfferKind): Promise<ServerOffer> {
  return toServerOffer(unwrap(await supabase.rpc('open_offer', { p_kind: kind })));
}

/** Unsolicited full-screen offers the app may claim (CONTRACTS §2 `claim_offer_screen`). */
export type OfferScreen = 'gift';

/**
 * `claim_offer_screen(p_screen)` (D52 "at most one full-screen offer per person per day"): call
 * right before opening 14 by itself; open it only on `true`. Same screen again that day: `true`.
 */
export async function claimOfferScreen(screen: OfferScreen): Promise<boolean> {
  return unwrap(await supabase.rpc('claim_offer_screen', { p_screen: screen })) === true;
}

/** What `revenuecat-sync` said: `ok` (the server row is fresh), or why it should be retried. */
export type SyncResult = 'ok' | 'rateLimited' | 'signedOut' | 'retry';

/**
 * `revenuecat-sync` (CONTRACTS §3, BE-48): after `Purchases.logIn(uid)`, the server re-reads the
 * caller's own RevenueCat record and writes `entitlements` (no webhook fires for the alias of an
 * anonymous P3 purchase). The body is ignored by the server. Never throws: `429` → `rateLimited`
 * (one call per user per 30 s), `401` → `signedOut`, anything else (503, 500, offline) → `retry`.
 */
export async function syncRevenueCat(): Promise<SyncResult> {
  try {
    const { data, error } = await supabase.functions.invoke('revenuecat-sync', {
      method: 'POST',
      body: {},
    });
    if (!error) return (data as { ok?: unknown } | null)?.ok === true ? 'ok' : 'retry';
    const status = (error as { context?: { status?: unknown } }).context?.status;
    if (status === 429) return 'rateLimited';
    if (status === 401) return 'signedOut';
    return 'retry';
  } catch {
    return 'retry';
  }
}
