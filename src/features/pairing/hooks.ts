import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { create } from 'zustand';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import {
  acceptInvite,
  approveJoin,
  createInvite,
  declineJoin,
  getMyJoinRequest,
  getOpenInvite,
  getPendingJoinRequests,
  inviteLink,
  invitePreview,
  type AcceptResult,
  type CreatedInvite,
  type InvitePreview,
  type JoinRequest,
  type MyJoinRequest,
  type OpenInvite,
} from '@/features/pairing/api';
import {
  currentInvite,
  inviteStatus,
  type InviteStatus,
  type ShownInvite,
} from '@/features/pairing/invite';
import { usePendingJoin, type PendingJoin } from '@/features/pairing/joinRequest';
import type { AppError } from '@/lib/errors';
import { deviceTimezone, updateMyProfile } from '@/features/profile/api';
import { queryKeys } from '@/lib/queryKeys';
import { useJoinRequestRealtime } from '@/lib/useJoinRequestRealtime';

/** Poll fallback while someone waits for their partner; realtime normally gets there first. */
const PARTNER_POLL_MS = 5000;
/** Fallback poll for join requests (BE-26); Realtime on `join_requests` normally arrives first. */
const JOIN_REQUEST_POLL_MS = 10000;

type MyInviteState = {
  invite: CreatedInvite | null;
  set: (invite: CreatedInvite | null) => void;
};

/**
 * The invite token from this session, kept in memory only: it is returned once by `create_invite`
 * or `invite_link` and must not touch disk, logs or analytics. After an app restart it is gone, but
 * the code is not: 10 and Today read it from `pair_invites` (D36).
 */
export const useMyInvite = create<MyInviteState>((set) => ({
  invite: null,
  set: (invite) => set({ invite }),
}));

/**
 * #38: results that carry an invite token (a working join link while the invite is open) stay out
 * of the mutation cache (gcTime 0), are never queued offline or persisted, and are never retried
 * on their own (a retry of `create_invite` would revoke the code it just made). Same rules as the
 * email-callback mutation in src/features/auth/hooks.ts.
 */
const TOKEN_MUTATION = { networkMode: 'always', retry: false, gcTime: 0 } as const;

/**
 * `create_invite`: revokes the previous code and token, so only call it when there is no open code
 * or the person confirmed "Make a new code" (D36).
 */
export function useCreateInvite() {
  const queryClient = useQueryClient();
  return useMutation<CreatedInvite, AppError>({
    mutationFn: createInvite,
    ...TOKEN_MUTATION,
    onSuccess: (invite) => {
      useMyInvite.getState().set(invite);
      const open: OpenInvite = { code: invite.code, expiresAt: invite.expiresAt, acceptedAt: null };
      queryClient.setQueryData(queryKeys.invite.open(), open);
    },
  });
}

/**
 * `invite_link()` (BE-28): a link token for the current code, never a new code. Null when there
 * is no open invite or the backend doesn't have the RPC yet. A token for the shown code is kept in
 * memory, so sharing again reuses it instead of using up the 10 links per invite.
 */
export function useInviteLink() {
  return useMutation<CreatedInvite | null, AppError>({
    mutationFn: inviteLink,
    ...TOKEN_MUTATION,
    onSuccess: (link) => {
      if (link) useMyInvite.getState().set(link);
    },
  });
}

/** The latest open invite (no token), e.g. to show "expires in" after a restart. */
export function useOpenInvite(enabled = true) {
  return useQuery<OpenInvite | null, AppError>({
    queryKey: queryKeys.invite.open(),
    queryFn: getOpenInvite,
    enabled,
  });
}

export type CurrentInvite = {
  /** The code to show (with the token when this session has it), or null. */
  invite: ShownInvite | null;
  status: InviteStatus;
  /** The open invite (code and expiry) as read from `pair_invites`, for the expired state. */
  open: OpenInvite | null | undefined;
  error: AppError | null;
  refetch: () => void;
};

/** D36: the inviter's current code, from `pair_invites` plus the in-memory token. */
export function useCurrentInvite(enabled = true): CurrentInvite {
  const stored = useMyInvite((s) => s.invite);
  const open = useOpenInvite(enabled);
  const invite = currentInvite(stored, open.data);
  let status = inviteStatus(invite, open.data);
  if (status === 'loading' && open.error) status = 'none';
  return {
    invite,
    status,
    open: open.data,
    error: open.error,
    refetch: () => void open.refetch(),
  };
}

/** Solo: I'm in a couple and nobody else is in it yet (D37 entry points, the Today card). */
export function useIsSolo(): boolean {
  const couple = useActiveCouple();
  return !!couple.data && !isCoupleComplete(couple.data);
}

/**
 * Partner-joined detection for the inviter: true once the couple has two active members. Realtime
 * on `couple_members` (see the pairing layout) invalidates the couple query; the interval covers
 * a dropped socket.
 */
export function usePartnerJoined() {
  const couple = useActiveCouple({ refetchInterval: PARTNER_POLL_MS });
  return { couple: couple.data ?? null, joined: isCoupleComplete(couple.data) };
}

/**
 * Before sign-in: who is inviting? Counts against the failed-attempt limiter, so call it on submit.
 * A link token may bring a signed avatar URL (MOB-35): kept out of the mutation cache (gcTime 0),
 * only in the screen's state while it shows.
 */
export function useInvitePreview() {
  return useMutation<InvitePreview, AppError, { code: string; token: string | null }>({
    mutationFn: ({ code, token }) => invitePreview(code, token),
    gcTime: 0,
  });
}

/**
 * J2 (MOB-35): the inviter's signed avatar for a link we hold in memory. Asks once per code and
 * token; without a token (typed code) nothing is called and the initial shows. Any failure = null.
 */
export function useLinkAvatar(code: string | null, token: string | null): string | null {
  const { mutate, data } = useMutation<InvitePreview, AppError, { code: string; token: string }>({
    mutationFn: (vars) => invitePreview(vars.code, vars.token),
    ...TOKEN_MUTATION,
  });
  useEffect(() => {
    if (code && token) mutate({ code, token });
  }, [code, token, mutate]);
  return code && token ? (data?.inviterAvatarUrl ?? null) : null;
}

type JoinVars = { code: string; token: string | null };

/**
 * After `accept_invite`: paired -> the invite is spent and every cached query is stale; pending ->
 * the waiting screen takes over with what it needs (the code stays only for "Ask again").
 */
async function settleAccept(
  queryClient: QueryClient,
  result: AcceptResult,
  vars: JoinVars,
  origin: PendingJoin['origin'],
) {
  const invite = usePendingInvite.getState();
  if (result.kind === 'pending') {
    // "Ask again" on the waiting screen keeps the name from the first request.
    const previous = usePendingJoin.getState().pending;
    const inviterName =
      invite.code === vars.code
        ? invite.inviterName
        : previous?.code === vars.code
          ? previous.inviterName
          : null;
    usePendingJoin.getState().set({
      requestId: result.requestId,
      expiresAt: result.expiresAt,
      code: vars.code,
      inviterName,
      origin,
    });
    invite.clear();
    return;
  }
  usePendingJoin.getState().clear();
  invite.clear();
  await queryClient.invalidateQueries();
}

/**
 * Join the inviter's couple (12, and "Ask again" on the waiting screen). A typed code without a
 * link token returns `pending` (BE-26): the inviter confirms first.
 */
export function useAcceptInvite(origin: PendingJoin['origin'] = '12') {
  const queryClient = useQueryClient();
  return useMutation<AcceptResult, AppError, JoinVars>({
    mutationFn: ({ code, token }) => acceptInvite(code, token),
    onSuccess: (result, vars) => settleAccept(queryClient, result, vars, origin),
  });
}

/**
 * J5: save my name, then join (`accept_invite`). The name is written first and again on a retry,
 * which is harmless; the accept is idempotent too (ALREADY_PAIRED after success counts as done,
 * and a typed retry while pending returns the same request).
 */
export function useJoinPartner() {
  const queryClient = useQueryClient();
  return useMutation<AcceptResult, AppError, JoinVars & { userId: string; displayName: string }>({
    mutationFn: async ({ userId, displayName, code, token }) => {
      await updateMyProfile(userId, { displayName, timezone: deviceTimezone() });
      return acceptInvite(code, token);
    },
    onSuccess: (result, vars) => settleAccept(queryClient, result, vars, 'J5'),
  });
}

/**
 * The joiner's own request while it waits: my `join_requests` row, refetched on its Realtime
 * events (a channel just for this row) and on a slow poll in case the socket drops.
 */
export function useMyJoinRequest(requestId: string | null | undefined) {
  useJoinRequestRealtime(requestId);
  return useQuery<MyJoinRequest | null, AppError>({
    queryKey: queryKeys.joinRequests.mine(requestId ?? ''),
    queryFn: () => getMyJoinRequest(requestId ?? ''),
    enabled: !!requestId,
    refetchInterval: JOIN_REQUEST_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

/**
 * The inviter's side: who typed my code and waits for my yes (`pending_join_requests()`). Names
 * aren't in the Realtime rows, so every `join_requests` event on the couple channel refetches this
 * (see src/lib/realtime.ts), and it refetches whenever a card is about to show (mount).
 */
export function usePendingJoinRequests(enabled: boolean) {
  return useQuery<JoinRequest[], AppError>({
    queryKey: queryKeys.joinRequests.pending(),
    queryFn: getPendingJoinRequests,
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: JOIN_REQUEST_POLL_MS,
  });
}

/** `approve_join`: the requester becomes my partner; every cached query is stale. */
export function useApproveJoin() {
  const queryClient = useQueryClient();
  return useMutation<string | null, AppError, string>({
    mutationFn: approveJoin,
    retry: false,
    onSuccess: () => queryClient.invalidateQueries(),
    // Expired or decided meanwhile: the list is out of date either way.
    onError: () => queryClient.invalidateQueries({ queryKey: queryKeys.joinRequests.all }),
  });
}

/** `decline_join`: that person can't ask again with this invite (a new code resets it). */
export function useDeclineJoin() {
  const queryClient = useQueryClient();
  return useMutation<void, AppError, string>({
    mutationFn: declineJoin,
    retry: false,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.joinRequests.all }),
  });
}
