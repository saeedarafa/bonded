import { useEffect, useMemo } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

type Props = {
  /** Start a burst when this turns true. */
  active: boolean;
  /** Number of bursts (the milestone jump plays 3×). */
  bursts?: number;
  count?: number;
  onDone?: () => void;
  testID?: string;
};

/** Deterministic pseudo-random in [0, 1): stable layouts, no flicker between renders and in tests. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Sesame-seed confetti (DESIGN.md §6): 1.6 s per burst, falls once and fades. Nothing renders
 * with reduced motion (the screen shows a still celebration instead). Never intercepts touches.
 */
export function Confetti({ active, bursts = 1, count = 28, onDone, testID }: Props) {
  const reduced = useReducedMotion();
  const { motion } = useTheme();

  useEffect(() => {
    if (!active || reduced || !onDone) return undefined;
    const timer = setTimeout(onDone, bursts * motion.duration.celebrate + 400);
    return () => clearTimeout(timer);
  }, [active, reduced, onDone, bursts, motion.duration.celebrate]);

  if (!active || reduced) return null;
  return (
    <View
      testID={testID}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
    >
      {Array.from({ length: bursts * count }, (_, i) => (
        <Seed key={i} index={i} burst={Math.floor(i / count)} />
      ))}
    </View>
  );
}

function Seed({ index, burst }: { index: number; burst: number }) {
  const { colors, motion } = useTheme();
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);

  const seed = useMemo(
    () => ({
      x: rand(index + 1) * width,
      drift: (rand(index + 50) - 0.5) * 120,
      delay: burst * motion.duration.celebrate + rand(index + 100) * 300,
      spin: 360 + rand(index + 150) * 540,
      color: [colors.you, colors.partner, colors.blush, colors.bamboo, colors.dough][index % 5],
    }),
    [index, burst, width, colors, motion.duration.celebrate],
  );

  useEffect(() => {
    progress.value = withDelay(
      seed.delay,
      withTiming(1, { duration: motion.duration.celebrate, easing: Easing.out(Easing.ease) }),
    );
  }, [progress, seed.delay, motion.duration.celebrate]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value === 0 ? 0 : 1 - progress.value * progress.value,
    transform: [
      { translateX: seed.x + seed.drift * progress.value },
      { translateY: -20 + progress.value * height * 0.85 },
      { rotate: `${seed.spin * progress.value}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          width: 8,
          height: 12,
          borderRadius: 4,
          backgroundColor: seed.color,
        },
        style,
      ]}
    />
  );
}
