import { Pressable, View } from 'react-native';

import { Chip } from './Chip';
import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

type Props = {
  title: string;
  /** "12 questions". */
  detail?: string;
  /** Shows the gold chip, e.g. "Premium". Omit for free packs. */
  premiumLabel?: string;
  onPress: () => void;
  testID?: string;
};

/** Question pack in the Packs grid. Locked packs stay tappable (they open the paywall). */
export function PackTile({ title, detail, premiumLabel, onPress, testID }: Props) {
  const { colors, radius, space } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, detail, premiumLabel].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 96,
        gap: space.sm,
        padding: space.lg,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: premiumLabel ? colors.premium : colors.line,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      {premiumLabel ? <Chip label={premiumLabel} tone="premium" /> : null}
      <View style={{ gap: 2 }}>
        <Text variant="h2">{title}</Text>
        {detail ? (
          <Text variant="caption" tone="text2">
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
