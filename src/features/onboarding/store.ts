import { create } from 'zustand';

import type { KeyDateValues } from '@/features/keyDates/model';

/** Matches the `couple_stage` enum (CONTRACTS §2). */
export const STAGES = ['dating', 'living_together', 'engaged_married', 'long_distance'] as const;
export type Stage = (typeof STAGES)[number];

/** Free-text keys in `couples.goals` (seeds the first packs). Labels live in `onboarding.goals.*`. */
export const GOALS = [
  'deep_talks',
  'laughing',
  'romance',
  'future',
  'hard_conversations',
  'learning',
] as const;
export type Goal = (typeof GOALS)[number];

export const LAST_LEARNED = ['this_week', 'this_month', 'cant_remember'] as const;
export type LastLearned = (typeof LAST_LEARNED)[number];

export const NAME_MAX = 40;

/** Question ids of the D38 onboarding answers (CONTRACTS §2 `onboarding_answers.question_id`). */
export type OnboardingQuestionId = 'last_learned' | 'stage' | 'goals';

type OnboardingState = {
  /** Screen 03, self-reported. Synced after sign-in with 05 and 06 (D38, MOB-37). */
  lastLearned: LastLearned | null;
  stage: Stage | null;
  goals: Goal[];
  displayName: string;
  partnerName: string;
  /**
   * D40: the person chose "I already have an account" on 01 instead of the story and quiz. After
   * sign-in a solo couple goes to 10 instead of Today. Cleared by 10, by SetupBond and by `reset`.
   */
  returning: boolean;
  /** Screen 47 (optional): ISO dates; my birthday only, never the partner's. */
  keyDates: KeyDateValues;
  /** Screen 47 "Remind us a week before", applied to every date written. On by default (board). */
  remindWeekBefore: boolean;
  /**
   * When each of 03/05/06 was last answered (ISO device time). Only answered questions are synced
   * (MOB-37), and the time is sent as `answered_at`, so a retry sends the same row.
   */
  answeredAt: Partial<Record<OnboardingQuestionId, string>>;
  setLastLearned: (value: LastLearned) => void;
  setStage: (value: Stage) => void;
  toggleGoal: (value: Goal) => void;
  /** 06 Continue: "none picked" is an answer too (`goals: []`, questionnaire v2), once. */
  confirmGoals: () => void;
  setNames: (names: { displayName?: string; partnerName?: string }) => void;
  setReturning: (value: boolean) => void;
  setKeyDates: (keyDates: KeyDateValues, remindWeekBefore: boolean) => void;
  /** Skip on 47, or "continue without dates" after a refused write. */
  clearKeyDates: () => void;
  reset: () => void;
};

const EMPTY = {
  lastLearned: null,
  stage: null,
  goals: [] as Goal[],
  displayName: '',
  partnerName: '',
  returning: false,
  keyDates: {} as KeyDateValues,
  remindWeekBefore: true,
  answeredAt: {} as Partial<Record<OnboardingQuestionId, string>>,
};

const now = () => new Date().toISOString();

/**
 * What the person told us before they have an account (screens 03, 05, 06, 07, 47). It stays in memory
 * and is written once, by `useSetupBond`, after sign-in (`create_couple` + profile name + key dates), then
 * cleared. T1's answer and N's time are kept apart, on the phone (`pendingSetup.ts`, MOB-61). Names and answers are never logged or sent to analytics.
 */
export const useOnboarding = create<OnboardingState>((set) => ({
  ...EMPTY,
  setLastLearned: (lastLearned) =>
    set((state) => ({ lastLearned, answeredAt: { ...state.answeredAt, last_learned: now() } })),
  setStage: (stage) =>
    set((state) => ({ stage, answeredAt: { ...state.answeredAt, stage: now() } })),
  toggleGoal: (goal) =>
    set((state) => ({
      goals: state.goals.includes(goal)
        ? state.goals.filter((g) => g !== goal)
        : [...state.goals, goal],
      answeredAt: { ...state.answeredAt, goals: now() },
    })),
  confirmGoals: () =>
    set((state) =>
      state.answeredAt.goals ? state : { answeredAt: { ...state.answeredAt, goals: now() } },
    ),
  setNames: (names) => set(names),
  setReturning: (returning) => set({ returning }),
  setKeyDates: (keyDates, remindWeekBefore) => set({ keyDates, remindWeekBefore }),
  clearKeyDates: () => set({ keyDates: {}, remindWeekBefore: EMPTY.remindWeekBefore }),
  reset: () => set({ ...EMPTY }),
}));

/**
 * True once the person answered anything in the story or quiz (03, 05, 06, 07) on this launch.
 * Key dates (47) are left out on purpose: SetupBond clears them on "Continue without dates", and
 * that must not flip the front door away from SetupBond while it is still writing.
 */
export function hasOnboardingAnswers(
  state: Pick<OnboardingState, 'lastLearned' | 'stage' | 'goals' | 'displayName' | 'partnerName'>,
): boolean {
  return (
    state.lastLearned !== null ||
    state.stage !== null ||
    state.goals.length > 0 ||
    state.displayName.trim() !== '' ||
    state.partnerName.trim() !== ''
  );
}

/**
 * #93: true while SetupBond is writing the answers and until it has moved on to 09. The front door
 * keeps SetupBond on screen meanwhile: clearing the answers (or the new couple landing in the
 * cache) must not send a brand-new account back to the story, or a solo one to Today, before
 * SetupBond navigates. Memory only; SetupBond clears it when it leaves the screen.
 */
export const useSetupInFlight = create<{ active: boolean; setActive: (active: boolean) => void }>(
  (set) => ({ active: false, setActive: (active) => set({ active }) }),
);
