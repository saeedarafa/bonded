import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

type Props = {
  /** 0 to 1. */
  value: number;
  /** Screen-reader name, e.g. "Step 3 of 5" (from t()). */
  label: string;
  testID?: string;
};

/** Onboarding / quiz progress: 6 pt track, orange fill. Fill animates 300 ms unless reduced motion. */
export function ProgressBar({ value, label, testID }: Props) {
  const { colors, motion } = useTheme();
  const reduced = useReducedMotion();
  const clamped = Math.min(1, Math.max(0, value));
  const progress = useSharedValue(clamped);

  useEffect(() => {
    progress.value = reduced ? clamped : withTiming(clamped, { duration: motion.duration.base });
  }, [clamped, reduced, progress, motion.duration.base]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: 'hidden' }}
    >
      <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: colors.you }, fill]} />
    </View>
  );
}
