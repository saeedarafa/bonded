import { AppError, toAppError, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/** `create_invite()` result. The token exists only in this response (the DB keeps a hash). */
export type CreatedInvite = { code: string; expiresAt: string; token: string };

/** What `invite_preview` shows before sign-in: the inviter's first name and nothing else. */
export type InvitePreview = {
  inviterName: string;
  inviterAvatarUrl: string | null;
  inviterAnsweredToday: boolean;
  expiresAt: string | null;
};

/** The inviter's open invite, without the token. */
export type OpenInvite = { code: string; expiresAt: string; acceptedAt: string | null };

/** A new invite (BE-04). Revokes the previous code and token. Needs a couple (`create_couple`). */
export async function createInvite(): Promise<CreatedInvite> {
  const row = unwrap(await supabase.rpc('create_invite'));
  if (!row?.code || !row.expires_at || !row.token) throw toAppError(new Error('invite'));
  return { code: row.code, expiresAt: row.expires_at, token: row.token };
}

/** My latest unrevoked invite (RLS: mine only), for the expiry line when the token is gone. */
export async function getOpenInvite(): Promise<OpenInvite | null> {
  const row = unwrap(
    await supabase
      .from('pair_invites')
      .select('code, expires_at, accepted_at')
      .is('revoked_at', null)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row ? { code: row.code, expiresAt: row.expires_at, acceptedAt: row.accepted_at } : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * `invite_preview(code, token?)`: callable before sign-in. Counted failures (INVALID_CODE,
 * INVITE_EXPIRED, COUPLE_FULL) arrive as an HTTP 400 body, which supabase-js turns into an error
 * with the code as its message, so `unwrap` maps them like any raised error.
 */
export async function invitePreview(code: string, token: string | null): Promise<InvitePreview> {
  const body = asRecord(
    unwrap(
      await supabase.rpc('invite_preview', { p_code: code, ...(token ? { p_token: token } : {}) }),
    ),
  );
  if (typeof body.inviter_name !== 'string')
    throw new AppError('UNKNOWN', toAppError(null).message);
  return {
    inviterName: body.inviter_name,
    inviterAvatarUrl: typeof body.inviter_avatar_url === 'string' ? body.inviter_avatar_url : null,
    inviterAnsweredToday: body.inviter_answered_today === true,
    expiresAt: typeof body.expires_at === 'string' ? body.expires_at : null,
  };
}

/**
 * `accept_invite(code, token?)`: join the inviter's couple. A retry after success raises
 * ALREADY_PAIRED, which means done (CONTRACTS §2), so it resolves to `null` here.
 */
export async function acceptInvite(code: string, token: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('accept_invite', {
    p_code: code,
    ...(token ? { p_token: token } : {}),
  });
  if (error) {
    const appError = toAppError(error);
    if (appError.kind === 'ALREADY_PAIRED') return null;
    throw appError;
  }
  return typeof data === 'string' ? data : null;
}
