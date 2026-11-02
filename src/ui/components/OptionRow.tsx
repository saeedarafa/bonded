import { Pressable, View } from 'react-native';

import { haptics } from '../haptics';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

type Props = {
  label: string;
  description?: string;
  /** Right-aligned value, e.g. a reminder time ("21:00"). Tabular numbers. */
  trailing?: string;
  selected: boolean;
  onPress: () => void;
  /** Radio: one of many (stage, reminder time). Checkbox: any number (goals). */
  kind?: 'radio' | 'checkbox';
  testID?: string;
};

/** Selectable row for quiz answers and settings lists. At least 56 pt tall, wraps at 200% text. */
export function OptionRow({
  label,
  description,
  trailing,
  selected,
  onPress,
  kind = 'radio',
  testID,
}: Props) {
  const { colors, radius, space, size } = useTheme();
  const shape = kind === 'radio' ? 11 : 7;

  return (
    <Pressable
      testID={testID}
      accessibilityRole={kind}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={[label, trailing, description].filter(Boolean).join('. ')}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => [
        {
          minHeight: Math.max(56, size.tapTarget),
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderRadius: radius.input,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? colors.you : colors.line,
          backgroundColor: selected ? colors.youTint : colors.surface,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{
          width: 22,
          height: 22,
          borderRadius: shape,
          borderWidth: 2,
          borderColor: selected ? colors.you : colors.line,
          backgroundColor: selected ? colors.you : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <Icon name="check" size={14} strokeWidth={3} color={colors.onYou} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="label">{label}</Text>
        {description ? (
          <Text variant="caption" tone="text2">
            {description}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <Text
          variant="label"
          tone={selected ? 'text2' : 'text3'}
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {trailing}
        </Text>
      ) : null}
    </Pressable>
  );
}
