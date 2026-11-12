import { useRouter } from 'expo-router';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSession } from '@/features/auth/session';

import { trackStepBack, trackStepCompleted } from './analytics';
import { AFTER_PLAN, nextStep, previousStep, type OnboardingStep } from './flow';
import { markOnboardingDone } from './resume';

/**
 * Continue and Back for one D50 onboarding step. Back pops the stack (which follows the order);
 * opened directly with nothing to pop, it goes to the previous step in `ONBOARDING_STEPS`.
 * `replace` moves on without keeping this step behind (L). A signed-in person (a brand-new account
 * sent through onboarding, D40) goes to `/` instead of sign-in at the end: the front door runs
 * the setup. Someone holding an invite (a joiner, D29) skips P3.
 */
export function useStepNav(step: OnboardingStep) {
  const router = useRouter();
  const { status } = useSession();
  const target = () => {
    const joining = usePendingInvite.getState().code !== null;
    const next = nextStep(step, { joining });
    // MOB-61b: past the quiz, an app kill no longer resumes a quiz step.
    if (next === AFTER_PLAN) markOnboardingDone();
    return next === AFTER_PLAN && status === 'signedIn' ? '/' : next;
  };
  // Analytics (MOB-24d, §3.2): moving on and Back, with the step's option ids only.
  return {
    next: () => {
      trackStepCompleted(step);
      router.push(target());
    },
    replace: () => {
      trackStepCompleted(step);
      router.replace(target());
    },
    back: () => {
      trackStepBack(step);
      if (router.canGoBack()) router.back();
      else router.replace(previousStep(step));
    },
  };
}
