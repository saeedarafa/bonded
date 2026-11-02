import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { GOALS, useOnboarding } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import { Button, OptionRow, Text, useTheme } from '@/ui';

/** 06 Quiz: what you want more of (step 2 of 4). Any number, including none. Becomes `couples.goals`. */
export default function OnboardingQuizGoalsRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { space } = useTheme();
  const goals = useOnboarding((s) => s.goals);
  const toggleGoal = useOnboarding((s) => s.toggleGoal);

  return (
    <OnboardingFrame
      screenId="06"
      step={{ n: 2, total: 4 }}
      onBack={() => router.back()}
      footer={
        <Button
          testID="06-next"
          label={t('onboarding.continue')}
          onPress={() => router.push('/quiz/names')}
        />
      }
    >
      <View style={{ gap: space.sm }}>
        <Text variant="h1" accessibilityRole="header">
          {t('onboarding.goalsTitle')}
        </Text>
        <Text tone="text2">{t('onboarding.goalsBody')}</Text>
      </View>
      <View style={{ gap: space.sm }}>
        {GOALS.map((value) => (
          <OptionRow
            key={value}
            kind="checkbox"
            testID={`06-${value}`}
            label={t(`onboarding.goals.${value}`)}
            selected={goals.includes(value)}
            onPress={() => toggleGoal(value)}
          />
        ))}
      </View>
    </OnboardingFrame>
  );
}
