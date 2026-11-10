import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { useTheme, type Theme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

/** Tile colours from board 32 (tint background, text-strength icon). Never a bright fill. */
export type PackTone = 'you' | 'premium' | 'partner' | 'blush' | 'success';

export function packToneColors(colors: Theme['colors'], tone: PackTone) {
  return {
    you: { bg: colors.youTint, fg: colors.youText },
    premium: { bg: colors.premiumTint, fg: colors.premiumText },
    partner: { bg: colors.partnerTint, fg: colors.partnerText },
    blush: { bg: colors.blushTint, fg: colors.blushText },
    success: { bg: colors.successTint, fg: colors.success },
  }[tone];
}

type Props = {
  title: string;
  /** "12 questions". */
  detail?: string;
  icon?: IconName;
  tone?: PackTone;
  /**
   * Shows the floating lock (board 32) and is spoken with the tile ("Premium"). Omit when the
   * pack is open. The lock is a hint only: the server decides access (`start_pack_question`).
   */
  lockLabel?: string;
  onPress: () => void;
  testID?: string;
};

/** Question pack in the Packs grid (32). Locked packs stay tappable: they open the preview (33). */
export function PackTile({
  title,
  detail,
  icon = 'packs',
  tone = 'you',
  lockLabel,
  onPress,
  testID,
}: Props) {
  const { colors, radius, space } = useTheme();
  const pc = packToneColors(colors, tone);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, detail, lockLabel].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 96,
        gap: space.sm,
        padding: space.sm + 2,
        borderRadius: radius.card - 2,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View
        style={{
          height: 64,
          borderRadius: radius.tile * 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pc.bg,
        }}
      >
        <Icon name={icon} size={28} color={pc.fg} />
      </View>
      {lockLabel ? <FloatingLock testID={testID && `${testID}-lock`} /> : null}
      <View style={{ gap: 2, paddingHorizontal: space.xs }}>
        <Text variant="label" style={{ flexShrink: 1 }}>
          {title}
        </Text>
        {detail ? (
          <Text variant="caption" tone="text3" style={{ fontVariant: ['tabular-nums'] }}>
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** The gold lock badge that bobs on board 32 ("Locks float"); still under reduced motion. */
export function FloatingLock({ testID, size = 26 }: { testID?: string; size?: number }) {
  const { colors, space } = useTheme();
  const reduced = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduced) return undefined;
    const half = { duration: 1600, easing: Easing.inOut(Easing.ease) };
    y.value = withRepeat(withSequence(withTiming(-3, half), withTiming(0, half)), -1);
    return () => cancelAnimation(y);
  }, [reduced, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          position: 'absolute',
          right: space.lg,
          top: space.lg,
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg,
        },
        style,
      ]}
    >
      <Icon name="lock" size={14} strokeWidth={2.5} color={colors.premiumText} />
    </Animated.View>
  );
}
