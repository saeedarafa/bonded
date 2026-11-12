import { onboardingStepId } from '@/features/analytics/screens';
import { ritualTimeAnalyticsId } from '@/features/push/ritual';
import {
  forgetOnDevice,
  lengthBucket,
  recallOnDevice,
  rememberOnDevice,
  track,
  type EventProps,
} from '@/lib/analytics';

import type { OnboardingStep } from './flow';
import { usePendingSetup } from './pendingSetup';
import { useOnboarding } from './store';

/**
 * Onboarding funnel call sites (MOB-24d, ANALYTICS §3.2). Option ids, flags and numbers only:
 * 07 sends whether both names were given, never the names; T1 sends a length bucket, never the
 * answer; N sends the preset (or `other`), never the exact time.
 */

const STARTED_AT = 'onboarding_started_at';
const P3_PURCHASED = 'onboarding_p3_purchased';

/** The step's option ids, read from the onboarding stores when the person moves on. */
function completedProps(step: OnboardingStep): EventProps<'onboarding_step_completed'> | null {
  const id = onboardingStepId(step);
  if (!id) return null;
  const quiz = useOnboarding.getState();
  switch (id) {
    case '05':
      return quiz.stage ? { step: id, stage: quiz.stage } : { step: id };
    case '03':
      return quiz.lastLearned ? { step: id, last_learned: quiz.lastLearned } : { step: id };
    case '06':
      return { step: id, goals: [...quiz.goals] };
    case '07':
      return {
        step: id,
        names_given: quiz.displayName.trim() !== '' && quiz.partnerName.trim() !== '',
      };
    case 'N': {
      const time = usePendingSetup.getState().ritualTime;
      return time ? { step: id, ritual_time: ritualTimeAnalyticsId(time) } : { step: id };
    }
    default:
      return { step: id };
  }
}

/** Continue on a step (and L moving on by itself). */
export function trackStepCompleted(step: OnboardingStep): void {
  const props = completedProps(step);
  if (props) track('onboarding_step_completed', props);
}

/** Back on a step (the top bar's back). */
export function trackStepBack(step: OnboardingStep): void {
  const id = onboardingStepId(step);
  if (id) track('onboarding_back_pressed', { step: id });
}

/** T1 submitted on the device: the length only. */
export function trackFirstAnswerWritten(text: string): void {
  track('first_answer_written', { length_bucket: lengthBucket(text.length) });
}

/** `onboarding_started`: the clock for `onboarding_completed.duration_s`. */
export function noteOnboardingStarted(now = Date.now()): void {
  rememberOnDevice(STARTED_AT, String(now));
}

/** P3 bought (or restored a purchase) before sign-in: `purchased_on_p3`. */
export function notePurchasedOnP3(): void {
  rememberOnDevice(P3_PURCHASED, '1');
}

/**
 * After sign-in the setup wrote what onboarding collected (`finishOnboarding`). `onboarding_synced`
 * once the D38 answers and T1 are on the server; `onboarding_completed` once, for a person who went
 * through onboarding on this phone (not "I already have an account", D40).
 */
export function trackOnboardingFinished(
  {
    t1Saved,
    answersSynced,
    returning,
  }: { t1Saved: boolean; answersSynced: boolean; returning: boolean },
  now = Date.now(),
): void {
  if (answersSynced) track('onboarding_synced', { t1_saved: t1Saved });
  const started = Number(recallOnDevice(STARTED_AT));
  if (returning || !Number.isFinite(started) || started <= 0) return;
  track('onboarding_completed', {
    duration_s: Math.max(0, Math.round((now - started) / 1000)),
    purchased_on_p3: recallOnDevice(P3_PURCHASED) === '1',
  });
  forgetOnDevice(STARTED_AT);
  forgetOnDevice(P3_PURCHASED);
}
