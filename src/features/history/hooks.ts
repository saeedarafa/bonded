import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useSession } from '@/features/auth/session';
import { usePremium } from '@/features/premium/hooks';
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

/**
 * MOB-71 (D55, CONTRACTS "History lock"): never keep content longer than the lock allows. When
 * `history_days` marks a day `locked`, its answers, thread and last message are dropped from the
 * cache (in memory and, with the next persist, on disk). The server returns nothing for them
 * anyway; this makes sure an old cached copy can't show after a lapse.
 */
export function dropLockedContent(client: QueryClient, lockedIds: readonly string[]): void {
  for (const id of lockedIds) {
    client.removeQueries({ queryKey: queryKeys.questions.detail(id), exact: true });
    client.removeQueries({ queryKey: queryKeys.thread.detail(id), exact: true });
    client.removeQueries({ queryKey: queryKeys.history.lastMessage(id), exact: true });
  }
}

/**
 * MOB-71 (D55): when Premium lapses, older days lock again at once. Cached answers and threads that
 * no screen shows are dropped, the ones on screen and every History read are fetched again (the
 * server then marks the older days `locked`, and `dropLockedContent` removes what is left). Nothing
 * is deleted on the server. Mounted once, in the tabs layout.
 */
export function useRelockHistoryOnLapse(): void {
  const client = useQueryClient();
  const premium = usePremium();
  const was = useRef<boolean | null>(null);
  const known = premium.status === 'ready';
  const isPremium = premium.isPremium;
  useEffect(() => {
    if (!known) return;
    if (was.current === true && !isPremium) {
      for (const key of [queryKeys.questions.all, queryKeys.thread.all]) {
        client.removeQueries({ queryKey: key, type: 'inactive' });
        void client.invalidateQueries({ queryKey: key });
      }
      void client.invalidateQueries({ queryKey: queryKeys.history.all });
    }
    was.current = isPremium;
  }, [client, known, isPremium]);
}

const lockedIdsOf = (rows: readonly { id: string; locked?: boolean }[]) =>
  rows.filter((r) => r.locked).map((r) => r.id);

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
  const client = useQueryClient();
  return useInfiniteQuery<
    HistoryRow[],
    AppError,
    { pages: HistoryRow[][] },
    readonly unknown[],
    number
  >({
    queryKey: queryKeys.history.list(coupleId ?? ''),
    queryFn: async ({ pageParam }) => {
      const rows = await getHistoryPage(coupleId ?? '', pageParam);
      dropLockedContent(client, lockedIdsOf(rows));
      return rows;
    },
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

/** Board 30 without text: the question, who answered, the reply count, `locked` (D55). */
export function useHistoryDetail(coupleQuestionId: string | undefined) {
  const client = useQueryClient();
  const { userId } = useSession();
  return useQuery<HistoryDetail | null, AppError>({
    queryKey: queryKeys.history.detail(coupleQuestionId ?? ''),
    queryFn: async () => {
      const d = await getHistoryDetail(coupleQuestionId ?? '', userId);
      if (d?.locked) dropLockedContent(client, [d.id]);
      return d;
    },
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
