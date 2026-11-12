import { create } from 'zustand';

import type { MyJoinRequest } from '@/features/pairing/api';
import { t } from '@/i18n';
import type { AppError } from '@/lib/errors';

/**
 * BE-26 (D02), the joiner's side of a typed code: `accept_invite` without a link token asks the
 * inviter to confirm. This is what the waiting screen needs, kept in memory only (like the invite
 * itself): after an app restart the request is still on the server and simply lapses.
 */
export type PendingJoin = {
  requestId: string;
  expiresAt: string;
  /** The typed code, so "Ask again" can send a new request after this one timed out. */
  code: string;
  /** From `invite_preview` (J3/J5); null when the code was typed on 12 without a preview. */
  inviterName: string | null;
  /** Where the join started: J5 goes on to J6 (reminders), 12 to 13 (paired). */
  origin: 'J5' | '12';
  /** The request carried the D37 consent (analytics `join_completed.archived_solo`). */
  archivedSolo?: boolean;
};

type PendingJoinState = {
  pending: PendingJoin | null;
  set: (pending: PendingJoin) => void;
  clear: () => void;
};

export const usePendingJoin = create<PendingJoinState>((set) => ({
  pending: null,
  set: (pending) => set({ pending }),
  clear: () => set({ pending: null }),
}));

export type JoinerState = 'waiting' | 'approved' | 'declined' | 'expired';

/**
 * Pure: what the waiting screen shows. `row` is my `join_requests` row (undefined while loading,
 * null when it is gone). `paired` = my active couple has two members (the approval landed).
 * Expiry is lazy on the server (a row stays `pending` past `expires_at` until an RPC touches it),
 * so a passed `expires_at` reads as expired here; the server stays the judge on "Ask again".
 */
export function joinerState(
  row: MyJoinRequest | null | undefined,
  expiresAt: string,
  paired: boolean,
  now: number = Date.now(),
): JoinerState {
  if (paired || row?.status === 'approved') return 'approved';
  if (row?.status === 'declined') return 'declined';
  if (row === null || row?.status === 'expired') return 'expired';
  const until = Date.parse(row?.expiresAt ?? expiresAt);
  return Number.isFinite(until) && until <= now ? 'expired' : 'waiting';
}

/**
 * Joiner-side copy for `accept_invite` errors that mean something specific here (BE-26):
 * JOIN_REQUEST_FORBIDDEN = the inviter already declined me for this invite; RATE_LIMITED = too
 * many tries, or this invite already has 3 people waiting. Everything else keeps its message.
 */
export function joinErrorMessage(error: AppError, inviterName: string | null | undefined): string {
  const name = inviterName?.trim() || t('pairing.partnerFallback');
  if (error.kind === 'JOIN_REQUEST_FORBIDDEN') return t('pairing.pending.forbidden', { name });
  if (error.kind === 'RATE_LIMITED') return t('pairing.pending.rateLimited');
  // BE-35 on a path without the D37 sheet ("Ask again"): the joiner confirms from J5/12 again.
  if (error.kind === 'CONFIRM_ARCHIVE') return t('pairing.pending.confirmArchive');
  return error.message;
}
