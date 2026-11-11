import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { create } from 'zustand';

import {
  claimStreakSaver,
  getRevealedQuestion,
  getStreak,
  getTodayQuestion,
  removeAnswerReaction,
  sendNudge,
  setAnswerReaction,
  type ReactionKind,
  type RevealedQuestion,
  type TodayQuestion,
} from '@/features/daily/api';
import { AppError, messageFor } from '@/lib/errors';
import { useOutbox } from '@/lib/outbox';
import { queryKeys } from '@/lib/queryKeys';

import { flushAnswerQueue } from './answerQueue';
import { localDateKey, normalizeStreak, secondsUntilNextQuestion, type Streak } from './today';

/** Today's question with who has answered (realtime invalidates `today` and `streak`). */
export function useTodayQuestion({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<TodayQuestion, AppError>({
    queryKey: queryKeys.today.question(),
    queryFn: getTodayQuestion,
    enabled,
  });
}

export function useStreak({
  enabled = true,
  refetchInterval,
}: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery<Streak, AppError>({
    queryKey: queryKeys.streak(),
    queryFn: async () => normalizeStreak(await getStreak()),
    enabled,
    ...(refetchInterval ? { refetchInterval } : {}),
  });
}

/**
 * `use_streak_saver()` (28, D18). The server picks the day and spends the couple's monthly claim;
 * the returned streak replaces the cached one, then the streak, Today and badges are refetched.
 * PREMIUM_REQUIRED refetches the entitlement (the card turns back into the premium offer);
 * SAVER_UNAVAILABLE refetches the streak (`saver_available` is false now).
 */
export function useStreakSaver() {
  const queryClient = useQueryClient();
  return useMutation<Streak, AppError>({
    mutationFn: async () => normalizeStreak(await claimStreakSaver()),
    retry: false,
    onSuccess: (streak) => {
      queryClient.setQueryData(queryKeys.streak(), streak);
    },
    onError: (e) => {
      if (e.kind === 'PREMIUM_REQUIRED')
        void queryClient.invalidateQueries({ queryKey: queryKeys.entitlements() });
      if (e.kind === 'NOT_PAIRED')
        void queryClient.invalidateQueries({ queryKey: queryKeys.couple.all });
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.streak() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.today.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.badges.all }),
      ]),
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

type NudgedState = { day: string | null; mark: (day: string) => void };

/**
 * The couple-local day I last nudged on this device (memory only). The server is the judge: after
 * a restart the next tap answers NUDGE_LIMIT, which lands here too.
 */
export const useNudgedDay = create<NudgedState>((set) => ({
  day: null,
  mark: (day) => set({ day }),
}));

/** True once I've nudged today (couple timezone): 23 shows "nudged" instead of the button. */
export function useNudgedToday(timeZone: string | null | undefined): boolean {
  const day = useNudgedDay((s) => s.day);
  return day !== null && day === localDateKey(new Date(), timeZone);
}

/**
 * `send_nudge()` (BE-10). Success and NUDGE_LIMIT both mean "nudged today". PARTNER_ALREADY_ANSWERED
 * means today moved on and NOT_PAIRED that the couple changed: refresh either way. Errors carry the
 * partner's name for PARTNER_ALREADY_ANSWERED.
 */
export function useNudge(partner: string, timeZone: string | null | undefined) {
  const queryClient = useQueryClient();
  const markToday = () => useNudgedDay.getState().mark(localDateKey(new Date(), timeZone));
  return useMutation<void, AppError>({
    mutationFn: () => sendNudge({ partner }),
    retry: false,
    onSuccess: markToday,
    onError: (e) => {
      if (e.kind === 'NUDGE_LIMIT') markToday();
      if (e.kind === 'NOT_PAIRED')
        void queryClient.invalidateQueries({ queryKey: queryKeys.couple.all });
    },
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
/** `queued`: no connection, the answer waits on this phone (screen 55) and sends by itself. */
export type SaveAnswerResult = { queued: boolean };

/**
 * Lock in my answer (19, J7, 55). Every answer goes through the persisted queue
 * (src/lib/outbox.ts) with the time it was written (`client_written_at`, D17), then the queue is
 * flushed (src/features/daily/answerQueue.ts):
 * - saved: the draft is deleted and today, the streak and the question refetch; `queued: false`;
 * - offline or no connection: it stays queued and sends when the connection returns, also after a
 *   restart; `queued: true`. A queued answer never opens the partner's answer: only the server does;
 * - any other error: it leaves the queue (the draft keeps the text) and the mutation fails.
 * Locking in again replaces the queued answer (one per question), so nothing is sent twice.
 */
export function useSaveAnswer() {
  const queryClient = useQueryClient();
  return useMutation<SaveAnswerResult, AppError, SaveAnswerInput>({
    networkMode: 'always',
    mutationFn: async ({ coupleQuestionId, userId, body }) => {
      const outbox = useOutbox.getState;
      outbox().queueAnswer({
        coupleQuestionId,
        userId,
        body,
        clientWrittenAt: new Date().toISOString(),
      });
      await flushAnswerQueue(queryClient, userId);
      const left = outbox().answers[coupleQuestionId];
      if (!left) return { queued: false };
      if (left.status !== 'failed') return { queued: true };
      outbox().removeAnswer(coupleQuestionId);
      const kind = left.errorKind ?? 'UNKNOWN';
      throw new AppError(kind, messageFor(kind, { max: left.errorMax }), left.errorMax);
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
