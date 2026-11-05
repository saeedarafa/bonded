import { ScrollView, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTranslation } from '@/i18n';

import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

/** Streak badge steps (DESIGN.md §7). */
export const BADGE_STEPS = [1, 3, 7, 14, 21, 30, 50, 100, 365] as const;

export type BadgeState = 'earned' | 'next' | 'locked';

/**
 * Pure: state and progress of each step for a streak of `current` days.
 * - `earned` (the steps awarded in `badge_awards`, MOB-17) decides what is earned. Without it a
 *   step is earned once the streak reaches it (gallery, previews).
 * - Next = the first step not earned that the streak has not reached yet. Its ring is the share of
 *   the way there (`current / days`, boards 52 and 52b: 12 of 14 days, 3 of 7 days).
 */
export function badgeStates(
  current: number,
  steps: readonly number[] = BADGE_STEPS,
  earned?: readonly number[],
): { days: number; state: BadgeState; progress: number }[] {
  const isEarned = (days: number) => (earned ? earned.includes(days) : days <= current);
  const next = steps.find((s) => !isEarned(s) && s > current);
  return steps.map((days) => {
    if (isEarned(days)) return { days, state: 'earned' as const, progress: 1 };
    if (days === next) {
      return { days, state: 'next' as const, progress: Math.max(0, Math.min(1, current / days)) };
    }
    return { days, state: 'locked' as const, progress: 0 };
  });
}

/** The next step to earn (see `badgeStates`), or undefined when every step is earned. */
export function nextBadgeStep(
  current: number,
  steps: readonly number[] = BADGE_STEPS,
  earned?: readonly number[],
): number | undefined {
  return badgeStates(current, steps, earned).find((s) => s.state === 'next')?.days;
}

const NODE = 36;

type Props = {
  /** Current streak in days. */
  current: number;
  steps?: readonly number[];
  /** Steps awarded in `badge_awards`; omit to derive them from `current`. */
  earned?: readonly number[];
  /** The step that was just unlocked (52b): it gets an outer ring. */
  highlight?: number;
  testID?: string;
};

/** Horizontal ladder of shared streak steps (gold, D41): earned (filled), next (ring shows progress), locked (dashed). Scrolls if it doesn't fit. */
export function BadgeLadder({ current, steps = BADGE_STEPS, earned, highlight, testID }: Props) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const items = badgeStates(current, steps, earned);

  return (
    <View testID={testID} accessible={false}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel={t('ui.badge.ladder')}
        contentContainerStyle={{ alignItems: 'center', gap: space.md, paddingVertical: space.sm }}
      >
        {items.map(({ days, state, progress }) => {
          const label =
            state === 'earned'
              ? t('ui.badge.earned', { days })
              : state === 'next'
                ? t('ui.badge.next', { days, percent: Math.round(progress * 100) })
                : t('ui.badge.locked', { days });
          const circumference = 2 * Math.PI * 20;
          return (
            <View
              key={days}
              accessible
              accessibilityLabel={label}
              testID={`badge-${days}-${state}`}
              style={{
                width: NODE,
                height: NODE,
                borderRadius: NODE / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor:
                  state === 'earned'
                    ? colors.premium
                    : state === 'next'
                      ? colors.premiumTint
                      : colors.surface,
                borderWidth: state === 'locked' ? 2 : days === highlight ? 3 : 0,
                borderStyle: state === 'locked' ? 'dashed' : 'solid',
                borderColor: state === 'locked' ? colors.text3 : colors.premiumTint,
              }}
            >
              {state === 'next' ? (
                <Svg width={44} height={44} style={{ position: 'absolute' }}>
                  <Circle
                    cx={22}
                    cy={22}
                    r={20}
                    fill="none"
                    stroke={colors.premium}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeDasharray={`${circumference * progress} ${circumference}`}
                    rotation={-90}
                    origin="22, 22"
                  />
                </Svg>
              ) : null}
              {/* Decorative number in a fixed circle; the label above carries the meaning. */}
              <Text
                variant="label"
                allowFontScaling={false}
                style={{
                  fontVariant: ['tabular-nums'],
                  color:
                    state === 'earned'
                      ? colors.onPremium
                      : state === 'next'
                        ? colors.premiumText
                        : colors.text3,
                }}
              >
                {days}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
