import { isAuthRetryableFetchError } from '@supabase/supabase-js';

import { AppError, toAppError, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/**
 * Widget token RPCs (BE-60, CONTRACTS §2 `mint_widget_token` / `revoke_widget_tokens`, SEC-21
 * option A). The app mints, the widget never does. The token is returned once and is never
 * logged, sent to analytics or put in an error message.
 */

export type WidgetToken = { token: string; expiresAt: string };

/** `bwt_` + 43 base64url characters (32 random bytes). */
const TOKEN = /^bwt_[A-Za-z0-9_-]{43}$/;

export function isWidgetToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

/**
 * `mint_widget_token(p_device_id)`: a new 48 h token for this install; minting again on the same
 * device id revokes the previous one on the server. Errors: `NOT_AUTHENTICATED`, `NOT_PAIRED`,
 * `RATE_LIMITED` (20 mints per user per 24 h).
 */
export async function mintWidgetToken(deviceId: string): Promise<WidgetToken> {
  const data = unwrap(await supabase.rpc('mint_widget_token', { p_device_id: deviceId })) as {
    token?: unknown;
    expires_at?: unknown;
  } | null;
  const token = data?.token;
  const expiresAt = typeof data?.expires_at === 'string' ? data.expires_at : null;
  if (!isWidgetToken(token) || !expiresAt || Number.isNaN(Date.parse(expiresAt))) {
    // Never echo the reply: it may hold the token.
    throw new AppError('UNKNOWN', toAppError(null).message);
  }
  return { token, expiresAt };
}

/** `revoke_widget_tokens(p_device_id)`: null = every token of the caller (sign-out). */
export async function revokeWidgetTokens(deviceId: string | null = null): Promise<void> {
  unwrap(await supabase.rpc('revoke_widget_tokens', deviceId ? { p_device_id: deviceId } : {}));
}

export type WidgetSessionState = 'signedIn' | 'signedOut' | 'unknown';

/**
 * The background refresh (MOB-78b) asks supabase-js for the session, which refreshes an expired
 * access token itself (single-flight refresh per client plus a storage commit guard (lockless),
 * the same refresh token rotation as the foreground). A native refresher would race it and could
 * revoke the session (refresh-token reuse).
 * - `signedOut`: no session, either none stored or the refresh was refused for good (a
 *   non-retryable auth error such as a revoked refresh token, SEC-21 review): the caller forgets
 *   and unregisters in the same run.
 * - `unknown`: the refresh failed for a retryable reason (offline, 5xx) or threw; the caller keeps
 *   what it has.
 */
export async function widgetSessionState(): Promise<WidgetSessionState> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (data.session) return 'signedIn';
    if (!error) return 'signedOut';
    return isAuthRetryableFetchError(error) ? 'unknown' : 'signedOut';
  } catch {
    return 'unknown';
  }
}
