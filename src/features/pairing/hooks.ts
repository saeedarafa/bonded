import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import {
  acceptInvite,
  createInvite,
  getOpenInvite,
  invitePreview,
  type CreatedInvite,
  type InvitePreview,
  type OpenInvite,
} from '@/features/pairing/api';
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
 * The invite made in this session, kept in memory only: the token is returned once by
 * `create_invite` and must not touch disk, logs or analytics. Leaving and re-opening the invite
 * screen reuses it until it expires; after an app restart a fresh one is made.
 */
export const useMyInvite = create<MyInviteState>((set) => ({
  invite: null,
  set: (invite) => set({ invite }),
}));

/** `create_invite`: revokes the previous code and token, so only call it when one is needed. */
export function useCreateInvite() {
  return useMutation<CreatedInvite, AppError>({
    mutationFn: createInvite,
    onSuccess: (invite) => useMyInvite.getState().set(invite),
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
