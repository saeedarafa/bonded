import type { PostgrestError } from '@supabase/supabase-js';

import { AppError, toAppError, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

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

/** `invite_link()` result (BE-28): the current code with a NEW link token; the code stays the same. */
export type InviteLinkResult = CreatedInvite;

/**
 * PostgREST "function not found" (PGRST202) or a plain 404: the RPC isn't deployed on this stack.
 * Treated like "no link available", so the app shares the code on its own.
 */
function isMissingFunction(error: PostgrestError): boolean {
  const status = (error as { status?: unknown }).status;
  return error.code === 'PGRST202' || status === 404;
}

/**
 * `invite_link()` (BE-28, D36): a fresh link token for my CURRENT open invite. Unlike
 * `create_invite` it never revokes the code or earlier links. Null when there is no open invite
 * (SQL null, or PostgREST's all-null composite) or the RPC isn't on this backend. May raise
 * RATE_LIMITED (10 links per invite). The token is returned once and stays in memory only.
 */
export async function inviteLink(): Promise<InviteLinkResult | null> {
  const { data, error } = await supabase.rpc('invite_link');
  if (error) {
    if (isMissingFunction(error)) return null;
    throw toAppError(error);
  }
  const row = asRecord(Array.isArray(data) ? data[0] : data);
  const { code, expires_at: expiresAt, token } = row;
  if (typeof code !== 'string' || typeof expiresAt !== 'string' || typeof token !== 'string')
    return null;
  return { code, expiresAt, token };
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
 * What `accept_invite` did (BE-26, D02):
 * - `paired`: a valid link token joined at once (`coupleId`), or a retry after success raised
 *   ALREADY_PAIRED, which means done (CONTRACTS §2, `coupleId` null);
 * - `pending`: a typed code asked the inviter to confirm; nothing is paired until they approve.
 */
export type AcceptResult =
  | { kind: 'paired'; coupleId: string | null }
  | { kind: 'pending'; requestId: string; expiresAt: string };

/** `accept_invite`'s json: a couple-id string, or `{status:'pending', request_id, expires_at}`. */
export function parseAcceptResult(data: unknown): AcceptResult {
  if (typeof data === 'string') return { kind: 'paired', coupleId: data };
  const body = asRecord(data);
  if (
    body.status === 'pending' &&
    typeof body.request_id === 'string' &&
    typeof body.expires_at === 'string'
  ) {
    return { kind: 'pending', requestId: body.request_id, expiresAt: body.expires_at };
  }
  // Never guess "paired" from a shape we don't know: the joiner would skip the inviter's yes.
  throw toAppError(null);
}

/** `accept_invite(code, token?)`: join the inviter's couple, or ask them to confirm (typed code). */
export async function acceptInvite(code: string, token: string | null): Promise<AcceptResult> {
  const { data, error } = await supabase.rpc('accept_invite', {
    p_code: code,
    ...(token ? { p_token: token } : {}),
  });
  if (error) {
    const appError = toAppError(error);
    if (appError.kind === 'ALREADY_PAIRED') return { kind: 'paired', coupleId: null };
    throw appError;
  }
  return parseAcceptResult(data);
}

/** The longest requester name the backend sends (SEC-04); also enforced here for the layout. */
export const REQUESTER_NAME_MAX = 30;

/**
 * Someone typed my code and waits for my yes (BE-26). `requesterName` is the first name THEY
 * typed: a recognition cue, not a verified identity. May be empty.
 */
export type JoinRequest = { requestId: string; requesterName: string; expiresAt: string };

/** `pending_join_requests()`: live requests on my open invite (inviter only; others get none). */
export async function getPendingJoinRequests(): Promise<JoinRequest[]> {
  const rows = unwrap(await supabase.rpc('pending_join_requests')) ?? [];
  return rows
    .filter((r) => typeof r.request_id === 'string' && typeof r.expires_at === 'string')
    .map((r) => ({
      requestId: r.request_id,
      requesterName: (r.requester_name ?? '').trim().slice(0, REQUESTER_NAME_MAX),
      expiresAt: r.expires_at,
    }));
}

/** `approve_join(request)`: pairs the requester into my couple; returns the couple id. */
export async function approveJoin(requestId: string): Promise<string | null> {
  const data = unwrap(await supabase.rpc('approve_join', { p_request: requestId }));
  return typeof data === 'string' ? data : null;
}

/** `decline_join(request)`: they can't ask again with this invite (a fresh invite resets it). */
export async function declineJoin(requestId: string): Promise<void> {
  unwrap(await supabase.rpc('decline_join', { p_request: requestId }));
}

export type JoinRequestStatus = Database['public']['Enums']['join_request_status'];

/** The joiner's own request (RLS: requester or inviter). Null when it is gone. */
export type MyJoinRequest = { status: JoinRequestStatus; expiresAt: string };

export async function getMyJoinRequest(requestId: string): Promise<MyJoinRequest | null> {
  const row = unwrap(
    await supabase
      .from('join_requests')
      .select('status, expires_at')
      .eq('id', requestId)
      .maybeSingle(),
  );
  return row ? { status: row.status, expiresAt: row.expires_at } : null;
}
