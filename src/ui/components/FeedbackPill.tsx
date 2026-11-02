import { Pressable, View } from 'react-native';

import { haptics } from '../haptics';
import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

type Props = {
  label: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  testID?: string;
};

/** Multi-select tag for private feedback (screen 27). Selected inverts: dark pill, orange icon. */
export function FeedbackPill({ label, icon, selected, onPress, testID }: Props) {
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
      style={{
        minHeight: size.tapTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: space.xs,
        paddingLeft: space.sm + 1,
        paddingRight: space.md + 2,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.text : colors.line,
        backgroundColor: selected ? colors.text : colors.surface,
        alignSelf: 'flex-start',
      }}
    >
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? colors.you : colors.surface2,
        }}
      >
        <Icon
          name={selected ? 'check' : icon}
          size={14}
          strokeWidth={selected ? 2.8 : 2.2}
          color={selected ? colors.onYou : colors.text2}
        />
      </View>
      <Text
        variant="label"
        style={{ color: selected ? colors.surface : colors.text, flexShrink: 1 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
