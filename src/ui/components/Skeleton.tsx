import { useEffect, type ReactNode } from 'react';
import { View, type DimensionValue } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useTranslation } from '@/i18n';

import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

type Props = {
  width?: DimensionValue;
  height?: number;
  testID?: string;
};

/**
 * Content placeholder, never a spinner (DESIGN.md §6): pulses 1.4 s, still with reduced motion.
 * Hidden from screen readers; wrap a group in `SkeletonGroup` to announce "Loading" once.
 */
export function Skeleton({ width = '100%', height = 14, testID }: Props) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduced) return undefined;
    const ease = Easing.inOut(Easing.ease);
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.5, { duration: 700, easing: ease }),
        withTiming(1, { duration: 700, easing: ease }),
      ),
      -1,
    );
    return () => cancelAnimation(opacity);
  }, [reduced, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: 8, backgroundColor: colors.skeleton }, style]}
    />
  );
}

/** One "Loading" announcement for a group of skeletons. */
export function SkeletonGroup({ children, testID }: { children: ReactNode; testID?: string }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={t('ui.loading')}
      accessibilityState={{ busy: true }}
      style={{ gap: space.sm }}
    >
      {children}
    </View>
  );
}
