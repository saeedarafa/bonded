import { useEffect } from 'react';
import {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { haptics } from './haptics';
import { useReducedMotion } from './useReducedMotion';

/**
 * Field error feedback (DESIGN.md §6): a 400 ms shake plus the error haptic, each time `trigger`
 * changes to a truthy value (a new error message, a wrong code). Reduced motion keeps the haptic
 * and drops the shake. Spread the returned style on an Animated.View.
 */
export function useShake(trigger: string | null | undefined) {
  const reduced = useReducedMotion();
  const x = useSharedValue(0);

  useEffect(() => {
    if (!trigger) return;
    haptics.error();
    if (reduced) return;
    x.value = withSequence(
      withTiming(-8, { duration: 50 }),
      withRepeat(withTiming(8, { duration: 100 }), 5, true),
      withTiming(0, { duration: 50 }),
    );
  }, [trigger, reduced, x]);

  return useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
}
