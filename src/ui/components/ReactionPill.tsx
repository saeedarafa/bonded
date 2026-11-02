import { useEffect, useRef } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import type { Database } from '@/types/database';

import { haptics } from '../haptics';
import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';

/** D14: `reactions.kind` (CONTRACTS §2, BE-05). Board order: Love, Laugh, Spark, Wow. */
export type ReactionKind = Database['public']['Enums']['reaction_kind'];
export const reactionKinds: readonly ReactionKind[] = ['love', 'laugh', 'spark', 'wow'];

const icons: Record<ReactionKind, IconName> = {
  love: 'heart',
  laugh: 'smile',
  spark: 'sparkle',
  wow: 'wow',
};

/** Module-level so the React compiler lint doesn't treat the shared value as render state. */
function beat(scale: SharedValue<number>, duration: number) {
  scale.value = withSequence(
    withTiming(1.25, { duration: duration / 2 }),
    withTiming(1, { duration: duration / 2 }),
  );
}

type Props = {
  kind: ReactionKind;
  /** Total reactions of this kind; omit or 0 to hide the number. */
  count?: number;
  /** I reacted with this kind. */
  selected: boolean;
  onPress: () => void;
  testID?: string;
};

/**
 * 44 × 44 minimum (DESIGN.md §4). Label: "Love, selected". Light haptic on tap. The heart beats
 * once when it becomes selected (21); reduced motion keeps it still.
 */
export function ReactionPill({ kind, count = 0, selected, onPress, testID }: Props) {
  const { t } = useTranslation();
  const { colors, motion, radius, space, size } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const wasSelected = useRef(selected);
  useEffect(() => {
    if (selected && !wasSelected.current && kind === 'love' && !reduced) {
      beat(scale, motion.duration.base);
    }
    wasSelected.current = selected;
  }, [selected, kind, reduced, scale, motion.duration.base]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const name = t(`ui.reaction.${kind}`);
  const withCount = count > 0 ? t('ui.reaction.count', { name, n: count }) : name;
  const label = selected ? t('ui.reaction.selected', { name: withCount }) : withCount;
  const fg = selected ? colors.youText : colors.text2;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
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
        borderWidth: 1,
        borderColor: selected ? colors.you : colors.line,
        backgroundColor: selected ? colors.youTint : colors.surface2,
      }}
    >
      <Animated.View style={iconStyle}>
        <Icon name={icons[kind]} size={16} color={fg} filled={selected && kind === 'love'} />
      </Animated.View>
      {count > 0 ? (
        <Text variant="caption" style={{ color: fg, fontVariant: ['tabular-nums'] }}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}
