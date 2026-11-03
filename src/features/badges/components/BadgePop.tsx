import { useEffect, type ReactNode } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion, useTheme } from '@/ui';

/**
 * The badge "pop" (DESIGN.md §6): scales in with the squish easing. Reduced motion: it fades in
 * instead (badges fade, never pop).
 */
export function BadgePop({ children }: { children: ReactNode }) {
  const { motion } = useTheme();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    const [a, b, c, d] = reduced ? motion.easing.standard : motion.easing.squish;
    progress.value = withTiming(1, {
      duration: motion.duration.slow,
      easing: Easing.bezier(a ?? 0, b ?? 0, c ?? 1, d ?? 1),
    });
  }, [progress, reduced, motion]);

  const style = useAnimatedStyle(() =>
    reduced
      ? { opacity: progress.value }
      : { opacity: 1, transform: [{ scale: 0.4 + 0.6 * progress.value }] },
  );

  return <Animated.View style={style}>{children}</Animated.View>;
}
