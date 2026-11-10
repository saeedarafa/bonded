import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useTranslation } from '@/i18n';

import { emojiName, isHeart } from '../emoji';
import { haptics } from '../haptics';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

/** Module-level so the React compiler lint doesn't treat the shared value as render state. */
function beat(scale: SharedValue<number>, duration: number) {
  scale.value = withSequence(
    withTiming(1.25, { duration: duration / 2 }),
    withTiming(1, { duration: duration / 2 }),
  );
}

type FrameProps = {
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string | undefined;
  testID?: string | undefined;
  children: ReactNode;
};

function PillFrame({
  selected,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
  children,
}: FrameProps) {
  const { colors, radius, space, size } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ selected }}
      onPress={() => {
        haptics.light();
        onPress();
      }}
      style={{
        minHeight: size.tapTarget,
        minWidth: size.tapTarget,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.xs,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        // Selected is never colour alone: a thicker border, and the label says "selected".
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.you : colors.line,
        backgroundColor: selected ? colors.youTint : colors.surface2,
      }}
    >
      {children}
    </Pressable>
  );
}

type Props = {
  /** One system emoji (`reactions.kind`, D45). */
  kind: string;
  /** Reactions with this emoji; 0 hides the number. */
  count?: number;
  /** I reacted with this emoji. */
  selected: boolean;
  onPress: () => void;
  testID?: string | undefined;
};

/**
 * D45 reaction pill: a system emoji and its count. 44 × 44 minimum (DESIGN.md §4). Labels use
 * the emoji's name: "React with face with tears of joy", "Reacted with red heart, selected, 1".
 * Light haptic on tap. ❤️ beats once when it becomes selected (21); reduced motion keeps it still.
 */
export function ReactionPill({ kind, count = 0, selected, onPress, testID }: Props) {
  const { t } = useTranslation();
  const { colors, motion } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const wasSelected = useRef(selected);
  const heart = isHeart(kind);
  useEffect(() => {
    if (selected && !wasSelected.current && heart && !reduced) {
      beat(scale, motion.duration.base);
    }
    wasSelected.current = selected;
  }, [selected, heart, reduced, scale, motion.duration.base]);
  const emojiStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const name = emojiName(kind);
  const base = selected ? t('ui.reaction.reacted', { name }) : t('ui.reaction.react', { name });
  const label = count > 0 ? t('ui.reaction.count', { label: base, n: count }) : base;

  return (
    <PillFrame selected={selected} onPress={onPress} accessibilityLabel={label} testID={testID}>
      <Animated.View style={emojiStyle}>
        <Text variant="h2">{kind}</Text>
      </Animated.View>
      {count > 0 ? (
        <Text
          variant="caption"
          style={{
            color: selected ? colors.youText : colors.text2,
            fontVariant: ['tabular-nums'],
          }}
        >
          {count}
        </Text>
      ) : null}
    </PillFrame>
  );
}

/** The "+" pill at the end of the quick row: opens the full emoji picker (D45). */
export function MoreReactionsPill({
  onPress,
  testID,
}: {
  onPress: () => void;
  testID?: string | undefined;
}) {
  const { t } = useTranslation();
  const { colors, type } = useTheme();
  return (
    <PillFrame
      selected={false}
      onPress={onPress}
      accessibilityLabel={t('ui.reaction.more')}
      accessibilityHint={t('ui.reaction.moreHint')}
      testID={testID}
    >
      <View style={{ minHeight: type.h2.lineHeight, justifyContent: 'center' }}>
        <Icon name="plus" size={18} color={colors.text2} />
      </View>
    </PillFrame>
  );
}
