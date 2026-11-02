import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { STAGES, useOnboarding } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import { Button, OptionRow, Text, useTheme } from '@/ui';

/** 05 Quiz: your stage (step 1 of 4). Becomes `couples.stage`. */
export default function OnboardingQuizStageRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { space, colors } = useTheme();
  const stage = useOnboarding((s) => s.stage);
  const setStage = useOnboarding((s) => s.setStage);
  const [missing, setMissing] = useState(false);

  return (
    <OnboardingFrame
      screenId="05"
      step={{ n: 1, total: 4 }}
      onBack={() => router.back()}
      footer={
        <>
          {missing && !stage ? (
            <Text
              testID="05-missing"
              variant="caption"
              style={{ color: colors.blushText, textAlign: 'center' }}
              accessibilityLiveRegion="polite"
            >
              {t('onboarding.pickStage')}
            </Text>
          ) : null}
          <Button
            testID="05-next"
            label={t('onboarding.continue')}
            onPress={() => (stage ? router.push('/quiz/goals') : setMissing(true))}
          />
        </>
      }
    >
      <View style={{ gap: space.sm }}>
        <Text variant="h1" accessibilityRole="header">
          {t('onboarding.stageTitle')}
        </Text>
        <Text tone="text2">{t('onboarding.stageBody')}</Text>
      </View>
      <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
        {STAGES.map((value) => (
          <OptionRow
            key={value}
            testID={`05-${value}`}
            label={t(`onboarding.stages.${value}`)}
            selected={stage === value}
            onPress={() => setStage(value)}
          />
        ))}
      </View>
    </OnboardingFrame>
  );
}
