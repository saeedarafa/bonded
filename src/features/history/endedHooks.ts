import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { useEndedCouple, useFormerPartnerName } from '@/features/settings/hooks';
import type { EndedCouple } from '@/features/settings/api';
import { useTranslation } from '@/i18n';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

import { getEndedHistoryPage, getEndedQuestion, HISTORY_PAGE_SIZE } from './api';
import { endedHistoryUntil, isEndedHistoryOpen, type EndedRow } from './ended';
import { dropLockedContent } from './hooks';

/**
 * MOB-50: my latest ended couple whose History I may still read (D08), or null: none, a solo
 * archive, or the 30 days are over. `undefined` while it loads. A failed read is null too: the
 * entry is an extra, never a blocker.
 */
export function useEndedHistory(): {
  couple: EndedCouple | null | undefined;
  until: Date | null;
  partner: string;
} {
  const { t } = useTranslation();
  const ended = useEndedCouple({ enabled: true });
  const data = ended.isError ? null : ended.data;
  const open = data ? isEndedHistoryOpen(data) : false;
  const couple = data === undefined ? undefined : open ? data : null;
  // D09: after an account deletion no name is kept, so this stays "Your partner".
  const name = useFormerPartnerName(couple ?? null);
  return {
    couple,
    until: couple ? endedHistoryUntil(couple.ended_at) : null,
    partner: name.data || t('pairing.partnerFallback'),
  };
}

/** The archive list, 20 at a time (no answer text). */
export function useEndedHistoryList(coupleId: string | undefined) {
  const client = useQueryClient();
  const { userId } = useSession();
  return useInfiniteQuery<
    EndedRow[],
    AppError,
    { pages: EndedRow[][] },
    readonly unknown[],
    number
  >({
    queryKey: queryKeys.history.endedList(coupleId ?? ''),
    queryFn: async ({ pageParam }) => {
      const rows = await getEndedHistoryPage(coupleId ?? '', pageParam, userId);
      dropLockedContent(
        client,
        rows.filter((r) => r.locked).map((r) => r.id),
      );
      return rows;
    },
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length < HISTORY_PAGE_SIZE ? undefined : all.length),
    enabled: !!coupleId,
  });
}

/** One archived question: who answered, the reply count and `locked` (no text). */
export function useEndedQuestion(
  coupleId: string | undefined,
  coupleQuestionId: string | undefined,
) {
  const client = useQueryClient();
  const { userId } = useSession();
  return useQuery<EndedRow | null, AppError>({
    queryKey: queryKeys.history.endedDetail(coupleId ?? '', coupleQuestionId ?? ''),
    queryFn: async () => {
      const row = await getEndedQuestion(coupleId ?? '', coupleQuestionId ?? '', userId);
      if (row?.locked) dropLockedContent(client, [row.id]);
      return row;
    },
    enabled: !!coupleId && !!coupleQuestionId,
  });
}
