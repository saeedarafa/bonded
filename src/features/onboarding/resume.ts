import { usePathname } from 'expo-router';
import { useEffect } from 'react';

import { AFTER_PLAN, ONBOARDING_STEPS, type OnboardingHref } from './flow';
import { useOnboarding } from './store';

const RECORDED: readonly string[] = [...ONBOARDING_STEPS, AFTER_PLAN];

/**
 * MOB-61b: keeps `useOnboarding().step` on the onboarding screen in front (01 to P3, and 08), so
 * the front door can resume there after an app kill. Back, Android back and swipe-back count too,
 * since it follows the path rather than the buttons. Other screens leave the step as it was.
 */
export function useRecordOnboardingStep(): void {
  const pathname = usePathname();
  useEffect(() => {
    if (RECORDED.includes(pathname)) useOnboarding.getState().setStep(pathname as OnboardingHref);
  }, [pathname]);
}

/** The quiz is over (on to 08, or `/` for a signed-in person): never resume a quiz step again. */
export function markOnboardingDone(): void {
  useOnboarding.getState().setStep(AFTER_PLAN);
}
