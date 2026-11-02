import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createCouple } from '@/features/couple/api';
import { useOnboarding } from '@/features/onboarding/store';
import { deviceTimezone, updateMyProfile } from '@/features/profile/api';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Writes what onboarding collected, once, right after sign-in (BE-03): the profile name and
 * timezone first (the couple inherits the timezone), then `create_couple`. Both calls are safe to
 * repeat, so a failed attempt can simply be retried. On success the local answers are dropped.
 */
export function useSetupBond() {
  const queryClient = useQueryClient();
  return useMutation<string, AppError, { userId: string }>({
    mutationFn: async ({ userId }) => {
      const { displayName, stage, goals, partnerName } = useOnboarding.getState();
      if (displayName.trim()) {
        await updateMyProfile(userId, {
          displayName: displayName.trim(),
          timezone: deviceTimezone(),
        });
      }
      return createCouple({ stage, goals, partnerName: partnerName.trim() });
    },
    // Not awaited on purpose: the caller navigates to the invite step in the same tick, before the
    // refetched couple makes the front door (`app/index.tsx`) redirect to Today.
    onSuccess: () => {
      useOnboarding.getState().reset();
      void queryClient.invalidateQueries({ queryKey: queryKeys.couple.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}
