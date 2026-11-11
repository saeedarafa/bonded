import { useRouter } from 'expo-router';

import { useSession } from '@/features/auth/session';

import { AFTER_PLAN, nextStep, previousStep, type OnboardingStep } from './flow';

/**
 * Continue and Back for one D50 onboarding step. Back pops the stack (which follows the order);
 * opened directly with nothing to pop, it goes to the previous step in `ONBOARDING_STEPS`.
 * `replace` moves on without keeping this step behind (L). A signed-in person (a brand-new account
 * sent through onboarding, D40) goes to `/` instead of sign-in at the end: the front door runs
 * the setup.
 */
export function useStepNav(step: OnboardingStep) {
  const router = useRouter();
  const { status } = useSession();
  const target = () => {
    const next = nextStep(step);
    return next === AFTER_PLAN && status === 'signedIn' ? '/' : next;
  };
  return {
    next: () => router.push(target()),
    replace: () => router.replace(target()),
    back: () => (router.canGoBack() ? router.back() : router.replace(previousStep(step))),
  };
}
