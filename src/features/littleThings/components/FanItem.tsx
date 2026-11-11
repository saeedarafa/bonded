import { Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Icon, Text, useTheme, type IconName } from '@/ui';

import type { LittleThingKind } from '../model';

export const KIND_ICON: Record<LittleThingKind, IconName> = {
  hug: 'ltHug',
  kiss: 'ltKiss',
  goodnight: 'ltGoodnight',
  good_morning: 'ltMorning',
  miss_you: 'ltMissYou',
};

export const ITEM_SIZE = 48;
export const MAIN_SIZE = 60;
export const ITEM_WIDTH = 96;

type Props = {
  kind: LittleThingKind;
  main: boolean;
  grey: boolean;
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** Kiss: "×3" badge. */
  count?: number;
  /** Hug: 0..1 of the hold ring. */
  progress?: number;
  onPress: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  style: { left: number; top: number };
};

/** One gesture in the fan (24c): a round icon with its label below; grey at today's limit. */
export function FanItem({
  kind,
  main,
  grey,
  label,
  accessibilityLabel,
  accessibilityHint,
  count = 0,
  progress = 0,
  onPress,
  onPressIn,
  onPressOut,
  style,
}: Props) {
  const { colors, radius, space } = useTheme();
  const size = main ? MAIN_SIZE : ITEM_SIZE;
  // Rule 1: the sender is the viewer, so the fan is in the viewer's colour (orange).
  const bg = grey ? colors.surface2 : main ? colors.you : colors.surface;
  const border = grey ? colors.line : main ? colors.you : colors.line;
  const iconColor = grey ? colors.text3 : main ? colors.onYou : colors.youText;
  const ring = size + 10;
  const stroke = 4;
  const r = (ring - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <Pressable
      testID={`24c-${kind}`}
      accessibilityRole="menuitem"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      // A hug can be held for 5 s; the finger may drift a little.
      pressRetentionOffset={{ top: 80, bottom: 80, left: 80, right: 80 }}
      style={{
        position: 'absolute',
        left: style.left,
        top: style.top,
        width: ITEM_WIDTH,
        alignItems: 'center',
        gap: space.xs,
      }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={KIND_ICON[kind]} size={main ? 26 : 22} color={iconColor} />
        {progress > 0 ? (
          <View
            testID="24c-hug-ring"
            pointerEvents="none"
            style={{ position: 'absolute', left: -5 - 1, top: -5 - 1 }}
          >
            <Svg width={ring} height={ring}>
              <Circle
                cx={ring / 2}
                cy={ring / 2}
                r={r}
                stroke={main ? colors.youText : colors.you}
                strokeWidth={stroke}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${circumference} ${circumference}`}
                strokeDashoffset={circumference * (1 - Math.min(1, progress))}
                transform={`rotate(-90 ${ring / 2} ${ring / 2})`}
              />
            </Svg>
          </View>
        ) : null}
        {count > 0 ? (
          <View
            testID="24c-kiss-count"
            style={{
              position: 'absolute',
              top: -6,
              right: -8,
              minWidth: 24,
              height: 24,
              borderRadius: 12,
              paddingHorizontal: 6,
              backgroundColor: colors.blush,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              variant="caption"
              style={{ color: colors.onBlush, fontVariant: ['tabular-nums'] }}
            >{`×${count}`}</Text>
          </View>
        ) : null}
      </View>
      <View
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.tile,
          paddingHorizontal: space.sm,
          paddingVertical: 2,
          maxWidth: ITEM_WIDTH + space.xl,
        }}
      >
        <Text
          variant="caption"
          tone={grey ? 'text3' : 'text'}
          style={{ textAlign: 'center', fontVariant: ['tabular-nums'] }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
