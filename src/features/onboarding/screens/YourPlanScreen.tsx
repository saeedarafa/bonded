import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import { Button, Text, useReducedMotion, useTheme } from '@/ui';

import { ALMOST_THERE } from '../flow';
import { OnboardingFrame } from '../OnboardingFrame';
import { usePendingSetup } from '../pendingSetup';
import { RESEARCH } from '../research';
import { useOnboarding } from '../store';
import { useStepNav } from '../useStepNav';

const DEFAULT_TIME = '21:00';
/** Board: each bar grows over 1.2 s, the second 0.3 s after the first. */
const BAR_MS = 1200;
const BAR_DELAYS = [300, 600] as const;

/**
 * P2 Your plan (D50, board S01): why it works. A two-bar chart (Gottman & Driver), two findings
 * with their source lines (Aron et al. 1997; Gable et al. 2004/2006), then "Bonded turns this into
 * 3 minutes a day for <names>, at <time>" and "Start our plan" (→ P3 soft paywall, MOB-62; a
 * joiner holding an invite goes straight to sign-in). Figures and citations come only from `research.ts` (LEAD-13 checks them). The
 * chart reads as one element to a screen reader, with both values and the source. Reduced motion:
 * the bars are drawn at full length.
 */
export function YourPlanScreen() {
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const nav = useStepNav('/plan/yours');
  const me = useOnboarding((s) => s.displayName).trim();
  const partner = useOnboarding((s) => s.partnerName).trim();
  const time = usePendingSetup((s) => s.ritualTime) ?? DEFAULT_TIME;
  const names =
    me && partner ? t('onboarding.bondCard', { me, partner }) : t('onboarding.plan.namesFallback');
  const { turningToward, personalQuestions, warmResponses, minutesPerDay } = RESEARCH;

  const bars = [
    {
      key: 'stayed',
      label: t('onboarding.plan.stayed'),
      value: turningToward.stayedTogetherPercent,
      fill: colors.you,
      tone: 'youText' as const,
    },
    {
      key: 'split',
      label: t('onboarding.plan.split'),
      value: turningToward.splitUpPercent,
      fill: colors.doughLine,
      tone: 'text2' as const,
    },
  ];
  // The visible intro ends in a colon; the spoken label joins sentences with ". " (QA-34: no ":.").
  const intro = t('onboarding.plan.chartIntro');
  const chartLabel = [
    t('onboarding.plan.chartA11y', { intro: intro.replace(/[\s:.]+$/u, '') }),
    ...bars.map((b) => t('onboarding.plan.barA11y', { label: b.label, value: b.value })),
    t('onboarding.plan.sourceA11y', { source: turningToward.source }),
  ].join('. ');

  const findings = [
    {
      key: 'personal',
      figure: personalQuestions.figure,
      text: t('onboarding.plan.personalQuestions'),
      source: personalQuestions.source,
    },
    {
      key: 'warm',
      figure: t('onboarding.plan.warmFigure'),
      text: t('onboarding.plan.warmResponses'),
      source: warmResponses.source,
    },
  ];

  return (
    <OnboardingFrame
      screenId="P2"
      almost={ALMOST_THERE.P2}
      onBack={nav.back}
      footer={
        <>
          <Text testID="P2-summary" variant="label" style={{ textAlign: 'center' }}>
            {t('onboarding.plan.summary', { minutes: minutesPerDay, names, time })}
          </Text>
          <Button testID="P2-start" label={t('onboarding.plan.start')} onPress={nav.next} />
        </>
      }
    >
      <Text testID="P2-title" variant="h1" accessibilityRole="header">
        {t('onboarding.plan.title')}
      </Text>
      <View
        testID="P2-chart"
        accessible
        accessibilityRole="image"
        accessibilityLabel={chartLabel}
        style={{
          gap: space.md + 2,
          padding: space.lg + 2,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surface,
        }}
      >
        <Text variant="label">{intro}</Text>
        {bars.map((bar, i) => (
          <View key={bar.key} testID={`P2-bar-${bar.key}`} style={{ gap: space.xs + 2 }}>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                columnGap: space.sm,
              }}
            >
              <Text variant="label" style={{ flexShrink: 1 }}>
                {bar.label}
              </Text>
              <Text
                testID={`P2-bar-${bar.key}-value`}
                variant="h2"
                tone={bar.tone}
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {t('onboarding.plan.percent', { value: bar.value })}
              </Text>
            </View>
            <Bar value={bar.value} fill={bar.fill} delay={BAR_DELAYS[i] ?? 0} />
          </View>
        ))}
        <Text testID="P2-chart-source" variant="caption" tone="text2">
          {turningToward.source}
        </Text>
      </View>
      <View>
        {findings.map((f) => (
          <View
            key={f.key}
            testID={`P2-finding-${f.key}`}
            accessible
            accessibilityLabel={t('onboarding.plan.findingA11y', {
              figure: f.figure,
              text: f.text,
              source: f.source,
            })}
            style={{
              flexDirection: 'row',
              gap: space.md,
              paddingVertical: space.md,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            <Text
              variant="h2"
              tone="youText"
              style={{ minWidth: 64, fontVariant: ['tabular-nums'] }}
            >
              {f.figure}
            </Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="body">{f.text}</Text>
              <Text testID={`P2-finding-${f.key}-source`} variant="caption" tone="text2">
                {f.source}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </OnboardingFrame>
  );
}

function Bar({ value, fill, delay }: { value: number; fill: string; delay: number }) {
  const { colors, motion } = useTheme();
  const reduced = useReducedMotion();
  const width = useSharedValue(reduced ? value : 0);
  useEffect(() => {
    const [a, b, c, d] = motion.easing.standard;
    width.value = reduced
      ? value
      : withDelay(
          delay,
          withTiming(value, { duration: BAR_MS, easing: Easing.bezier(a!, b!, c!, d!) }),
        );
  }, [reduced, value, delay, width, motion.easing.standard]);
  const style = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return (
    <View
      style={{ height: 14, borderRadius: 7, backgroundColor: colors.surface2, overflow: 'hidden' }}
    >
      <Animated.View style={[{ height: 14, borderRadius: 7, backgroundColor: fill }, style]} />
    </View>
  );
}
