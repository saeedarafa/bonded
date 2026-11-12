import { useMutation, useQuery } from '@tanstack/react-query';

import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

import { getPartnerRitualTime, PARTNER_RITUAL_AVAILABLE } from './api';
import type { PermissionState } from './device';
import { acceptSoftAsk, type SoftAskScreen } from './softAsk';

/** The partner's ritual time for J6, or null while the backend can't share it. */
export function usePartnerRitualTime() {
  return useQuery<string | null, AppError>({
    queryKey: queryKeys.partnerRitualTime(),
    queryFn: getPartnerRitualTime,
    enabled: PARTNER_RITUAL_AVAILABLE,
  });
}

/** "Turn on reminders" on 09 / J6. Never fails: a declined prompt or a failed save still moves on. */
export function useAcceptSoftAsk() {
  return useMutation<
    PermissionState,
    AppError,
    { userId: string; ritualTime: string; screen: SoftAskScreen }
  >({
    mutationFn: ({ userId, ritualTime, screen }) => acceptSoftAsk(userId, ritualTime, screen),
    networkMode: 'always',
  });
}
