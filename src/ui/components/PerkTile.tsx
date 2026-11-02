import { View } from 'react-native';

import { Icon, type IconName } from '../Icon';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

type Props = {
  icon: IconName;
  title: string;
  description?: string;
  /** Gold treatment: only for premium perks. */
  premium?: boolean;
  testID?: string;
};

/** Paywall / empty-state perk: icon, title, one line of why. */
export function PerkTile({ icon, title, description, premium = false, testID }: Props) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={description ? `${title}. ${description}` : title}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.md,
        borderRadius: radius.input,
        backgroundColor: premium ? colors.premiumTint : colors.surface2,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: premium ? colors.premium : colors.surface,
        }}
      >
        <Icon name={icon} color={premium ? colors.onPremium : colors.youText} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="label">{title}</Text>
        {description ? (
          <Text variant="caption" tone="text2">
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
