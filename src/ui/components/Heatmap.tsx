import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

/** both answered · one answered · missed · today · outside the month / future. */
export type HeatState = 'both' | 'one' | 'missed' | 'today' | 'empty';

export type HeatDay = {
  /** Stable key, e.g. the local date "2026-10-31". */
  key: string;
  /** Day of month, shown in the cell. */
  day: number;
  state: HeatState;
  /** Today's cell: keeps its answer colour and gets a pulsing ring (board 29). */
  today?: boolean;
};

type Props = {
  /** Cells in reading order, 7 per row (pad the first week with `empty`). */
  days: readonly HeatDay[];
  /** Screen-reader summary of the whole month (from t()): "October: 24 of 31 days, both answered 19". */
  label: string;
  testID?: string;
};

const COLUMNS = 7;
const GAP = 6;

/** Month grid. The grid is one accessibility element with the summary; the list below it has the details. */
export function Heatmap({ days, label, testID }: Props) {
  const rows: HeatDay[][] = [];
  for (let i = 0; i < days.length; i += COLUMNS) rows.push(days.slice(i, i + COLUMNS));

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ gap: GAP }}
    >
      {rows.map((row) => (
        <View key={row[0]?.key} style={{ flexDirection: 'row', gap: GAP }}>
          {Array.from({ length: COLUMNS }, (_, i) => {
            const cell = row[i];
            return cell ? (
              <Cell key={cell.key} cell={cell} />
            ) : (
              <View key={`pad-${i}`} style={{ flex: 1 }} />
            );
          })}
        </View>
      ))}
    </View>
  );
}

function Cell({ cell }: { cell: HeatDay }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  // Unanswered today is the outline state; an answered today keeps its colour plus the ring.
  const today = cell.state === 'today' || !!cell.today;
  const ring = !!cell.today && cell.state !== 'today';

  useEffect(() => {
    if (!today || reduced) return undefined;
    pulse.value = withRepeat(
      withSequence(withTiming(0.55, { duration: 700 }), withTiming(1, { duration: 700 })),
      -1,
    );
    return () => cancelAnimation(pulse);
  }, [today, reduced, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const look = {
    both: { bg: colors.you, fg: colors.onYou, border: 'transparent', width: 0 },
    one: { bg: colors.youTint, fg: colors.youText, border: 'transparent', width: 0 },
    missed: { bg: colors.surface, fg: colors.text3, border: colors.line, width: 1 },
    today: { bg: colors.surface, fg: colors.youText, border: colors.you, width: 2 },
    empty: { bg: 'transparent', fg: 'transparent', border: 'transparent', width: 0 },
  }[cell.state];

  return (
    <Animated.View
      style={[
        {
          flex: 1,
          minHeight: 36,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: look.bg,
          borderColor: ring ? colors.youText : look.border,
          borderWidth: ring ? 2 : look.width,
        },
        style,
      ]}
    >
      {cell.state === 'empty' ? null : (
        <Text
          variant="caption"
          allowFontScaling={false}
          style={{ color: look.fg, fontVariant: ['tabular-nums'] }}
        >
          {cell.day}
        </Text>
      )}
    </Animated.View>
  );
}
