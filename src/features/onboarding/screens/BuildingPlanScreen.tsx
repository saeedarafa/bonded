import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Icon, Mascot, ProgressBar, Text, useReducedMotion, useTheme } from '@/ui';

import { orderedGoals } from '../flow';
import { OnboardingFrame } from '../OnboardingFrame';
import { usePendingSetup } from '../pendingSetup';
import { GOALS, useOnboarding } from '../store';
import { useStepNav } from '../useStepNav';

/** L ticks one line about every 0.9 s and moves on after about 4 s (board S01). */
export const BUILD_STEP_MS = 900;
export const BUILD_TOTAL_MS = 4000;
/** Reduced motion: everything is ticked at once; a short pause to read it, then P2. */
export const BUILD_REDUCED_MS = 1500;

const DEFAULT_TIME = '21:00';

/** The four lines, from what the person told us (05 stage, 06 goals, N time and reminders). */
function useChecklist(): string[] {
  const { t } = useTranslation();
  const stage = useOnboarding((s) => s.stage);
  const goals = orderedGoals(
    useOnboarding((s) => s.goals),
    GOALS,
  );
  const time = usePendingSetup((s) => s.ritualTime) ?? DEFAULT_TIME;
  const reminders = usePendingSetup((s) => s.reminders);
  const short = goals.map((g) => t(`onboarding.goalsShort.${g}`));
  const goalsLine =
    short.length >= 2
      ? t('onboarding.building.goalsTwo', { first: short[0], second: short[1] })
      : short.length === 1
        ? t('onboarding.building.goalsOne', { first: short[0] })
        : t('onboarding.building.goalsNone');
  return [
    t(`onboarding.building.stage.${stage ?? 'none'}`),
    goalsLine,
    reminders === 'on'
      ? t('onboarding.building.remindersOn', { time })
      : t('onboarding.building.remindersOff', { time }),
    t('onboarding.building.week'),
  ];
}

/**
 * L Building your plan (D50): about 4 s, a checklist built from the stage, goals and daily moment,
 * then P2 by itself (replacing L, so Back from P2 goes to N). Declined reminders read "Daily moment
 * set for 21:00" with the chosen time. Reduced motion: no ticking or bar animation; every line is
 * done at once and P2 follows after a short pause.
 */
export function BuildingPlanScreen() {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const reduced = useReducedMotion();
  const nav = useStepNav('/plan/building');
  const me = useOnboarding((s) => s.displayName).trim();
  const partnerName = useOnboarding((s) => s.partnerName).trim();
  const partner = partnerName || t('onboarding.partnerFallback');
  const lines = useChecklist();
  const [ticked, setTicked] = useState(0);
  const done = reduced ? lines.length : ticked;
  const { replace } = nav;

  useEffect(() => {
    if (reduced) {
      const timer = setTimeout(replace, BUILD_REDUCED_MS);
      return () => clearTimeout(timer);
    }
    const timers = lines.map((_, i) =>
      setTimeout(() => setTicked((d) => Math.max(d, i + 1)), BUILD_STEP_MS * (i + 1)),
    );
    timers.push(setTimeout(replace, BUILD_TOTAL_MS));
    return () => timers.forEach(clearTimeout);
    // Runs once per screen: the lines and `replace` don't restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const title =
    me && partnerName
      ? t('onboarding.building.title', {
          names: t('onboarding.bondCard', { me, partner: partnerName }),
        })
      : t('onboarding.building.titleFallback');

  return (
    <OnboardingFrame screenId="L" centered>
      <View style={{ alignItems: 'center', gap: space.md }}>
        <Mascot mood="snuggled" size={150} accessibilityLabel={t('onboarding.building.mascot')} />
        <Text
          testID="L-title"
          variant="h1"
          accessibilityRole="header"
          style={{ textAlign: 'center' }}
        >
          {title}
        </Text>
        <View style={{ alignSelf: 'stretch' }}>
          <ProgressBar
            testID="L-progress"
            value={done / lines.length}
            label={t('onboarding.building.progress')}
          />
        </View>
      </View>
      <View testID="L-checklist" style={{ gap: space.md + 2 }}>
        {lines.map((line, i) => {
          const state = i < done ? 'done' : i === done ? 'current' : 'pending';
          return (
            <View
              key={i}
              testID={`L-step-${i}`}
              accessible
              accessibilityLabel={t(
                state === 'done'
                  ? 'onboarding.building.stepDone'
                  : 'onboarding.building.stepPending',
                { label: line },
              )}
              accessibilityLiveRegion={state === 'done' ? 'polite' : 'none'}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
            >
              <View
                testID={`L-step-${i}-${state}`}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: state === 'done' ? colors.you : 'transparent',
                  borderWidth: state === 'done' ? 0 : state === 'current' ? 3 : 2,
                  borderColor: state === 'current' ? colors.you : colors.line,
                  borderRightColor: state === 'current' ? colors.surface2 : colors.line,
                }}
              >
                {state === 'done' ? (
                  <Icon name="check" size={15} strokeWidth={3} color={colors.onYou} />
                ) : null}
              </View>
              <Text
                variant={state === 'current' ? 'label' : 'body'}
                tone={state === 'pending' ? 'text2' : 'text'}
                style={{ flexShrink: 1 }}
              >
                {line}
              </Text>
            </View>
          );
        })}
      </View>
      <View
        testID="L-closer"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.md + 2,
          borderRadius: radius.card - 4,
          backgroundColor: colors.youTint,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface,
          }}
        >
          <Icon name="flask" size={18} color={colors.youText} />
        </View>
        <Text variant="caption" tone="text2" style={{ flex: 1 }}>
          <Text variant="label" tone="text">
            {t('onboarding.building.closerTitle')}
          </Text>{' '}
          {t('onboarding.building.closerBody', { partner })}
        </Text>
      </View>
    </OnboardingFrame>
  );
}
