import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { getUnreadThreadCounts, UNREAD_COUNTS_AVAILABLE } from '@/features/thread/api';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

import {
  getFirstHistoryDay,
  getHistoryDetail,
  getHistoryMonth,
  getHistoryPage,
  getLastMessage,
  HISTORY_PAGE_SIZE,
  type HistoryDetail,
  type HistoryRow,
  type LastMessage,
} from './api';
import { monthRange, type DayRow, type MonthKey } from './model';

/** Board 29 heatmap: one month of daily questions (no text). */
export function useHistoryMonth(coupleId: string | undefined, month: MonthKey) {
  const { start, end } = monthRange(month);
  return useQuery<DayRow[], AppError>({
    queryKey: queryKeys.history.month(coupleId ?? '', month),
    queryFn: () => getHistoryMonth(coupleId ?? '', start, end),
    enabled: !!coupleId,
  });
}

/** The first daily question's date (cells before it are empty, not missed). */
export function useHistoryStart(coupleId: string | undefined) {
  return useQuery<string | null, AppError>({
    queryKey: queryKeys.history.start(coupleId ?? ''),
    queryFn: () => getFirstHistoryDay(coupleId ?? ''),
    enabled: !!coupleId,
  });
}

/** Board 29 list: newest first, 20 at a time (CONTRACTS "History page"). */
export function useHistoryList(coupleId: string | undefined) {
  return useInfiniteQuery<
    HistoryRow[],
    AppError,
    { pages: HistoryRow[][] },
    readonly unknown[],
    number
  >({
    queryKey: queryKeys.history.list(coupleId ?? ''),
    queryFn: ({ pageParam }) => getHistoryPage(coupleId ?? '', pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length < HISTORY_PAGE_SIZE ? undefined : all.length),
    enabled: !!coupleId,
  });
}

/** Unread partner messages per thread (BE-20), for the dot on a history row. */
export function useUnreadThreadCounts(enabled: boolean) {
  return useQuery<Record<string, number>, AppError>({
    queryKey: queryKeys.thread.unreadCounts(),
    queryFn: getUnreadThreadCounts,
    enabled: enabled && UNREAD_COUNTS_AVAILABLE,
  });
}

/** Board 30 without text: the question, who answered, the reply count. */
export function useHistoryDetail(coupleQuestionId: string | undefined) {
  return useQuery<HistoryDetail | null, AppError>({
    queryKey: queryKeys.history.detail(coupleQuestionId ?? ''),
    queryFn: () => getHistoryDetail(coupleQuestionId ?? ''),
    enabled: !!coupleQuestionId,
  });
}

/** The thread preview's last message: message text, so only once my own answer exists. */
export function useLastMessage(
  coupleQuestionId: string | undefined,
  { enabled }: { enabled: boolean },
) {
  return useQuery<LastMessage | null, AppError>({
    queryKey: queryKeys.history.lastMessage(coupleQuestionId ?? ''),
    queryFn: () => getLastMessage(coupleQuestionId ?? ''),
    enabled: enabled && !!coupleQuestionId,
  });
}
