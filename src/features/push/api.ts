import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/**
 * Push data access (MOB-15, CONTRACTS §2). Token registration goes through the RPC so a token that
 * moved between accounts on one device follows the person who is signed in now.
 */
export async function registerPushToken(token: string, platform: 'ios' | 'android'): Promise<void> {
  unwrap(await supabase.rpc('register_push_token', { p_token: token, p_platform: platform }));
}

/** Own row only (RLS). Used on sign-out so the next person on this phone gets nothing of mine. */
export async function deletePushToken(token: string): Promise<void> {
  unwrap(await supabase.from('push_tokens').delete().eq('token', token));
}

/** Ritual time, local `HH:MM` (D23). The row exists from sign-up; the upsert only sets the time. */
export async function saveRitualTime(userId: string, ritualTime: string): Promise<void> {
  unwrap(
    await supabase
      .from('notification_prefs')
      .upsert({ user_id: userId, ritual_time: ritualTime }, { onConflict: 'user_id' }),
  );
}

/**
 * The partner's ritual time for J6 "Same as Maya". Not readable today: `notification_prefs` is own
 * row only (see Needs from backend). Kept behind this flag so J6 switches on with one line.
 */
export const PARTNER_RITUAL_AVAILABLE = false;

export async function getPartnerRitualTime(): Promise<string | null> {
  return null;
}
