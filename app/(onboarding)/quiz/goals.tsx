import { View } from 'react-native';

import { GOAL_ICONS, GoalChip } from '@/features/onboarding/components';
import { orderedGoals, QUIZ_STEP } from '@/features/onboarding/flow';
import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame';
import { GOALS, useOnboarding } from '@/features/onboarding/store';
import { useStepNav } from '@/features/onboarding/useStepNav';
import { useTranslation } from '@/i18n';
import { Button, Mascot, Text, useTheme } from '@/ui';

/** "a", "a and b", "a, b and c" (board: "deep talks, laughs and learning about each other"). */
function useJoinList() {
  const { t } = useTranslation();
  return (items: string[]): string => {
    if (items.length <= 1) return items[0] ?? '';
    const last = items[items.length - 1] ?? '';
    if (items.length === 2) return t('onboarding.listTwo', { first: items[0], last });
    const rest = items.slice(0, -1).join(t('onboarding.listSeparator'));
    return t('onboarding.listMany', { rest, last });
  };
}

/**
 * 06 Quiz: what you want more of (D50: the last quiz step, 4 of 4, after 04). Chips, any number
 * including none ("none" is sent as `goals: []`, questionnaire v2). Becomes `couples.goals`. The
 * line under the chips names the picks. Continue goes on to the seam after the quiz (`AFTER_QUIZ`).
 */
export default function OnboardingQuizGoalsRoute() {
  const { t } = useTranslation();
  const { space, colors, radius } = useTheme();
  const nav = useStepNav('/quiz/goals');
  const goals = useOnboarding((s) => s.goals);
  const toggleGoal = useOnboarding((s) => s.toggleGoal);
  const joinList = useJoinList();
  const picked = orderedGoals(goals, GOALS);
  const summary = picked.length
    ? t('onboarding.goalsSummary', {
        count: picked.length,
        list: joinList(picked.map((g) => t(`onboarding.goalsShort.${g}`))),
      })
    : null;

  return (
    <OnboardingFrame
      screenId="06"
      step={QUIZ_STEP['06']}
      onBack={nav.back}
      footer={
        <Button
          testID="06-next"
          label={t('onboarding.continue')}
          onPress={() => {
            useOnboarding.getState().confirmGoals();
            nav.next();
          }}
        />
      }
    >
      <View style={{ gap: space.sm }}>
        <Text variant="h1" accessibilityRole="header">
          {t('onboarding.goalsTitle')}
        </Text>
        <Text tone="text2">{t('onboarding.goalsBody')}</Text>
      </View>
      <View testID="06-chips" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm + 2 }}>
        {GOALS.map((value) => (
          <GoalChip
            key={value}
            testID={`06-${value}`}
            icon={GOAL_ICONS[value]}
            label={t(`onboarding.goals.${value}`)}
            selected={goals.includes(value)}
            onPress={() => toggleGoal(value)}
          />
        ))}
      </View>
      {summary ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingVertical: space.sm + 2,
            paddingHorizontal: space.md + 2,
            borderRadius: radius.input,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surface,
          }}
        >
          <Mascot
            mood="celebrating"
            size={48}
            accessibilityLabel={t('onboarding.goalsSummaryMascot')}
          />
          <Text
            testID="06-summary"
            variant="caption"
            tone="text2"
            style={{ flex: 1 }}
            accessibilityLiveRegion="polite"
          >
            {summary}
          </Text>
        </View>
      ) : null}
    </OnboardingFrame>
  );
}
