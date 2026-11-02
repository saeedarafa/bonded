import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useTranslation } from '@/i18n';

import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

type Props = { name: string; testID?: string };

/** "Sam is typing" with three pulsing dots (still dots with reduced motion). Presence only, D15. */
export function TypingIndicator({ name, testID }: Props) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={t('ui.typing', { name })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start' }}
    >
      <Text variant="caption" tone="text3">
        {t('ui.typing', { name })}
      </Text>
      <View
        style={{ flexDirection: 'row', gap: 3 }}
        importantForAccessibility="no-hide-descendants"
      >
        {[0, 1, 2].map((i) => (
          <Dot key={i} index={i} color={colors.text3} />
        ))}
      </View>
    </View>
  );
}

function Dot({ index, color }: { index: number; color: string }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 0.7 : 0.3);
  useEffect(() => {
    if (reduced) return undefined;
    opacity.value = withDelay(
      index * 200,
      withRepeat(
        withSequence(withTiming(1, { duration: 400 }), withTiming(0.3, { duration: 800 })),
        -1,
      ),
    );
    return () => cancelAnimation(opacity);
  }, [reduced, index, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }, style]}
    />
  );
}
