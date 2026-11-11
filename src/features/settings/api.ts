import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  isAuthApiError,
} from '@supabase/supabase-js';

import { t } from '@/i18n';
import { AppError, messageFor, toAppError, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database, Tables } from '@/types/database';

/**
 * Settings data access (MOB-18, CONTRACTS §2/§3): notification preferences, couple settings, the
 * ended couple a partner left (58), and the `delete-account` edge function.
 */

export type NotificationPrefs = Pick<
  Tables<'notification_prefs'>,
  | 'ritual_time'
  | 'daily_reminder'
  | 'partner_answered'
  | 'replies'
  | 'last_call'
  | 'nudges'
  | 'little_things'
  | 'little_things_sound'
  | 'tips'
  | 'quiet_start'
  | 'quiet_end'
>;

/**
 * The per-type switches on 41 (D23), in board order. `little_things` (BE-45, D48/D53) shows only
 * once little things ship (D27).
 */
export const PUSH_TOGGLES = [
  'daily_reminder',
  'partner_answered',
  'replies',
  'last_call',
  'nudges',
  'little_things',
  'tips',
] as const;
export type PushToggle = (typeof PUSH_TOGGLES)[number];

/** CONTRACTS §2 defaults (the row is created with the account): used only if it is missing. */
export const DEFAULT_PREFS: NotificationPrefs = {
  ritual_time: '21:00',
  daily_reminder: true,
  partner_answered: true,
  replies: true,
  last_call: true,
  nudges: true,
  little_things: true,
  little_things_sound: true,
  tips: false,
  quiet_start: '23:00',
  quiet_end: '07:00',
};

const PREF_COLUMNS =
  'ritual_time, daily_reminder, partner_answered, replies, last_call, nudges, little_things, little_things_sound, tips, quiet_start, quiet_end';

/** My row (RLS: own row only). Null only if the sign-up default row is missing. */
export async function getNotificationPrefs(): Promise<NotificationPrefs | null> {
  return unwrap(await supabase.from('notification_prefs').select(PREF_COLUMNS).maybeSingle());
}

/** Saves only the changed columns; the upsert also covers a missing row (CONTRACTS §2). */
export async function saveNotificationPrefs(
  userId: string,
  patch: Partial<NotificationPrefs>,
): Promise<void> {
  unwrap(
    await supabase
      .from('notification_prefs')
      .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' }),
  );
}

type Stage = Database['public']['Enums']['couple_stage'];

/** Couple settings on 42: stage and topics (`goals`). Status and ids stay server-owned. */
export async function updateCoupleSettings(
  coupleId: string,
  fields: { stage?: Stage; goals?: string[] },
): Promise<void> {
  unwrap(await supabase.from('couples').update(fields).eq('id', coupleId));
}

export type EndedCouple = Pick<
  Tables<'couples'>,
  'id' | 'ended_at' | 'paired_at' | 'ended_by' | 'ended_reason'
> & {
  couple_members: { user_id: string; left_at: string | null }[];
};

/**
 * My most recent ended couple that had a partner (`paired_at` set), readable for 30 days (D08,
 * D09). A solo space archived by joining someone (D04, D37) never had a partner, so it is skipped.
 * `ended_by` / `ended_reason` (BE-38) say who ended it and how; both are null on older couples.
 */
export async function getLatestEndedCouple(): Promise<EndedCouple | null> {
  return unwrap(
    await supabase
      .from('couples')
      .select('id, ended_at, paired_at, ended_by, ended_reason, couple_members(user_id, left_at)')
      .eq('status', 'ended')
      .not('paired_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
}

/** A former partner's first name, if RLS still lets me read their profile (else null). */
export async function getProfileName(userId: string): Promise<string | null> {
  const row = unwrap(
    await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
  );
  return row?.display_name?.trim() || null;
}

/**
 * `delete-account` (BE-16): deletes the signed-in Auth user; the server ends the couple first so
 * the partner keeps their own answers (D09). `200 {ok:true}`; a retry after success is also 200.
 * The function's error bodies are not `error_code`s, so they map to network / signed-out / generic.
 */
export async function deleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-account', {
    method: 'POST',
    body: {},
  });
  if (!error) {
    if ((data as { ok?: unknown } | null)?.ok === true) return;
    throw new AppError('UNKNOWN', messageFor('UNKNOWN'));
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    throw new AppError('NETWORK', messageFor('NETWORK'));
  }
  if (error instanceof FunctionsHttpError) {
    const status = (error.context as { status?: unknown } | undefined)?.status;
    if (status === 401) throw new AppError('SIGNED_OUT', messageFor('SIGNED_OUT'));
    // 503 AUTH_UNAVAILABLE (BE-39): Auth itself is unreachable, nothing was deleted and the
    // session is still good. Retryable (UNKNOWN), never a sign-out or a local wipe.
    if (status === 503) throw new AppError('UNKNOWN', t('settings.delete.authUnavailable'));
    throw new AppError('UNKNOWN', messageFor('UNKNOWN'));
  }
  throw toAppError(error);
}

/**
 * Auth's own answer that the signed-in user no longer exists. GoTrue's `GET /user` answers a valid
 * JWT whose `sub` has no `auth.users` row with 403 `{ code: "user_not_found" }`; auth-js (2.118)
 * turns that into an `AuthApiError` with `code === 'user_not_found'`. Nothing else counts: an
 * expired or revoked session (`session_not_found`, `refresh_token_not_found`, `bad_jwt`), a
 * network failure or an Auth outage says nothing about whether the account is gone.
 */
export function isUserGoneError(error: unknown): boolean {
  return isAuthApiError(error) && error.code === 'user_not_found';
}

/**
 * After `delete-account` answered 401: ask Auth once whether my user still exists. True only when
 * Auth confirms it is gone (see `isUserGoneError`); false for a live user or any other failure.
 * Never throws.
 */
export async function isAccountGone(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.getUser();
    return isUserGoneError(error);
  } catch {
    return false;
  }
}
