import { Pressable, useWindowDimensions, View } from 'react-native';

import { haptics, Icon, Text, TITLE_MAX_FONT_SCALE, useTheme, type IconName } from '@/ui';

import type { Goal, Stage } from './store';

export const STAGE_ICONS: Record<Stage, IconName> = {
  dating: 'heart',
  living_together: 'house',
  engaged_married: 'ring',
  long_distance: 'send',
};

export const GOAL_ICONS: Record<Goal, IconName> = {
  deep_talks: 'chat',
  laughing: 'smile',
  romance: 'heart',
  future: 'compass',
  hard_conversations: 'shield',
  learning: 'sparkle',
};

/** Font scale from which the 05 stage tiles go one per row (same threshold as settings rows). */
export const STAGE_STACK_FONT_SCALE = 1.5;

type TileProps = {
  label: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  testID: string;
};

/**
 * 05: one of the 2×2 illustrated stage tiles (board S01). A radio: the check badge and the
 * orange border mark the pick, and the state is announced. Text wraps at 200%.
 */
export function StageTile({ label, icon, selected, onPress, testID }: TileProps) {
  const { colors, radius, space } = useTheme();
  // #367: at large text sizes the tiles stack one per row and the label stops at 200%, so
  // "Long-distance" and "Engaged or married" wrap between words (AX5 split them mid-word).
  const stacked = useWindowDimensions().fontScale >= STAGE_STACK_FONT_SCALE;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => ({
        flexBasis: stacked ? '100%' : '40%',
        flexGrow: 1,
        minHeight: 120,
        justifyContent: 'space-between',
        gap: space.lg,
        padding: space.lg,
        borderRadius: radius.card,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.you : colors.line,
        backgroundColor: selected ? colors.youTint : colors.surface,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{
          width: 48,
          height: 48,
          borderRadius: radius.pill,
          backgroundColor: selected ? colors.you : colors.surface2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={24} color={selected ? colors.onYou : colors.youText} />
      </View>
      {selected ? (
        <View
          testID={`${testID}-check`}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{
            position: 'absolute',
            top: space.sm + 2,
            right: space.sm + 2,
            width: 24,
            height: 24,
            borderRadius: radius.pill,
            backgroundColor: colors.you,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="check" size={14} strokeWidth={3} color={colors.onYou} />
        </View>
      ) : null}
      <Text variant="button" maxFontSizeMultiplier={TITLE_MAX_FONT_SCALE}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 06: a goal chip (checkbox). Any number, including none. */
export function GoalChip({ label, icon, selected, onPress, testID }: TileProps) {
  const { colors, radius, space, size } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: Math.max(48, size.tapTarget),
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingLeft: space.md,
        paddingRight: space.lg,
        paddingVertical: space.sm,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.you : colors.line,
        backgroundColor: selected ? colors.you : colors.surface,
        maxWidth: '100%',
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Icon name={icon} size={18} color={selected ? colors.onYou : colors.youText} />
      <Text variant="label" style={{ flexShrink: 1, color: selected ? colors.onYou : colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

type TimeTileProps = {
  time: string;
  label: string;
  accessibilityLabel: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
};

/** N: one of the three daily-moment tiles (time over its label; board S01). A radio. */
export function TimeTile({
  time,
  label,
  accessibilityLabel,
  selected,
  onPress,
  testID,
}: TimeTileProps) {
  const { colors, radius, space } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => ({
        flexBasis: '28%',
        flexGrow: 1,
        minHeight: 72,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        paddingVertical: space.sm,
        paddingHorizontal: space.xs,
        borderRadius: radius.card - 4,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.you : colors.line,
        backgroundColor: selected ? colors.youTint : colors.surface,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Text variant="h2" style={{ fontVariant: ['tabular-nums'] }}>
        {time}
      </Text>
      <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
        {label}
      </Text>
    </Pressable>
  );
}
