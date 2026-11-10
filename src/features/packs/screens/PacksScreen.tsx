import { useRouter } from 'expo-router';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActiveCouple } from '@/features/couple/hooks';
import { DailyError } from '@/features/daily/components/DailyFrame';
import { usePremium } from '@/features/premium/hooks';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import {
  Chip,
  Icon,
  Mascot,
  OfflineBanner,
  PackTile,
  packToneColors,
  Skeleton,
  SkeletonGroup,
  Text,
  useTheme,
} from '@/ui';

import type { PackSummary } from '../api';
import { usePacks } from '../hooks';
import { packVisual } from '../model';

/**
 * 32 Packs library (Packs tab). A free pack (if the content has one) is featured on top, then the
 * grid. Locks come from the **server's** premium state (`usePremium()`): until it has answered,
 * premium packs stay locked. Every tile opens the preview (33); 33 asks the server to open a
 * question, so a stale lock never grants anything.
 */
export default function PacksScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { fontScale } = useWindowDimensions();
  const packs = usePacks();
  const premium = usePremium();
  const couple = useActiveCouple();
  const profiles = useCoupleProfiles();
  const partner =
    profiles.partner?.display_name?.trim() ||
    couple.data?.partner_name?.trim() ||
    t('pairing.partnerFallback');
  const isPremium = premium.status === 'ready' && premium.isPremium;
  const open = (p: PackSummary) =>
    router.push({ pathname: '/packs/[packId]', params: { packId: p.id } });
  const count = (n: number) => t('packs.count', { count: n });

  let body;
  if (packs.error && !packs.data) {
    body = (
      <DailyError
        testID="32-error"
        error={packs.error}
        fallback={t('packs.loadError')}
        onRetry={() => void packs.refetch()}
      />
    );
  } else if (!packs.data) {
    body = (
      <SkeletonGroup testID="32-loading">
        <Skeleton height={88} />
        <Skeleton height={40} />
        <View style={{ flexDirection: 'row', gap: space.md - 2 }}>
          <View style={{ flex: 1 }}>
            <Skeleton height={140} />
          </View>
          <View style={{ flex: 1 }}>
            <Skeleton height={140} />
          </View>
        </View>
      </SkeletonGroup>
    );
  } else if (packs.data.length === 0) {
    body = (
      <View
        testID="32-empty"
        style={{ alignItems: 'center', gap: space.lg, paddingVertical: space.xxl }}
      >
        <Mascot mood="napping" size={150} accessibilityLabel={t('packs.empty.mascot')} />
        <Text variant="h2" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('packs.empty.title')}
        </Text>
        <Text tone="text2" style={{ textAlign: 'center' }}>
          {t('packs.empty.body')}
        </Text>
      </View>
    );
  } else {
    const featured = packs.data.find((p) => !p.isPremium) ?? null;
    const grid = packs.data.filter((p) => p !== featured);
    // 200% text: one column so titles keep room to wrap.
    const columns = fontScale >= 1.5 ? 1 : 2;
    const rows: PackSummary[][] = [];
    for (let i = 0; i < grid.length; i += columns) rows.push(grid.slice(i, i + columns));
    const intro = isPremium
      ? premium.viaPartner
        ? t('packs.introPartner', { partner })
        : t('packs.introPremium')
      : t('packs.intro');
    body = (
      <View style={{ gap: space.md }}>
        {featured ? (
          <FeaturedPack
            pack={featured}
            label={t('packs.free')}
            detail={count(featured.questionCount)}
            accessibilityLabel={t('packs.featuredA11y', {
              title: featured.title,
              count: count(featured.questionCount),
            })}
            onPress={() => open(featured)}
          />
        ) : null}
        <Text variant="caption" tone="text3" testID="32-intro">
          {intro}
        </Text>
        <View style={{ gap: space.md - 2 }} testID="32-grid">
          {rows.map((row) => (
            <View key={row[0]?.id} style={{ flexDirection: 'row', gap: space.md - 2 }}>
              {row.map((p) => {
                const v = packVisual(p.icon);
                return (
                  <PackTile
                    key={p.id}
                    testID={`32-pack-${p.slug}`}
                    title={p.title}
                    detail={count(p.questionCount)}
                    icon={v.icon}
                    tone={v.tone}
                    lockLabel={p.isPremium && !isPremium ? t('packs.locked') : undefined}
                    onPress={() => open(p)}
                  />
                );
              })}
              {row.length < columns ? <View style={{ flex: 1 }} /> : null}
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.bg }}
      testID="32-screen"
    >
      <OfflineBanner />
      <View style={{ paddingHorizontal: space.gutter, paddingVertical: space.md }}>
        <Text variant="h1" accessibilityRole="header">
          {t('packs.title')}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: space.xl,
          gap: space.md,
        }}
      >
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

function FeaturedPack({
  pack,
  label,
  detail,
  accessibilityLabel,
  onPress,
}: {
  pack: PackSummary;
  label: string;
  detail: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const v = packVisual(pack.icon);
  const tile = packToneColors(colors, v.tone);
  return (
    <Pressable
      testID="32-featured"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.youTint,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.tile * 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surface,
        }}
      >
        <Icon name={v.icon} size={28} color={tile.fg} />
      </View>
      <View style={{ flex: 1, gap: 2, alignItems: 'flex-start' }}>
        <Chip label={label} tone="you" />
        <Text variant="label">{pack.title}</Text>
        <Text variant="caption" tone="text2" style={{ fontVariant: ['tabular-nums'] }}>
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}
