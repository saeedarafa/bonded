import { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { Icon, Text, Toggle, useTheme } from '@/ui';

/**
 * Grouped settings list from board S09 (40, 41, 42): rounded surface card, hairline between rows,
 * rows at least 50 pt tall. At large text (≥150%) a row's value moves under its label so neither
 * is cut off.
 */
export function SettingsGroup({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors, radius } = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View
      testID={testID}
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card - 2,
        overflow: 'hidden',
      }}
    >
      {rows.map((row, i) => (
        <View
          key={row.key ?? i}
          style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.line } : undefined}
        >
          {row}
        </View>
      ))}
    </View>
  );
}

const ROW_MIN_HEIGHT = 50;

type RowProps = {
  label: string;
  /** Right-hand value ("21:00", "Long-distance"). */
  value?: string | null;
  /** Value colour: premium gold text for the plan, default muted. */
  valueTone?: 'text3' | 'premiumText';
  /** Chevron for rows that open another screen or sheet. */
  chevron?: boolean;
  /** Blush label (Delete account). */
  destructive?: boolean;
  /** Omit for a read-only row (no button role). */
  onPress?: () => void;
  accessibilityHint?: string;
  testID?: string;
};

export function SettingsRow({
  label,
  value,
  valueTone = 'text3',
  chevron = false,
  destructive = false,
  onPress,
  accessibilityHint,
  testID,
}: RowProps) {
  const { colors, space } = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.5;
  return (
    <Pressable
      testID={testID}
      accessible
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={accessibilityHint}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: ROW_MIN_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        backgroundColor: pressed && onPress ? colors.surface2 : 'transparent',
      })}
    >
      <View
        style={{
          flex: 1,
          flexDirection: stacked ? 'column' : 'row',
          alignItems: stacked ? 'flex-start' : 'center',
          justifyContent: 'space-between',
          gap: stacked ? 2 : space.md,
        }}
      >
        <Text variant="body" tone={destructive ? 'blushText' : 'text'} style={{ flexShrink: 1 }}>
          {label}
        </Text>
        {value ? (
          <Text
            variant="caption"
            tone={valueTone}
            style={{ fontVariant: ['tabular-nums'], textAlign: stacked ? 'left' : 'right' }}
          >
            {value}
          </Text>
        ) : null}
      </View>
      {chevron ? <Icon name="chevron" size={16} color={colors.text3} /> : null}
    </Pressable>
  );
}

type ToggleRowProps = {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  testID?: string;
};

/** Label + one-line description + switch (41). The switch's name carries both. */
export function SettingsToggleRow({
  label,
  description,
  value,
  onValueChange,
  testID,
}: ToggleRowProps) {
  const { space } = useTheme();
  return (
    <View
      style={{
        minHeight: ROW_MIN_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      }}
    >
      <View style={{ flex: 1, gap: 2 }} importantForAccessibility="no-hide-descendants">
        <Text variant="body" accessibilityElementsHidden>
          {label}
        </Text>
        <Text
          variant="caption"
          tone="text3"
          accessibilityElementsHidden
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {description}
        </Text>
      </View>
      <Toggle
        testID={testID}
        label={`${label}. ${description}`}
        value={value}
        onValueChange={onValueChange}
      />
    </View>
  );
}
