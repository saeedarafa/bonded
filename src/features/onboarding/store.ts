import { create } from 'zustand';

import { ONBOARDING_KEY_DATES, type KeyDateValues } from '@/features/keyDates/model';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

import { AFTER_PLAN, ONBOARDING_STEPS, type OnboardingHref } from './flow';

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
  /**
   * MOB-61b: the onboarding screen this phone was last on (01 to P3, or 08 once the quiz is over),
   * so the front door can resume there after an app kill. Recorded by `useRecordOnboardingStep`.
   */
  step: OnboardingHref | null;
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
  setStep: (step: OnboardingHref) => void;
  reset: () => void;
};

type OnboardingData = Omit<
  OnboardingState,
  | 'setLastLearned'
  | 'setStage'
  | 'toggleGoal'
  | 'confirmGoals'
  | 'setNames'
  | 'setReturning'
  | 'setKeyDates'
  | 'clearKeyDates'
  | 'setStep'
  | 'reset'
>;

const EMPTY: OnboardingData = {
  lastLearned: null,
  stage: null,
  goals: [],
  displayName: '',
  partnerName: '',
  returning: false,
  keyDates: {},
  remindWeekBefore: true,
  answeredAt: {},
  step: null,
};

const now = () => new Date().toISOString();

const STORAGE_KEY = 'quiz';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STEPS: readonly string[] = [...ONBOARDING_STEPS, AFTER_PLAN];
const QUESTION_IDS: readonly OnboardingQuestionId[] = ['last_learned', 'stage', 'goals'];

const oneOf = <T extends string>(all: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (all as readonly string[]).includes(value) ? (value as T) : null;
const name = (value: unknown) => (typeof value === 'string' ? value.slice(0, NAME_MAX) : '');

/** Reads the copy kept on the phone; anything damaged or unknown is dropped, never thrown. */
function restore(storage: KeyValueStorage): OnboardingData {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value || typeof value !== 'object') return { ...EMPTY };
    const goals = Array.isArray(value.goals) ? value.goals : [];
    const dates = (value.keyDates ?? {}) as Record<string, unknown>;
    const keyDates: KeyDateValues = {};
    for (const kind of ONBOARDING_KEY_DATES) {
      const date = dates[kind];
      if (typeof date === 'string' && ISO_DATE.test(date)) keyDates[kind] = date;
    }
    const times = (value.answeredAt ?? {}) as Record<string, unknown>;
    const answeredAt: Partial<Record<OnboardingQuestionId, string>> = {};
    for (const id of QUESTION_IDS) {
      const time = times[id];
      if (typeof time === 'string' && !Number.isNaN(Date.parse(time))) answeredAt[id] = time;
    }
    return {
      lastLearned: oneOf(LAST_LEARNED, value.lastLearned),
      stage: oneOf(STAGES, value.stage),
      goals: GOALS.filter((g) => goals.includes(g)),
      displayName: name(value.displayName),
      partnerName: name(value.partnerName),
      returning: value.returning === true,
      keyDates,
      remindWeekBefore: value.remindWeekBefore !== false,
      answeredAt,
      step: oneOf(STEPS, value.step) as OnboardingHref | null,
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Nothing worth keeping: no answer, date, returning choice, nor a step past 01. */
function isPristine(state: OnboardingData): boolean {
  return (
    !hasOnboardingAnswers(state) &&
    Object.keys(state.keyDates).length === 0 &&
    state.remindWeekBefore &&
    !state.returning &&
    (state.step === null || state.step === '/welcome')
  );
}

function snapshot(state: OnboardingState): OnboardingData {
  const { lastLearned, stage, goals, displayName, partnerName, returning } = state;
  const { keyDates, remindWeekBefore, answeredAt, step } = state;
  return {
    lastLearned,
    stage,
    goals,
    displayName,
    partnerName,
    returning,
    keyDates,
    remindWeekBefore,
    answeredAt,
    step,
  };
}

/**
 * What the person told us before they have an account (screens 03, 05, 06, 07, 47), and the step
 * they were on. Kept in the encrypted MMKV store (`onboardingPending:quiz`, MOB-61b) so an app kill
 * before sign-in loses nothing, like T1's answer and N's time (`pendingSetup.ts`, MOB-61). Written
 * once, by `useSetupBond`, after sign-in (`create_couple` + profile name + key dates), then cleared
 * (also on `ALREADY_PAIRED`). Names and answers are never logged or sent to analytics. Storage
 * failures are swallowed: the in-memory copy still works for this launch.
 */
export function createOnboardingStore(storage: KeyValueStorage) {
  const store = create<OnboardingState>()((set) => ({
    ...restore(storage),
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
    setStep: (step) => set((state) => (state.step === step ? state : { step })),
    reset: () => set({ ...EMPTY }),
  }));
  store.subscribe((state) => {
    const value = snapshot(state);
    try {
      if (isPristine(value)) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Storage unavailable: kept in memory for this launch.
    }
  });
  return store;
}

export const useOnboarding = createOnboardingStore(createKeyValueStorage('onboardingPending:'));

/**
 * MOB-61b: where a signed-out phone resumes onboarding after an app kill: the step it was last on
 * (L, 08 included), or null to start at 01 as usual.
 */
export function resumeStep(state: Pick<OnboardingState, 'step'>): OnboardingHref | null {
  return state.step && state.step !== '/welcome' ? state.step : null;
}

/**
 * MOB-61b: a signed-in person (a brand-new account sent through the quiz, D40) still mid-quiz
 * after an app kill: the step to resume, or null once the quiz is over (08 or later).
 */
export function quizInProgress(state: Pick<OnboardingState, 'step'>): OnboardingHref | null {
  const step = resumeStep(state);
  return step && step !== AFTER_PLAN ? step : null;
}

/**
 * True once the person answered anything in the story or quiz (03, 05, 06, 07), on this launch or
 * one before it (kept on the phone until the setup, MOB-61b).
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
