import { useState } from 'react';
import { View } from 'react-native';

import { StageTile, STAGE_ICONS } from '@/features/onboarding/components';
import { QUIZ_STEP } from '@/features/onboarding/flow';
import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { STAGES, useOnboarding } from '@/features/onboarding/store';
import { useStepNav } from '@/features/onboarding/useStepNav';
import { useTranslation } from '@/i18n';
import { Button, Text, useTheme } from '@/ui';

/**
 * 05 Quiz: your stage (D50: first quiz step, 1 of 4, right after 01). 2×2 illustrated tiles.
 * Picks the 02 story version and becomes `couples.stage`; synced as `stage` (questionnaire v2).
 */
export default function OnboardingQuizStageRoute() {
  const { t } = useTranslation();
  const { space, colors } = useTheme();
  const nav = useStepNav('/quiz/stage');
  const stage = useOnboarding((s) => s.stage);
  const setStage = useOnboarding((s) => s.setStage);
  const [missing, setMissing] = useState(false);

  return (
    <OnboardingFrame
      screenId="05"
      step={QUIZ_STEP['05']}
      onBack={nav.back}
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
            onPress={() => (stage ? nav.next() : setMissing(true))}
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
      <View
        testID="05-tiles"
        accessibilityRole="radiogroup"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm + 2 }}
      >
        {STAGES.map((value) => (
          <StageTile
            key={value}
            testID={`05-${value}`}
            icon={STAGE_ICONS[value]}
            label={t(`onboarding.stages.${value}`)}
            selected={stage === value}
            onPress={() => setStage(value)}
          />
        ))}
      </View>
    </OnboardingFrame>
  );
}
