import { Pressable, View } from 'react-native';

import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

export type TabItem = {
  key: string;
  label: string;
  icon: IconName;
  focused: boolean;
  onPress: () => void;
  testID?: string;
};

type Props = {
  items: readonly TabItem[];
  /** Bottom safe-area inset, added to the 80 pt bar. */
  bottomInset?: number;
};

/**
 * Presentational tab bar (Today, History, Packs, Us): 80 pt plus the safe area, active tab in
 * `youText`. app/(tabs)/_layout.tsx adapts expo-router's tab state to `items`.
 */
export function TabBar({ items, bottomInset = 0 }: Props) {
  const { colors, size, space } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        minHeight: size.tabBar + bottomInset,
        paddingBottom: bottomInset,
        flexDirection: 'row',
        backgroundColor: colors.tabBar,
        borderTopWidth: 1,
        borderTopColor: colors.line,
      }}
    >
      {items.map((item) => {
        const tone = item.focused ? colors.youText : colors.text3;
        return (
          <Pressable
            key={item.key}
            testID={item.testID}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: item.focused }}
            onPress={item.onPress}
            style={{
              flex: 1,
              minHeight: size.tapTarget,
              alignItems: 'center',
              justifyContent: 'center',
              gap: space.xs,
              paddingVertical: space.sm,
            }}
          >
            <Icon name={item.icon} size={22} color={tone} />
            {/* #37: past 200% the short labels broke mid-word ("Toda/y"); the icon still grows. */}
            <Text
              variant="caption"
              maxFontSizeMultiplier={2}
              style={{ color: tone, textAlign: 'center' }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
