import { ScrollView, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTranslation } from '@/i18n';

import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

/** Streak badge steps (DESIGN.md §7). */
export const BADGE_STEPS = [1, 3, 7, 14, 21, 30, 50, 100, 365] as const;

export type BadgeState = 'earned' | 'next' | 'locked';

/** Pure: state and progress of each step for a streak of `current` days. */
export function badgeStates(
  current: number,
  steps: readonly number[] = BADGE_STEPS,
): { days: number; state: BadgeState; progress: number }[] {
  const nextIndex = steps.findIndex((s) => s > current);
  return steps.map((days, i) => {
    if (days <= current) return { days, state: 'earned' as const, progress: 1 };
    if (i === nextIndex) {
      const prev = i > 0 ? (steps[i - 1] ?? 0) : 0;
      return { days, state: 'next' as const, progress: (current - prev) / (days - prev) };
    }
    return { days, state: 'locked' as const, progress: 0 };
  });
}

const NODE = 36;

type Props = {
  /** Current streak in days. */
  current: number;
  steps?: readonly number[];
  testID?: string;
};

/** Horizontal ladder: earned (orange), next (ring shows progress), locked (dashed). Scrolls if it doesn't fit. */
export function BadgeLadder({ current, steps = BADGE_STEPS, testID }: Props) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const items = badgeStates(current, steps);

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
                    ? colors.you
                    : state === 'next'
                      ? colors.youTint
                      : colors.surface,
                borderWidth: state === 'locked' ? 2 : 0,
                borderStyle: 'dashed',
                borderColor: colors.text3,
              }}
            >
              {state === 'next' ? (
                <Svg width={44} height={44} style={{ position: 'absolute' }}>
                  <Circle
                    cx={22}
                    cy={22}
                    r={20}
                    fill="none"
                    stroke={colors.you}
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
                      ? colors.onYou
                      : state === 'next'
                        ? colors.youText
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
