import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getStreak, getTodayQuestion, sendNudge, type TodayQuestion } from '@/features/daily/api';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

import { normalizeStreak, secondsUntilNextQuestion, type Streak } from './today';

/** Today's question with who has answered (realtime invalidates `today` and `streak`). */
export function useTodayQuestion({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<TodayQuestion, AppError>({
    queryKey: queryKeys.today.question(),
    queryFn: getTodayQuestion,
    enabled,
  });
}

export function useStreak({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<Streak, AppError>({
    queryKey: queryKeys.streak(),
    queryFn: async () => normalizeStreak(await getStreak()),
    enabled,
  });
}

/**
 * Seconds until the next question (local midnight in the couple's timezone), ticking every second.
 * At zero, today's question and the streak are refetched: a new day has started.
 */
export function useNextQuestionCountdown(timeZone: string | null | undefined): number {
  const queryClient = useQueryClient();
  const [seconds, setSeconds] = useState(() => secondsUntilNextQuestion(new Date(), timeZone));
  useEffect(() => {
    // A new timezone shows up on the next tick (within a second).
    let last = secondsUntilNextQuestion(new Date(), timeZone);
    const timer = setInterval(() => {
      const next = secondsUntilNextQuestion(new Date(), timeZone);
      // Wrapped past midnight (or the zone changed): a new question is waiting.
      if (next > last) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.today.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.streak() });
      }
      last = next;
      setSeconds(next);
    }, 1000);
    return () => clearInterval(timer);
  }, [timeZone, queryClient]);
  return seconds;
}

/** `send_nudge()` (BE-10). Errors carry the partner's name for PARTNER_ALREADY_ANSWERED. */
export function useNudge(partner: string) {
  const queryClient = useQueryClient();
  return useMutation<void, AppError>({
    mutationFn: () => sendNudge({ partner }),
    // PARTNER_ALREADY_ANSWERED means today moved on: refresh it either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.today.all }),
  });
}
