import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

export type EntitlementRow = Pick<Tables<'entitlements'>, 'user_id' | 'is_active' | 'expires_at'>;

/**
 * Premium state (CONTRACTS §2 "Premium state", §6): my row and my partner's. Written only by the
 * RevenueCat webhook (BE-18); RLS returns mine plus a current or recent partner's.
 */
export async function getEntitlements(): Promise<EntitlementRow[]> {
  return unwrap(await supabase.from('entitlements').select('user_id, is_active, expires_at')) ?? [];
}

export type OfferKind = 'intro' | 'winback';

/** `get_offer(kind)` (BE-17, D28): the server's answer, never computed in the app. */
export type ServerOffer = { eligible: boolean; expiresAt: string | null };

/**
 * `get_offer(p_kind)`: `{eligible, expires_at}`. The first eligible call starts the couple's one
 * shared 24-hour clock for that kind (server time); later calls return the same expiry. Anything
 * unexpected reads as "not eligible" (the paywall then uses `default`).
 */
export async function getOffer(kind: OfferKind): Promise<ServerOffer> {
  const data = unwrap(await supabase.rpc('get_offer', { p_kind: kind }));
  const row = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const expiresAt = typeof row.expires_at === 'string' ? row.expires_at : null;
  return { eligible: row.eligible === true && expiresAt !== null, expiresAt };
}
