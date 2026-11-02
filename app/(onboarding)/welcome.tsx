import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { useTranslation } from '@/i18n';
import { Button, Mascot, Text, useTheme } from '@/ui';

/** 01 Welcome. "I have an invite code" goes straight to the joiner flow (J3). */
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
            onPress={() => router.push('/story/1')}
          />
          <Button
            testID="01-code"
            variant="ghost"
            label={t('onboarding.haveCode')}
            onPress={() => router.push('/join/code')}
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
