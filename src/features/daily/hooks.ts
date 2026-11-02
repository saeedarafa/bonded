import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  getRevealedQuestion,
  getStreak,
  getTodayQuestion,
  removeAnswerReaction,
  saveAnswer,
  sendNudge,
  setAnswerReaction,
  type ReactionKind,
  type RevealedQuestion,
  type TodayQuestion,
} from '@/features/daily/api';
import { useDrafts } from '@/lib/drafts';
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

/**
 * Both answers with their reactions (screen 21). The reveal rule: pass `enabled` only once my own
 * answer exists, so the client never even asks for answer text before I've answered. RLS is the
 * real guard (a locked partner answer is absent from the result either way).
 */
export function useRevealedQuestion(
  coupleQuestionId: string | undefined,
  { enabled }: { enabled: boolean },
) {
  return useQuery<RevealedQuestion, AppError>({
    queryKey: queryKeys.questions.detail(coupleQuestionId ?? ''),
    queryFn: () => getRevealedQuestion(coupleQuestionId ?? ''),
    enabled: enabled && !!coupleQuestionId,
  });
}

export type SaveAnswerInput = { coupleQuestionId: string; userId: string; body: string };

/**
 * Lock in my answer (19, J7). On success the draft is deleted and today, the streak and the
 * question refetch. `networkMode: 'always'`: offline the save fails at once with NETWORK (the
 * draft stays, "Try again"); the offline queue is MOB-14.
 */
export function useSaveAnswer() {
  const queryClient = useQueryClient();
  return useMutation<void, AppError, SaveAnswerInput>({
    networkMode: 'always',
    mutationFn: (input) => saveAnswer({ ...input, clientWrittenAt: new Date().toISOString() }),
    onSuccess: async (_data, { coupleQuestionId }) => {
      useDrafts.getState().clearDraft(coupleQuestionId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.today.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.streak() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.questions.detail(coupleQuestionId) }),
      ]);
    },
  });
}

/** Pure: the answer's reactions with mine set to `kind` (null removes it). */
export function withMyReaction(
  question: RevealedQuestion,
  answerId: string,
  userId: string,
  kind: ReactionKind | null,
): RevealedQuestion {
  return {
    ...question,
    answers: question.answers.map((a) => {
      if (a.id !== answerId) return a;
      const others = a.reactions.filter((r) => r.userId !== userId);
      return {
        ...a,
        reactions: kind ? [...others, { id: `optimistic-${userId}`, userId, kind }] : others,
      };
    }),
  };
}

export type ReactInput = { answerId: string; userId: string; kind: ReactionKind | null };

/** React to an answer (21), optimistic with rollback; `kind: null` removes my reaction. */
export function useAnswerReaction(coupleQuestionId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.questions.detail(coupleQuestionId);
  return useMutation<void, AppError, ReactInput, { previous?: RevealedQuestion }>({
    networkMode: 'always',
    mutationFn: ({ answerId, userId, kind }) =>
      kind
        ? setAnswerReaction({ answerId, userId, kind })
        : removeAnswerReaction({ answerId, userId }),
    onMutate: async ({ answerId, userId, kind }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RevealedQuestion>(key);
      if (previous) {
        queryClient.setQueryData(key, withMyReaction(previous, answerId, userId, kind));
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
