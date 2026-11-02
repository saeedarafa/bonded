import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { haptics } from '../haptics';
import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

type Props = {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Screen-reader name, e.g. "Daily reminder" (from t()). */
  label: string;
  testID?: string;
};

const TRACK_W = 52;
const TRACK_H = 32;
const THUMB = 24;
const PAD = 4;

/** 52 × 32 switch inside a 44 pt tall hit area. Selection haptic on change. */
export function Toggle({ value, onValueChange, label, testID }: Props) {
  const { colors, motion, size } = useTheme();
  const reduced = useReducedMotion();
  const x = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    x.value = reduced
      ? value
        ? 1
        : 0
      : withTiming(value ? 1 : 0, { duration: motion.duration.fast });
  }, [value, reduced, x, motion.duration.fast]);

  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: PAD + x.value * (TRACK_W - THUMB - 2 * PAD) }],
  }));

  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => {
        haptics.selection();
        onValueChange(!value);
      }}
      style={{ minHeight: size.tapTarget, minWidth: size.tapTarget, justifyContent: 'center' }}
    >
      <View
        style={{
          width: TRACK_W,
          height: TRACK_H,
          borderRadius: TRACK_H / 2,
          backgroundColor: value ? colors.you : colors.line,
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={[
            {
              width: THUMB,
              height: THUMB,
              borderRadius: THUMB / 2,
              backgroundColor: colors.dough,
            },
            thumb,
          ]}
        />
      </View>
    </Pressable>
  );
}
