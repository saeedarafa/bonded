import { Pressable, View } from 'react-native';

import { haptics } from '../haptics';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

type Props = {
  /** "Yearly", "Monthly" (from t()). */
  title: string;
  /** The localized price string from the RevenueCat offering. Never hard-coded (CONTRACTS §6). */
  price: string;
  /** "[PRICE]/mo, billed yearly", "Flexible, cancel anytime" (prices from the offering too). */
  detail?: string;
  /** "7 days free", "No trial". */
  caption?: string;
  /** "Best value" ribbon. */
  badge?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
};

/** Paywall plan tile. Gold is allowed here: it is a premium surface. */
export function PlanCard({
  title,
  price,
  detail,
  caption,
  badge,
  selected,
  onPress,
  testID,
}: Props) {
  const { colors, radius, space, size } = useTheme();
  const label = [badge, title, price, detail, caption].filter(Boolean).join(', ');
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
      style={{
        flex: 1,
        minHeight: size.tapTarget,
        gap: 2,
        paddingTop: space.lg,
        paddingHorizontal: space.md,
        paddingBottom: space.md,
        borderRadius: radius.input + 2,
        borderWidth: selected ? 2 : 1.5,
        borderColor: selected ? colors.premium : colors.line,
        backgroundColor: selected ? colors.premiumTint : colors.surface,
      }}
    >
      {badge ? (
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{
            position: 'absolute',
            top: -10,
            left: space.md,
            paddingHorizontal: space.sm,
            height: 20,
            borderRadius: 10,
            justifyContent: 'center',
            backgroundColor: colors.premium,
          }}
        >
          <Text variant="caption" style={{ color: colors.onPremium, textTransform: 'uppercase' }}>
            {badge}
          </Text>
        </View>
      ) : null}
      <Text variant="caption" tone="text2">
        {title}
      </Text>
      <Text variant="h2">{price}</Text>
      {detail ? (
        <Text variant="caption" tone="text2">
          {detail}
        </Text>
      ) : null}
      {caption ? (
        <Text variant="caption" tone={selected ? 'premiumText' : 'text3'}>
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}
