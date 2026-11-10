import { useQuery } from '@tanstack/react-query';

import { getHistoryMonth } from '@/features/history/api';
import type { DayRow } from '@/features/history/model';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

import {
  getAnswerBody,
  getLovedAnswer,
  getWeeklyRecap,
  type LovedAnswer,
  type WeeklyRecap,
} from './api';
import { addDays } from './model';

/**
 * 31's queries, all under `history` so a realtime answer/reaction/message invalidates them
 * (`src/lib/realtime.ts`). Keyed by couple so a re-pair never shows the old couple's week.
 */
export function useWeeklyRecap(coupleId: string | undefined, weekStart: string) {
  return useQuery<WeeklyRecap, AppError>({
    queryKey: queryKeys.history.recap(coupleId ?? '', weekStart),
    queryFn: () => getWeeklyRecap(weekStart),
    enabled: !!coupleId,
  });
}

/** The week's daily questions (date and answer count only) for the mascot strip. */
export function useRecapWeek(coupleId: string | undefined, weekStart: string) {
  return useQuery<DayRow[], AppError>({
    queryKey: queryKeys.history.week(coupleId ?? '', weekStart),
    queryFn: () => getHistoryMonth(coupleId ?? '', weekStart, addDays(weekStart, 6)),
    enabled: !!coupleId,
  });
}

export function useLovedAnswer(answerId: string | null) {
  return useQuery<LovedAnswer | null, AppError>({
    queryKey: queryKeys.history.lovedAnswer(answerId ?? ''),
    queryFn: () => getLovedAnswer(answerId ?? ''),
    enabled: !!answerId,
  });
}

/** The text, only when `enabled` (the reveal rule, `lovedTextAllowed`). */
export function useLovedAnswerBody(answerId: string | null, enabled: boolean) {
  return useQuery<string | null, AppError>({
    queryKey: queryKeys.history.lovedBody(answerId ?? ''),
    queryFn: () => getAnswerBody(answerId ?? ''),
    enabled: !!answerId && enabled,
  });
}
