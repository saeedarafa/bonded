import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getPackIdOfQuestion } from '@/features/packs/api';
import { analyticsEnabled, durationBucket, lengthBucket, track, type EventProps } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';

import { zonedParts } from './today';

/**
 * Daily loop (ANALYTICS §3.5, MOB-24c): ids, counts and buckets only. Never the question, an answer
 * or a message (lengths become a bucket, voice a duration bucket).
 */
export type QuestionRef = { question_id: string; pack_id: string | null };

/**
 * The analytics ids of a couple question: the `questions` id, and the pack for a pack question
 * (looked up only while analytics is on). `undefined` until known: events wait rather than guess.
 */
export function useQuestionRef(
  q: { questionId?: string; source?: string } | null | undefined,
): QuestionRef | undefined {
  const questionId = q?.questionId;
  const isPack = q?.source === 'pack';
  const on = analyticsEnabled();
  const pack = useQuery<string | null>({
    queryKey: queryKeys.packs.ofQuestion(questionId ?? ''),
    queryFn: () => getPackIdOfQuestion(questionId ?? ''),
    enabled: on && isPack && !!questionId,
    staleTime: Infinity,
  });
  if (!on || !questionId) return undefined;
  if (!isPack) return { question_id: questionId, pack_id: null };
  return pack.data === undefined ? undefined : { question_id: questionId, pack_id: pack.data };
}

/** Events already sent this run, per question: a view is counted once, not on every focus. */
const sent = new Set<string>();

/** `event` once per key in this JS runtime. */
export function trackOnce<E extends 'daily_question_viewed' | 'answer_locked_viewed'>(
  event: E,
  key: string,
  props: EventProps<E>,
): void {
  const id = `${event}:${key}`;
  if (sent.has(id)) return;
  sent.add(id);
  (track as (e: E, p: EventProps<E>) => void)(event, props);
}

/** Tests: forget what was sent. */
export function resetDailyAnalyticsForTests(): void {
  sent.clear();
  pendingSubmits.clear();
  started.clear();
}

/**
 * Hours since my ritual time today in the couple's zone (negative before it). `ritualTime` is the
 * Postgres `time` from notification prefs (`21:00:00`).
 */
export function hoursAfterRitual(
  now: Date,
  ritualTime: string | null | undefined,
  timeZone: string | null | undefined,
): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(ritualTime ?? '');
  if (!m) return null;
  const { h, min } = zonedParts(now, timeZone);
  const diff = h * 60 + min - (Number(m[1]) * 60 + Number(m[2]));
  return Math.trunc(diff / 60);
}

/** 18/23/24: `daily_question_viewed` once per question, `answer_locked_viewed` once on 23. */
export function useDailyViewEvents(input: {
  coupleQuestionId: string | undefined;
  ref: QuestionRef | undefined;
  iAnswered: boolean;
  partnerAnswered: boolean;
  waiting: boolean;
  hoursAfterRitual: number | null;
}): void {
  const { coupleQuestionId, ref, iAnswered, partnerAnswered, waiting } = input;
  const hours = input.hoursAfterRitual;
  useEffect(() => {
    if (!coupleQuestionId || !ref || hours === null) return;
    trackOnce('daily_question_viewed', coupleQuestionId, {
      ...ref,
      partner_answered: partnerAnswered,
      i_answered: iAnswered,
      hours_after_ritual: hours,
    });
  }, [coupleQuestionId, ref, hours, iAnswered, partnerAnswered]);
  useEffect(() => {
    if (!coupleQuestionId || !ref || !waiting) return;
    trackOnce('answer_locked_viewed', coupleQuestionId, { question_id: ref.question_id });
  }, [coupleQuestionId, ref, waiting]);
}

/** `answer_started` once per question per screen visit: the first keystroke or recording. */
const started = new Set<string>();

export function trackAnswerStarted(
  coupleQuestionId: string,
  ref: QuestionRef | undefined,
  kind: 'text' | 'voice',
): void {
  if (!ref || started.has(coupleQuestionId)) return;
  started.add(coupleQuestionId);
  track('answer_started', { question_id: ref.question_id, kind });
}

/** 19 left: the next visit may start again. */
export function forgetAnswerStarted(coupleQuestionId: string | undefined): void {
  if (coupleQuestionId) started.delete(coupleQuestionId);
}

type Submit = Omit<EventProps<'answer_submitted'>, 'offline_queued'> & { queued: boolean };

/** Lock-ins waiting for the server's yes (memory only: a restart loses the event, not the answer). */
const pendingSubmits = new Map<string, Submit>();

/** 19 lock-in: what `answer_submitted` will say once the server accepts it. */
export function noteAnswerSubmit(
  coupleQuestionId: string,
  input: {
    ref: QuestionRef | undefined;
    body: string;
    voiceMs: number | null;
    partnerAnswered: boolean;
  },
): void {
  const { ref } = input;
  if (!ref || !analyticsEnabled()) return;
  pendingSubmits.set(coupleQuestionId, {
    ...ref,
    kind: input.voiceMs !== null ? 'voice' : 'text',
    ...(input.voiceMs !== null
      ? { duration_bucket: durationBucket(input.voiceMs) }
      : { length_bucket: lengthBucket(input.body.length) }),
    partner_answered: input.partnerAnswered,
    // 19 has no edit of a locked-in answer (D13): every lock-in is the first.
    edited: false,
    queued: false,
  });
}

/** The outbox kept it on the phone (55). */
export function answerQueuedOffline(coupleQuestionId: string): void {
  const pending = pendingSubmits.get(coupleQuestionId);
  if (pending) pending.queued = true;
  track('answer_queued_offline');
}

/** The server accepted the answer (the answer queue): `answer_submitted`, once. */
export function answerAccepted(coupleQuestionId: string): void {
  const pending = pendingSubmits.get(coupleQuestionId);
  if (!pending) return;
  pendingSubmits.delete(coupleQuestionId);
  const { queued, ...props } = pending;
  track('answer_submitted', { ...props, offline_queued: queued });
}

/** A definite failure: nothing to report later. */
export function answerFailed(coupleQuestionId: string): void {
  pendingSubmits.delete(coupleQuestionId);
}

/** 20 → 21: whole hours since the later of the two answers (0 when unknown). */
export function hoursSinceBothAnswered(
  answers: readonly { createdAt: string }[],
  now = Date.now(),
): number {
  const times = answers.map((a) => Date.parse(a.createdAt)).filter((t) => !Number.isNaN(t));
  if (times.length < 2) return 0;
  return Math.max(0, Math.floor((now - Math.max(...times)) / 3_600_000));
}
