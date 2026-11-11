import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
  type EasingFunction,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { useTranslation } from '@/i18n';

import { haptics } from '../haptics';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

/** DESIGN.md §6: the ring fills over 1.2 s, with selection ticks, then a success haptic. */
export const HOLD_MS = 1200;
export const TICKS_AT_MS = [300, 600, 900] as const;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Module-level so the React compiler lint doesn't treat the shared value as render state. */
function animateTo(
  value: SharedValue<number>,
  to: number,
  duration: number,
  easing: EasingFunction = Easing.linear,
) {
  value.value = withTiming(to, { duration, easing });
}

function jumpTo(value: SharedValue<number>, to: number) {
  value.value = to;
}

type Props = {
  onComplete: () => void;
  /** Overrides "Hold to reveal" (from t()). */
  label?: string;
  size?: number;
  testID?: string;
};

/**
 * Hold to reveal (screen 20). Releasing early resets the ring. Because holding is impossible for
 * some people, two alternatives always exist:
 * - screen readers get an "activate" action that completes at once;
 * - with reduced motion the control becomes a tap, then a confirming second tap.
 */
export function HoldToReveal({ onComplete, label, size = 72, testID }: Props) {
  const { t } = useTranslation();
  const { colors, motion } = useTheme();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const done = useRef(false);
  const [confirming, setConfirming] = useState(false);

  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const complete = useCallback(() => {
    if (done.current) return;
    done.current = true;
    clearTimers();
    jumpTo(progress, 1);
    haptics.success();
    onComplete();
  }, [clearTimers, onComplete, progress]);

  const start = () => {
    if (reduced || done.current) return;
    clearTimers();
    animateTo(progress, 1, HOLD_MS);
    TICKS_AT_MS.forEach((ms) => timers.current.push(setTimeout(haptics.selection, ms)));
    timers.current.push(setTimeout(complete, HOLD_MS));
  };

  const release = () => {
    if (reduced || done.current) return;
    clearTimers();
    animateTo(progress, 0, motion.duration.fast);
  };

  const tap = () => {
    if (!reduced) return;
    if (!confirming) {
      haptics.selection();
      setConfirming(true);
    } else {
      complete();
    }
  };

  const ring = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  const text =
    label ??
    (reduced ? (confirming ? t('ui.reveal.confirm') : t('ui.reveal.tap')) : t('ui.reveal.hold'));

  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityHint={reduced ? undefined : t('ui.reveal.holdHint')}
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={complete}
        onPressIn={start}
        onPressOut={release}
        onPress={tap}
        style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      >
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.line}
            strokeWidth={stroke}
            fill={colors.bg}
          />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.you}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            animatedProps={ring}
            rotation={-90}
            origin={`${size / 2}, ${size / 2}`}
          />
        </Svg>
        <Icon name="heart" size={size / 3} color={colors.blush} filled />
      </Pressable>
      {/* #109: centred under the ring when it wraps at 200% text. */}
      <Text
        testID={testID ? `${testID}-label` : undefined}
        variant="label"
        tone="text2"
        style={{ textAlign: 'center' }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {text}
      </Text>
    </View>
  );
}
