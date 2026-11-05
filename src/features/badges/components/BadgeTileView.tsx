import { View } from 'react-native';

import type { BadgeTile, BadgeTone } from '@/features/badges/model';
import { useTranslation } from '@/i18n';
import { Icon, Text, useTheme, type IconName, type ThemeColors } from '@/ui';

const SIZE = 72;

/** Achievement icons from board 52; anything new falls back to the sparkle. */
const achievementIcons: Record<string, IconName> = {
  'first-reveal': 'sparkle',
  'long-talk': 'chat',
  'pack-finisher': 'packs',
  'hearts-given': 'heart',
  'early-birds': 'sun',
};

/** Ring, fill and ink of an earned badge. Exported for the D41 tone tests. */
export function toneColors(colors: ThemeColors, tone: BadgeTone) {
  switch (tone) {
    case 'you':
      return { fill: colors.youTint, ring: colors.you, ink: colors.youText };
    case 'partner':
      return { fill: colors.partnerTint, ring: colors.partner, ink: colors.partnerText };
    case 'shared':
      // D41 (PO 2026-11-05): shared badges are gold, as on board 52. Badges never carry a
      // "Premium" label; premium elements always do, so gold is never the only signal.
      return { fill: colors.premiumTint, ring: colors.premium, ink: colors.premiumText };
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(iso),
  );
}

/** One badge in the 52 grid: earned (filled ring), next (days to go) or locked (dashed). */
export function BadgeTileView({ tile, current }: { tile: BadgeTile; current: number }) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const earned = tile.state === 'earned';
  const c = earned
    ? toneColors(colors, tile.tone)
    : { fill: 'transparent', ring: colors.doughLine, ink: colors.text2 };
  const left = tile.threshold - current;
  const status = earned
    ? t('badges.earnedOn', { date: formatDate(tile.awardedAt ?? '') })
    : tile.state === 'next'
      ? left === 1
        ? t('badges.toGoOne')
        : t('badges.toGo', { n: left })
      : t('badges.locked');
  const icon: IconName | null =
    tile.kind === 'achievement'
      ? (achievementIcons[tile.slug] ?? 'sparkle')
      : !earned && tile.threshold >= 365
        ? 'lock'
        : null;

  return (
    <View
      accessible
      accessibilityLabel={t('badges.tileA11y', { title: tile.title, status })}
      testID={`52-badge-${tile.slug}-${tile.state}`}
      style={{ alignItems: 'center', gap: space.xs }}
    >
      <View
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          backgroundColor: c.fill,
          borderWidth: earned ? 3 : 2,
          borderStyle: earned ? 'solid' : 'dashed',
          borderColor: c.ring,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon ? (
          <Icon name={icon} color={c.ink} size={28} />
        ) : (
          // Decorative number in a fixed circle; the label carries the meaning.
          <Text
            variant="h2"
            allowFontScaling={false}
            style={{ color: c.ink, fontVariant: ['tabular-nums'] }}
          >
            {tile.threshold}
          </Text>
        )}
      </View>
      <Text variant="label" style={{ textAlign: 'center' }}>
        {tile.title}
      </Text>
      <Text variant="caption" tone="text3" style={{ textAlign: 'center' }}>
        {status}
      </Text>
    </View>
  );
}
