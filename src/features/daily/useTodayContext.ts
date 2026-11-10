import type { Href } from 'expo-router';
import { useMemo } from 'react';

import { useSession } from '@/features/auth/session';
import { useActiveCouple } from '@/features/couple/hooks';
import type { TodayQuestion } from '@/features/daily/api';
import { useTodayQuestion } from '@/features/daily/hooks';
import type { HistoryDetail } from '@/features/history/api';
import { useHistoryDetail } from '@/features/history/hooks';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { AppError, messageFor } from '@/lib/errors';

/** Where the answer flow (19, 20, 21, 22) lives for one question. */
export type QuestionPaths = {
  /** Today (18/23/24), or the question's History entry (30), which routes a pack question by state. */
  home: Href;
  answer: Href;
  reveal: Href;
  revealed: Href;
  thread: Href;
};

/**
 * MOB-49: the same screens answer today's question (`/today/...`) or any other `couple_questions`
 * row, such as a started pack question (`/history/<id>/...`). Pure, so routes are tested per case.
 */
export function questionPaths(questionId?: string): QuestionPaths {
  if (!questionId)
    return {
      home: '/today',
      answer: '/today/answer',
      reveal: '/today/reveal',
      revealed: '/today/revealed',
      thread: '/today/thread',
    };
  return {
    home: `/history/${questionId}`,
    answer: `/history/${questionId}/answer`,
    reveal: `/history/${questionId}/reveal`,
    revealed: `/history/${questionId}/revealed`,
    thread: `/history/${questionId}/thread`,
  };
}

/** A history detail in the shape the answer flow reads: who answered (ids only, no times, no text). */
export function toQuestionStatus(d: HistoryDetail): TodayQuestion {
  return {
    id: d.id,
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

  return {
    userId,
    couple,
    question,
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
