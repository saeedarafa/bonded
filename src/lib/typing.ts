import { create } from 'zustand';

import type { TypingPayload } from '@/lib/realtime';

/** D15: a `typing` signal counts for 5 s; the sender repeats it at most every 3 s while typing. */
export const TYPING_EXPIRES_MS = 5000;

type TypingState = {
  /** Who is typing per question (in memory only, never persisted; ids only). */
  byQuestion: Record<string, string>;
  /** A signal arrived: `user_id` counts as typing for 5 s from now (a new signal extends it). */
  mark: (payload: TypingPayload) => void;
  /** Expired, or the partner's message arrived. */
  clear: (coupleQuestionId: string) => void;
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useTyping = create<TypingState>((set, get) => ({
  byQuestion: {},
  mark: ({ user_id, couple_question_id }) => {
    clearTimeout(timers.get(couple_question_id));
    timers.set(
      couple_question_id,
      setTimeout(() => get().clear(couple_question_id), TYPING_EXPIRES_MS),
    );
    set((s) => ({ byQuestion: { ...s.byQuestion, [couple_question_id]: user_id } }));
  },
  clear: (coupleQuestionId) => {
    clearTimeout(timers.get(coupleQuestionId));
    timers.delete(coupleQuestionId);
    set((s) => {
      if (!(coupleQuestionId in s.byQuestion)) return s;
      const rest = { ...s.byQuestion };
      delete rest[coupleQuestionId];
      return { byQuestion: rest };
    });
  },
}));

/** True while someone other than me typed in this thread within the last 5 s. */
export function usePartnerTyping(
  coupleQuestionId: string | undefined,
  myUserId: string | null | undefined,
): boolean {
  return useTyping((s) => {
    const who = coupleQuestionId ? s.byQuestion[coupleQuestionId] : undefined;
    return !!who && who !== myUserId;
  });
}
