import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import {
  acceptInvite,
  createInvite,
  getOpenInvite,
  inviteLink,
  invitePreview,
  type CreatedInvite,
  type InvitePreview,
  type OpenInvite,
} from '@/features/pairing/api';
import {
  currentInvite,
  inviteStatus,
  type InviteStatus,
  type ShownInvite,
} from '@/features/pairing/invite';
import type { AppError } from '@/lib/errors';
import { deviceTimezone, updateMyProfile } from '@/features/profile/api';
import { queryKeys } from '@/lib/queryKeys';

/** Poll fallback while someone waits for their partner; realtime normally gets there first. */
const PARTNER_POLL_MS = 5000;

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

/** Before sign-in: who is inviting? Counts against the failed-attempt limiter, so call it on submit. */
export function useInvitePreview() {
  return useMutation<InvitePreview, AppError, { code: string; token: string | null }>({
    mutationFn: ({ code, token }) => invitePreview(code, token),
  });
}

/** Join the inviter's couple. On success the invite is spent and every cached query is stale. */
export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation<string | null, AppError, { code: string; token: string | null }>({
    mutationFn: ({ code, token }) => acceptInvite(code, token),
    onSuccess: async () => {
      usePendingInvite.getState().clear();
      await queryClient.invalidateQueries();
    },
  });
}

/**
 * J5: save my name, then join (`accept_invite`). The name is written first and again on a retry,
 * which is harmless; the accept is idempotent too (ALREADY_PAIRED after success counts as done).
 */
export function useJoinPartner() {
  const queryClient = useQueryClient();
  return useMutation<
    string | null,
    AppError,
    { userId: string; displayName: string; code: string; token: string | null }
  >({
    mutationFn: async ({ userId, displayName, code, token }) => {
      await updateMyProfile(userId, { displayName, timezone: deviceTimezone() });
      return acceptInvite(code, token);
    },
    onSuccess: async () => {
      usePendingInvite.getState().clear();
      await queryClient.invalidateQueries();
    },
  });
}
