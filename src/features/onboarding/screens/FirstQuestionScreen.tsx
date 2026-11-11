import { useState } from 'react';
import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { AnswerField, Button, haptics, Icon, Text, useTheme } from '@/ui';

import { ALMOST_THERE } from '../flow';
import { OnboardingFrame } from '../OnboardingFrame';
import { usePendingSetup } from '../pendingSetup';
import { useOnboarding } from '../store';
import { useStepNav } from '../useStepNav';

/**
 * T1 Try it: the real day-1 question (D12, D50) answered inside onboarding. "Lock in my answer"
 * keeps it on the phone (encrypted, survives an app kill; `usePendingSetup`) and moves on to N.
 * After sign-in `finishOnboarding` sends it once as my answer to the new couple's day-1 question;
 * Today then shows it locked until the partner answers. Coming back here shows the kept answer,
 * still editable until sign-in. The text is never logged.
 */
export function FirstQuestionScreen() {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const nav = useStepNav('/plan/first-question');
  const partner = useOnboarding((s) => s.partnerName).trim() || t('onboarding.partnerFallback');
  const kept = usePendingSetup((s) => s.firstAnswer);
  const [body, setBody] = useState(kept?.body ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const text = body.trim();
    if (!text) {
      haptics.error();
      setError(t('onboarding.firstQuestion.empty'));
      return;
    }
    // Same text again keeps its first time; an edit is a new answer.
    if (kept?.body !== text) usePendingSetup.getState().setFirstAnswer(text);
    haptics.success();
    nav.next();
  };

  return (
    <OnboardingFrame
      screenId="T1"
      almost={ALMOST_THERE.T1}
      onBack={nav.back}
      footer={
        <>
          <Button
            testID="T1-submit"
            icon="lock"
            label={t('onboarding.firstQuestion.submit')}
            onPress={submit}
          />
          <Text testID="T1-note" variant="caption" tone="text2" style={{ textAlign: 'center' }}>
            {t('onboarding.firstQuestion.note')}
          </Text>
        </>
      }
    >
      <View style={{ gap: space.lg }}>
        <View
          testID="T1-chip"
          style={{
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.xs + 2,
            minHeight: 30,
            paddingHorizontal: space.md,
            borderRadius: radius.pill,
            backgroundColor: colors.youTint,
          }}
        >
          <Icon name="sparkle" size={14} color={colors.youText} />
          <Text variant="caption" style={{ color: colors.youText }}>
            {t('onboarding.firstQuestion.chip')}
          </Text>
        </View>
        <Text testID="T1-question" variant="h1" accessibilityRole="header">
          {t('onboarding.firstQuestion.title', { partner })}
        </Text>
        <AnswerField
          testID="T1-field"
          value={body}
          onChangeText={(text) => {
            setBody(text);
            if (error) setError(null);
          }}
          label={t('onboarding.firstQuestion.label')}
          placeholder={t('onboarding.firstQuestion.placeholder')}
          error={error}
        />
        <View
          testID="T1-private"
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 }}
        >
          <Icon name="lock" size={16} color={colors.text2} />
          <Text variant="caption" tone="text2" style={{ flexShrink: 1 }}>
            {t('onboarding.firstQuestion.private', { partner })}
          </Text>
        </View>
      </View>
    </OnboardingFrame>
  );
}
