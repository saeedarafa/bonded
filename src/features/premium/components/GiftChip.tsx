import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { Icon, Text, useTheme } from '@/ui';

import { useGiftPromo } from '../hooks';
import { countdownParts } from '../offers';

/**
 * Today's gold gift chip (D52, board S07 "36" now Today with the chip): at the top of Today while
 * the couple's day-3 gift is live. Opened: "25% off · ends in 11:59:42 · Open" (live, every second) -> 15; not opened yet
 * (a partner may open it first): "You earned a gift · Open" -> 14. It disappears the moment the
 * server's clock runs out; nothing replaces it. Opened by a tap only, so it never claims the day's
 * full-screen offer.
 */
export function GiftChip({ enabled = true }: { enabled?: boolean }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, size, space } = useTheme();
  const promo = useGiftPromo({ enabled });
  if (!promo) return null;

  const label = promo.opened
    ? t('offers.chip.live', { percent: promo.percent, time: promo.time })
    : t('offers.chip.unopened');
  const a11y = promo.opened
    ? t('offers.chip.liveA11y', { percent: promo.percent, ...countdownParts(promo.left) })
    : t('offers.chip.unopenedA11y');

  return (
    <Pressable
      testID="today-gift-chip"
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => router.push(promo.href)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm + 2,
        minHeight: size.tapTarget + space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        marginBottom: space.lg,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: colors.premium,
        backgroundColor: colors.premiumTint,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.pill,
          backgroundColor: colors.premium,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="gift" color={colors.onPremium} size={18} />
      </View>
      <Text
        testID="today-gift-chip-label"
        variant="label"
        style={{ flex: 1, fontVariant: ['tabular-nums'] }}
      >
        {label}
      </Text>
      <Text variant="label" tone="premiumText">
        {t('offers.chip.open')}
      </Text>
    </Pressable>
  );
}
