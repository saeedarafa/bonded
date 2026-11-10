import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

export type ButtonVariant =
  | 'primary'
  | 'premium'
  | 'ghost'
  | 'destructive'
  /** Outline in blush (42 "Unpair from Sam"): a destructive step that asks again before acting. */
  | 'destructiveGhost'
  | 'link';

type Props = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Shows a spinner and ignores presses (no double submit). The button stays enabled-looking. */
  loading?: boolean;
  icon?: IconName;
  accessibilityHint?: string;
  testID?: string;
};

/**
 * There is no disabled state (DESIGN.md §7): if an action isn't possible yet, the screen says
 * what's missing and the press explains it. Gold (`premium`) only for premium offers.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  icon,
  accessibilityHint,
  testID,
}: Props) {
  const { colors, radius, size, space } = useTheme();
  const [focused, setFocused] = useState(false);

  const palette = {
    primary: { bg: colors.you, fg: colors.onYou },
    premium: { bg: colors.premium, fg: colors.onPremium },
    destructive: { bg: colors.blush, fg: colors.onBlush },
    ghost: { bg: 'transparent', fg: colors.text },
    destructiveGhost: { bg: 'transparent', fg: colors.blushText },
    link: { bg: 'transparent', fg: colors.text2 },
  }[variant];
  const isLink = variant === 'link';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: loading }}
      testID={testID}
      onPress={() => {
        if (!loading) onPress();
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: isLink ? size.tapTarget : size.button,
          borderRadius: radius.pill,
          paddingHorizontal: isLink ? space.sm : space.xl,
          paddingVertical: space.sm,
          gap: space.sm,
          backgroundColor: palette.bg,
          borderWidth: variant === 'ghost' || variant === 'destructiveGhost' ? 1.5 : 0,
          borderColor: variant === 'destructiveGhost' ? colors.blush : colors.line,
          opacity: pressed ? 0.88 : 1,
          transform: [{ scale: pressed && !isLink ? 0.97 : 1 }],
        },
        focused && {
          outlineWidth: 2,
          outlineColor: colors.youText,
          outlineOffset: 3,
          outlineStyle: 'solid',
        },
      ]}
    >
      {loading ? (
        <Spinner color={palette.fg} />
      ) : icon ? (
        <Icon name={icon} color={palette.fg} />
      ) : null}
      <Text
        variant={isLink ? 'label' : 'button'}
        style={[
          { color: palette.fg, flexShrink: 1, textAlign: 'center' },
          isLink && { textDecorationLine: 'underline' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Spinner({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const rotation = useSharedValue(0);
  useEffect(() => {
    if (reduced) return undefined;
    rotation.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
    return () => cancelAnimation(rotation);
  }, [reduced, rotation]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return (
    <Animated.View style={style} testID="button-spinner">
      <Icon name="loader" color={color} strokeWidth={2.5} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
});
