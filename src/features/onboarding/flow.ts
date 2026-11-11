import type { Goal, Stage } from './store';

/**
 * D50 onboarding order (MOB-60, board S01). Routes keep their names; only the order changed:
 *
 *   01 /welcome → 05 /quiz/stage (1/4) → 07 /quiz/names (2/4) → 02 /story/1 → 03 /story/2 (3/4)
 *   → 04 /story/3 → 06 /quiz/goals (4/4) → AFTER_QUIZ
 *
 * Every Continue goes to `nextStep(path)`; Back goes to the previous step in this list, so back
 * navigation follows the order even when a step was opened directly (a deep link, a test).
 */
export const ONBOARDING_STEPS = [
  '/welcome',
  '/quiz/stage',
  '/quiz/names',
  '/story/1',
  '/story/2',
  '/story/3',
  '/quiz/goals',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * The seam after 06 (D50). Until MOB-61/62 build T1 (first answer), N (daily moment), L (building
 * your plan), P2 (your plan) and P3 (soft paywall), 06 continues to the existing tail: 47 key dates
 * (optional; it goes on to 08 sign-in by itself). MOB-61 points this at T1 and moves 47/sign-in
 * behind P3.
 */
export const AFTER_QUIZ = '/quiz/dates' as const;

export type OnboardingHref = OnboardingStep | typeof AFTER_QUIZ;

export function nextStep(step: OnboardingStep): OnboardingHref {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[i + 1] ?? AFTER_QUIZ;
}

export function previousStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.max(0, i - 1)] ?? '/welcome';
}

/** The first step after 01 (also where a brand-new signed-in account without answers starts). */
export const FIRST_STEP = ONBOARDING_STEPS[1];

/** Quiz progress on the D50 screens: 05 1/4, 07 2/4, 03 3/4, 06 4/4. */
export const QUIZ_STEP = {
  '05': { n: 1, total: 4 },
  '07': { n: 2, total: 4 },
  '03': { n: 3, total: 4 },
  '06': { n: 4, total: 4 },
} as const;

/** 02 has four versions (D50). Living together is the default when no stage is known. */
export function storyVariant(stage: Stage | null): Stage {
  return stage ?? 'living_together';
}

/** 06: the picked goals in the board's order (not the tap order), for the summary line. */
export function orderedGoals(goals: readonly Goal[], all: readonly Goal[]): Goal[] {
  return all.filter((g) => goals.includes(g));
}
