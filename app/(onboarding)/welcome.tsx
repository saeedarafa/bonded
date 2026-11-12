import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { trackStepCompleted } from '@/features/onboarding/analytics';
import { FIRST_STEP } from '@/features/onboarding/flow';
import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { useOnboarding } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import { Button, Mascot, Text, useTheme } from '@/ui';

/**
 * 01 Welcome. "Get started" opens 05, the first quiz step (D50 order, `flow.ts`). "I have an
 * invite code" goes straight to the joiner flow (J3). "I already have an account" goes straight
 * to sign-in, skipping the story and quiz (D40; not on the board, GAPS.md).
 */
export default function OnboardingWelcomeRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { space } = useTheme();
  return (
    <OnboardingFrame
      screenId="01"
      centered
      footer={
        <>
          <Button
            testID="01-start"
            label={t('onboarding.getStarted')}
            onPress={() => {
              // The story and quiz, not "Welcome back" (a kept choice from before, MOB-61b).
              useOnboarding.getState().setReturning(false);
              trackStepCompleted('/welcome');
              router.push(FIRST_STEP);
            }}
          />
          <Button
            testID="01-code"
            variant="ghost"
            label={t('onboarding.haveCode')}
            onPress={() => router.push('/join/code')}
          />
          <Button
            testID="01-sign-in"
            variant="ghost"
            label={t('onboarding.haveAccount')}
            onPress={() => {
              useOnboarding.getState().setReturning(true);
              router.push('/sign-in');
            }}
          />
        </>
      }
    >
      <View style={{ alignItems: 'center', gap: space.lg }}>
        <Mascot mood="together" size={180} />
        <Text variant="caption" tone="text2" style={{ letterSpacing: 2 }}>
          {t('onboarding.brand')}
        </Text>
        <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('onboarding.welcomeTitle')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('onboarding.welcomeBody')}
        </Text>
      </View>
    </OnboardingFrame>
  );
}
