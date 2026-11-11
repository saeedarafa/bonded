import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getAccountTimes } from '@/features/auth/api';
import { isNewAccount } from '@/features/onboarding/frontDoor';

import { getActiveCouple } from '@/features/couple/api';
import { finishOnboarding, type FinishResult } from '@/features/onboarding/finish';
import { useOnboarding } from '@/features/onboarding/store';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

export { isKeyDatesWriteError, KeyDatesWriteError } from '@/features/onboarding/finish';

/**
 * Writes what onboarding collected, once, right after sign-in: `finishOnboarding` (CONTRACTS §2
 * call order: profile, `create_couple`, ritual time, onboarding answers, T1, key dates). Every
 * step is safe to repeat, so a failed attempt can simply be retried. `skipKeyDates` drops the
 * dates (after a refused write) and finishes without them. On success the local answers are
 * dropped and the new couple and today's question are in the cache.
 */
export function useSetupBond() {
  const queryClient = useQueryClient();
  return useMutation<FinishResult, AppError, { userId: string; skipKeyDates?: boolean }>({
    mutationFn: async (input) => {
      const result = await finishOnboarding(input);
      // #93: the new couple is in the cache before the answers are cleared and SetupBond moves on,
      // so 09/10 never see the stale "no couple" and bounce to `/` (the story, for a new account).
      // A failed read is not a failed setup: the couple exists; the screens refetch it.
      await queryClient
        .fetchQuery({ queryKey: queryKeys.couple.active(), queryFn: getActiveCouple, staleTime: 0 })
        .catch(() => undefined);
      return result;
    },
    // The front door keeps SetupBond on screen while `useSetupInFlight` is set (SetupBond), so the
    // reset below can't redirect before SetupBond navigates to 09.
    onSuccess: () => {
      useOnboarding.getState().reset();
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
      // A P3 purchase was just synced (MOB-62): premium comes from the server row only.
      void queryClient.invalidateQueries({ queryKey: queryKeys.entitlements() });
      // T1 is now my answer to today's question: Today shows it locked until the partner answers.
      void queryClient.invalidateQueries({ queryKey: queryKeys.today.all });
    },
  });
}

/**
 * D40: is the signed-in account brand new (null while reading the stored session)? Read only when
 * `enabled`. A failure counts as an existing account: a returning person never sees the quiz again.
 */
export function useIsNewAccount(enabled: boolean, userId: string | null): boolean | null {
  const [result, setResult] = useState<{ userId: string; value: boolean } | null>(null);
  useEffect(() => {
    if (!enabled || !userId) return undefined;
    let active = true;
    getAccountTimes()
      .then((times) => {
        if (active) setResult({ userId, value: times ? isNewAccount(times) : false });
      })
      .catch(() => {
        if (active) setResult({ userId, value: false });
      });
    return () => {
      active = false;
    };
  }, [enabled, userId]);
  return result && result.userId === userId ? result.value : null;
}
