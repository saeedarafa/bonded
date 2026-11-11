import type { Goal, Stage } from './store';

/**
 * D50 onboarding order (MOB-60, MOB-61, board S01). Routes keep their names:
 *
 *   01 /welcome → 05 /quiz/stage (1/4) → 07 /quiz/names (2/4) → 02 /story/1 → 03 /story/2 (3/4)
 *   → 04 /story/3 → 06 /quiz/goals (4/4) → 47 /quiz/dates (optional; stays here for now, GAPS)
 *   → T1 /plan/first-question → N /plan/moment → L /plan/building → P2 /plan/yours
 *   → P3 /plan/trial (soft trial paywall, MOB-62) → AFTER_PLAN (sign-in)
 *
 * Every Continue goes to `nextStep(path)`; Back goes to the previous step in this list, so back
 * navigation follows the order even when a step was opened directly (a deep link, a test). L runs
 * by itself and replaces itself with P2, so Back from P2 goes to N (`previousStep` skips L).
 */
export const ONBOARDING_STEPS = [
  '/welcome',
  '/quiz/stage',
  '/quiz/names',
  '/story/1',
  '/story/2',
  '/story/3',
  '/quiz/goals',
  '/quiz/dates',
  '/plan/first-question',
  '/plan/moment',
  '/plan/building',
  '/plan/yours',
  '/plan/trial',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Where 06 goes: 47 key dates (between 06 and T1 until the lead/PO place it; GAPS 47). */
export const AFTER_QUIZ = '/quiz/dates' as const;

/** P3, the soft trial paywall after P2 (D50, MOB-62). Only the person who starts the couple. */
export const TRIAL_PAYWALL = '/plan/trial' as const;

/** Where onboarding ends: sign-in (08), after P3. A signed-in person goes to `/` instead. */
export const AFTER_PLAN = '/sign-in' as const;

export type OnboardingHref = OnboardingStep | typeof AFTER_PLAN;

/** Steps that run by themselves and are never returned to with Back (L). */
const PASS_THROUGH: readonly OnboardingStep[] = ['/plan/building'];

/**
 * The step after `step`. A joiner arriving by invite (a pending invite on this phone) never sees
 * P3 (D50, D29): P2 then goes straight to sign-in.
 */
export function nextStep(
  step: OnboardingStep,
  { joining = false }: { joining?: boolean } = {},
): OnboardingHref {
  const i = ONBOARDING_STEPS.indexOf(step);
  const next = ONBOARDING_STEPS[i + 1] ?? AFTER_PLAN;
  return joining && next === TRIAL_PAYWALL ? AFTER_PLAN : next;
}

export function previousStep(step: OnboardingStep): OnboardingStep {
  let i = ONBOARDING_STEPS.indexOf(step) - 1;
  while (i > 0 && PASS_THROUGH.includes(ONBOARDING_STEPS[i]!)) i -= 1;
  return ONBOARDING_STEPS[Math.max(0, i)] ?? '/welcome';
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

/** T1 and P2 show "Almost there" with a fuller bar instead of n/4 (board S01). */
export const ALMOST_THERE = {
  T1: 0.7,
  P2: 0.9,
} as const;
