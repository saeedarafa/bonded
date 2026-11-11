import { useRouter } from 'expo-router';

import { nextStep, previousStep, type OnboardingStep } from './flow';

/**
 * Continue and Back for one D50 onboarding step. Back pops the stack (which follows the order);
 * opened directly with nothing to pop, it goes to the previous step in `ONBOARDING_STEPS`.
 */
export function useStepNav(step: OnboardingStep) {
  const router = useRouter();
  return {
    next: () => router.push(nextStep(step)),
    back: () => (router.canGoBack() ? router.back() : router.replace(previousStep(step))),
  };
}
