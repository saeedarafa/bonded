import { focusManager, onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { create } from 'zustand';

import { isAppError } from '@/lib/errors';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';
import type { Json } from '@/types/database';

import { upsertOnboardingAnswers } from './api';
import type { Goal, LastLearned, OnboardingQuestionId, Stage } from './store';

/**
 * MOB-37 (D38): the onboarding answers (03 `last_learned`, 05 `stage`, 06 `goals`) go to the
 * server's `onboarding_answers` (BE-33) after sign-in, with their question id and questionnaire
 * version.
 *
 * - `queueOnboardingAnswers` copies them into a small queue in the encrypted MMKV store, so they
 *   survive an app kill or a crash until the server has them (the onboarding store is memory only).
 * - `flushOnboardingAnswers` upserts the queue in one request. On success the rows leave the
 *   phone; on any failure they stay and are tried again when the connection returns, the app comes
 *   back to the foreground, or on the next launch (`useOnboardingAnswerSync`).
 * - Written once: the upsert key is user + question + version and a retry sends the same row
 *   (same answer and `answered_at`), so a repeat can never add a row.
 *
 * D50 / MOB-60: new answers use **questionnaire version 2** (BE-48, CONTRACTS §2), whose question
 * ids and choice keys the database validates; version 1 rows already queued on a phone are still
 * sent as version 1. A row the database refuses with `INVALID_ONBOARDING_ANSWER` can never succeed,
 * so it is dropped instead of retried (the others in the same batch are still written). The queue survives sign-out (rows are per user and only sent
 * for that user's session) and is wiped with the account (`wipeLocalAccount`). Answers are never
 * logged, tracked or put in a query key; storage failures are swallowed.
 */
export const CURRENT_QUESTIONNAIRE_VERSION = 2;

export type OnboardingAnswers = {
  lastLearned: LastLearned | null;
  stage: Stage | null;
  goals: Goal[];
  /** Only questions with a time here were answered and are sent. */
  answeredAt: Partial<Record<OnboardingQuestionId, string>>;
};

export type PendingOnboardingAnswer = {
  userId: string;
  questionId: OnboardingQuestionId;
  questionnaireVersion: number;
  answer: Json;
  answeredAt: string;
};

/** The rows to write for what was answered (stable choice keys, never translated labels). */
export function onboardingAnswerRows(
  userId: string,
  answers: OnboardingAnswers,
  questionnaireVersion: number = CURRENT_QUESTIONNAIRE_VERSION,
): PendingOnboardingAnswer[] {
  const values: Record<OnboardingQuestionId, Json | null> = {
    last_learned: answers.lastLearned,
    stage: answers.stage,
    goals: [...answers.goals],
  };
  const rows: PendingOnboardingAnswer[] = [];
  for (const questionId of ['last_learned', 'stage', 'goals'] as const) {
    const answer = values[questionId];
    const answeredAt = answers.answeredAt[questionId];
    if (answer === null || !answeredAt) continue;
    rows.push({ userId, questionId, questionnaireVersion, answer, answeredAt });
  }
  return rows;
}

const keyOf = (
  row: Pick<PendingOnboardingAnswer, 'userId' | 'questionId' | 'questionnaireVersion'>,
) => `${row.userId}|${row.questionnaireVersion}|${row.questionId}`;

type SyncState = {
  pending: Record<string, PendingOnboardingAnswer>;
  queue: (rows: PendingOnboardingAnswer[]) => void;
  /** Removes these exact rows (a row replaced meanwhile by a newer answer stays). */
  settle: (rows: PendingOnboardingAnswer[]) => void;
  reset: () => void;
};

const STORAGE_KEY = 'pending';
/** Bound: a few questions per questionnaire version, a couple of accounts at most. */
const MAX_PENDING = 30;

function restore(storage: KeyValueStorage): Record<string, PendingOnboardingAnswer> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PendingOnboardingAnswer>) : {};
  } catch {
    return {};
  }
}

export function createOnboardingSyncStore(storage: KeyValueStorage) {
  const store = create<SyncState>()((set) => ({
    pending: restore(storage),
    queue: (rows) =>
      set((s) => {
        if (rows.length === 0) return s;
        const pending = { ...s.pending };
        for (const row of rows) pending[keyOf(row)] = row;
        const entries = Object.entries(pending);
        if (entries.length <= MAX_PENDING) return { pending };
        entries.sort(([, a], [, b]) => a.answeredAt.localeCompare(b.answeredAt));
        return { pending: Object.fromEntries(entries.slice(entries.length - MAX_PENDING)) };
      }),
    settle: (rows) =>
      set((s) => {
        const pending = { ...s.pending };
        let changed = false;
        for (const row of rows) {
          const key = keyOf(row);
          if (pending[key] === row) {
            delete pending[key];
            changed = true;
          }
        }
        return changed ? { pending } : s;
      }),
    reset: () => set({ pending: {} }),
  }));
  store.subscribe((state, previous) => {
    if (state.pending === previous.pending) return;
    try {
      if (Object.keys(state.pending).length) {
        storage.setItem(STORAGE_KEY, JSON.stringify(state.pending));
      } else {
        storage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage unavailable: the in-memory queue still syncs this launch.
    }
  });
  return store;
}

export const useOnboardingSync = createOnboardingSyncStore(
  createKeyValueStorage('onboardingSync:'),
);

/** Keeps this user's answers on the phone until the server has them. Re-queueing replaces. */
export function queueOnboardingAnswers(
  userId: string,
  answers: OnboardingAnswers,
  questionnaireVersion: number = CURRENT_QUESTIONNAIRE_VERSION,
): void {
  useOnboardingSync.getState().queue(onboardingAnswerRows(userId, answers, questionnaireVersion));
}

export function hasPendingOnboardingAnswers(userId: string): boolean {
  return Object.values(useOnboardingSync.getState().pending).some((r) => r.userId === userId);
}

let running: Promise<boolean> | null = null;
let again = false;

/** One upsert of everything pending for this user. False when it failed (rows kept). */
async function flushOnce(userId: string): Promise<boolean> {
  const rows = Object.values(useOnboardingSync.getState().pending).filter(
    (r) => r.userId === userId,
  );
  if (rows.length === 0) return true;
  if (!onlineManager.isOnline()) return false;
  try {
    await upsertOnboardingAnswers(rows.map(toRow));
  } catch (error) {
    // Kept on the phone; the next reconnect, foreground or launch tries again. Not logged: the
    // error could echo the row.
    if (!isAppError(error, INVALID)) return false;
    return writeOneByOne(rows);
  }
  useOnboardingSync.getState().settle(rows);
  return true;
}

const INVALID = 'INVALID_ONBOARDING_ANSWER';

function toRow(r: PendingOnboardingAnswer) {
  return {
    user_id: r.userId,
    question_id: r.questionId,
    questionnaire_version: r.questionnaireVersion,
    answer: r.answer as NonNullable<Json>,
    answered_at: r.answeredAt,
  };
}

/**
 * The batch was refused because some row is invalid (the whole upsert rolls back). Each row on its
 * own: written or invalid rows leave the queue; any other failure keeps that row for the next try.
 */
async function writeOneByOne(rows: PendingOnboardingAnswer[]): Promise<boolean> {
  const done: PendingOnboardingAnswer[] = [];
  let ok = true;
  for (const row of rows) {
    try {
      await upsertOnboardingAnswers([toRow(row)]);
      done.push(row);
    } catch (error) {
      if (isAppError(error, INVALID)) done.push(row);
      else ok = false;
    }
  }
  useOnboardingSync.getState().settle(done);
  return ok;
}

/**
 * Sends this user's pending answers. One flush at a time: a call during a flush schedules one more
 * pass (a newer answer queued meanwhile is not missed, and nothing is sent twice in parallel); a
 * failed pass stops there. Resolves true when nothing is left for this user. Never throws.
 */
export function flushOnboardingAnswers(userId: string): Promise<boolean> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      let ok: boolean;
      do {
        again = false;
        ok = await flushOnce(userId);
      } while (ok && again);
      return ok && !hasPendingOnboardingAnswers(userId);
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * Mounted once for the signed-in user (root layout): sends pending answers at start (also the
 * next launch after a failure), when answers are queued, when the connection returns and when the
 * app comes back to the foreground.
 */
export function useOnboardingAnswerSync(userId: string | null): void {
  useEffect(() => {
    if (!userId) return undefined;
    const run = () => {
      if (onlineManager.isOnline() && hasPendingOnboardingAnswers(userId)) {
        void flushOnboardingAnswers(userId);
      }
    };
    run();
    const stopOnline = onlineManager.subscribe((online) => online && run());
    const stopFocus = focusManager.subscribe((focused) => focused && run());
    const stopQueue = useOnboardingSync.subscribe((state, previous) => {
      // Only new or replaced rows trigger a send; removals after a success don't.
      const added = Object.entries(state.pending).some(([k, v]) => previous.pending[k] !== v);
      if (added) run();
    });
    return () => {
      stopOnline();
      stopFocus();
      stopQueue();
    };
  }, [userId]);
}
