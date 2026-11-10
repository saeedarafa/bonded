import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getActiveCouple, unpair, type ActiveCouple } from '@/features/couple/api';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

/**
 * My active couple, or null before onboarding has created it (`create_couple`, BE-03).
 * With `refetchInterval` (the partner-joined poll) it keeps polling while the app is not focused:
 * iOS reports "inactive" for system prompts (the "Open in Bonded?" link sheet, permission alerts),
 * and a paused poll left the inviter's 11 on Waiting. A backgrounded app has no JS timers anyway.
 */
export function useActiveCouple({
  enabled = true,
  refetchInterval,
}: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery<ActiveCouple | null, AppError>({
    queryKey: queryKeys.couple.active(),
    queryFn: getActiveCouple,
    enabled,
    ...(refetchInterval ? { refetchInterval, refetchIntervalInBackground: true } : {}),
  });
}

/** Two active members: the partner has joined (the solo couple has one). */
export function isCoupleComplete(couple: ActiveCouple | null | undefined): boolean {
  return (couple?.couple_members.filter((m) => m.left_at === null).length ?? 0) >= 2;
}

/** Leave the couple. Idempotent: a retry after success is success. */
export function useUnpair() {
  const queryClient = useQueryClient();
  return useMutation<void, AppError>({
    mutationFn: unpair,
    // Offline it fails at once with a message instead of a button that spins until reconnect.
    networkMode: 'always',
    // Everything about the old couple is stale (and ends up read-only, D08).
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
