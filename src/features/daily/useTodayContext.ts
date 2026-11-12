import { useMemo } from 'react';

import { useSession } from '@/features/auth/session';
import { useActiveCouple } from '@/features/couple/hooks';
import type { TodayQuestion } from '@/features/daily/api';
import { useTodayQuestion } from '@/features/daily/hooks';
import type { HistoryDetail } from '@/features/history/api';
import { localDateKey } from '@/features/daily/today';
import { useHistoryDetail } from '@/features/history/hooks';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { AppError, messageFor } from '@/lib/errors';

/** A history detail in the shape the answer flow reads: who answered (ids only, no times, no text). */
export function toQuestionStatus(d: HistoryDetail): TodayQuestion {
  return {
    id: d.id,
    ...(d.questionId ? { questionId: d.questionId } : {}),
    source: d.source,
    answerCount: d.answerCount,
    question: d.question,
    answers: d.answeredBy.map((userId) => ({ userId, createdAt: '' })),
  };
}

/**
 * What screens 19, 20 and 21 share: me, my partner's name, the question and who has answered.
 * No answer text here (CONTRACTS §2: "partner status for a question" needs no text).
 *
 * Without `questionId` this is today's question (`get_daily_question`). With one (MOB-49: a started
 * pack question) it is that row's history detail, the same cache entry 30 reads, so 30 and the flow
 * never disagree about who has answered (realtime on `answers` refreshes it).
 */
export function useTodayContext(questionId?: string) {
  const { t } = useTranslation();
  const { userId } = useSession();
  const couple = useActiveCouple();
  const profiles = useCoupleProfiles();
  const today = useTodayQuestion({ enabled: !!couple.data && !questionId });
  const other = useHistoryDetail(questionId);
  const otherData = useMemo(
    () => (other.data ? toQuestionStatus(other.data) : undefined),
    [other.data],
  );
  // Not in my history (another couple's, purged, or a bad link): RLS returns nothing.
  const notFound = useMemo(
    () =>
      questionId && other.data === null
        ? new AppError('QUESTION_UNAVAILABLE', messageFor('QUESTION_UNAVAILABLE'))
        : null,
    [questionId, other.data],
  );
  const question = questionId
    ? {
        data: otherData,
        error: other.error ?? notFound,
        isFetching: other.isFetching,
        refetch: other.refetch,
      }
    : {
        data: today.data,
        error: today.error,
        isFetching: today.isFetching,
        refetch: today.refetch,
      };

  const me = profiles.me?.display_name?.trim() || t('today.you');
  const partner =
    profiles.partner?.display_name?.trim() ||
    couple.data?.partner_name?.trim() ||
    t('pairing.partnerFallback');
  const mine = question.data?.answers.find((a) => a.userId === userId) ?? null;
  const partnerAnswered = question.data ? question.data.answerCount - (mine ? 1 : 0) >= 1 : false;

  // D56 (BE-57): a daily question can be answered or edited only on its own day. Opened by id
  // (`/history/<id>/answer`), a daily row is either today's (answer it from Today) or a day that
  // has ended (no answer entry). The server decides at write time (plus its 15-minute grace).
  const daily =
    !!questionId && !!other.data && !!couple.data && other.data.source === 'daily'
      ? other.data.assignedFor !== null &&
        other.data.assignedFor === localDateKey(new Date(), couple.data.timezone)
        ? ('today' as const)
        : ('ended' as const)
      : null;

  return {
    userId,
    couple,
    question,
    /**
     * Only with `questionId`: `'today'` for today's daily row, `'ended'` for a past daily day
     * (D56), null for a pack question or while it loads.
     */
    daily,
    /**
     * Where the question comes from: `'daily'` without `questionId`; with one, the row's source
     * (`'daily'` or `'pack'`), or null while it loads (#270: 19's title follows it, not the route).
     */
    source: questionId ? (other.data?.source ?? null) : 'daily',
    me,
    partner,
    /** My answer (id and time only), or null. */
    mine,
    partnerAnswered,
    error: couple.error ?? question.error,
    refetch: () => {
      void couple.refetch();
      void question.refetch();
    },
  };
}
