import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '../Text';
import { useTheme } from '../ThemeProvider';

export type ChipTone = 'neutral' | 'streak' | 'countdown' | 'premium' | 'partner' | 'status';

type Props = {
  label: string;
  tone?: ChipTone;
  /** Leading visual (mascot, icon). Decorative: the label carries the meaning. */
  leading?: ReactNode;
  /** Spoken instead of the label ("11-day streak" for a chip that shows "11"). */
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * Chips grow with the text (wrap, never truncate). Streak and countdown use tabular numerals.
 * Premium gold only on premium chips.
 */
export function Chip({ label, tone = 'neutral', leading, accessibilityLabel, testID }: Props) {
  const { colors, radius, space } = useTheme();
  const palette = {
    neutral: { bg: colors.surface2, fg: colors.text },
    streak: { bg: colors.youTint, fg: colors.youText },
    countdown: { bg: colors.blushTint, fg: colors.blushText },
    premium: { bg: colors.premium, fg: colors.onPremium },
    partner: { bg: colors.partnerTint, fg: colors.partnerText },
    status: { bg: colors.premiumTint, fg: colors.premiumText },
  }[tone];
  const numeric = tone === 'streak' || tone === 'countdown';

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.base,
        {
          backgroundColor: palette.bg,
          borderRadius: radius.chip,
          paddingHorizontal: space.md,
          paddingVertical: space.xs,
          gap: space.xs + 2,
        },
      ]}
    >
      {leading}
      <Text
        variant={tone === 'streak' ? 'button' : 'caption'}
        style={[{ color: palette.fg, flexShrink: 1 }, numeric && { fontVariant: ['tabular-nums'] }]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 30 },
});
