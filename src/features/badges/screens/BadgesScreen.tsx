import { useRouter } from 'expo-router';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth/session';
import { BadgeTileView } from '@/features/badges/components/BadgeTileView';
import { useBadgeAwards, useBadgeCatalogue } from '@/features/badges/hooks';
import { badgeTiles, earnedStreakSteps } from '@/features/badges/model';
import { useActiveCouple } from '@/features/couple/hooks';
import { useStreak } from '@/features/daily/hooks';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import {
  BadgeLadder,
  Banner,
  Button,
  Chip,
  nextBadgeStep,
  OfflineBanner,
  Skeleton,
  SkeletonGroup,
  Text,
  TopBar,
  useTheme,
} from '@/ui';

/**
 * 52 Badges (Us tab). The streak ladder from the couple's awards, then a grid: earned badges
 * (newest first), then the streak badges still ahead. Colours: yours orange, your partner's sky,
 * shared (streaks included) blush (D41; gold stays premium-only).
 */
export default function BadgesScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const { fontScale } = useWindowDimensions();
  const { userId } = useSession();
  const couple = useActiveCouple();
  const hasCouple = !!couple.data;
  const catalogue = useBadgeCatalogue();
  const awards = useBadgeAwards();
  const streak = useStreak({ enabled: hasCouple });
  const profiles = useCoupleProfiles();
  const partner =
    profiles.partner?.display_name?.trim() ||
    couple.data?.partner_name?.trim() ||
    t('pairing.partnerFallback');
  const back = () => (router.canGoBack() ? router.back() : router.replace('/us'));

  const error = catalogue.error ?? awards.error ?? streak.error;
  const current = streak.data?.current ?? 0;
  let body;
  let count = null;
  if (catalogue.data && awards.data && (streak.data || !hasCouple)) {
    const tiles = badgeTiles({ catalogue: catalogue.data, awards: awards.data, current, userId });
    const earned = earnedStreakSteps(awards.data, catalogue.data);
    const next = nextBadgeStep(current, undefined, earned);
    const earnedCount = tiles.filter((x) => x.state === 'earned').length;
    count = { earned: earnedCount, total: tiles.length };
    // 200% text: two columns so titles keep room to wrap.
    const columns = fontScale >= 1.5 ? 2 : 3;
    body = (
      <View style={{ gap: space.xl }}>
        <View
          style={{
            gap: space.md,
            padding: space.lg,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surface,
          }}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <Text variant="label">{t('badges.streak')}</Text>
            <Text
              variant="caption"
              tone="text3"
              style={{ fontVariant: ['tabular-nums'] }}
              testID="52-next"
            >
              {next !== undefined
                ? t('badges.next', { days: next, left: next - current })
                : t('badges.all')}
            </Text>
          </View>
          <BadgeLadder current={current} earned={earned} testID="52-ladder" />
        </View>
        <View testID="52-grid" style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.xl }}>
          {tiles.map((tile) => (
            <View
              key={tile.slug}
              style={{ width: `${100 / columns}%`, paddingHorizontal: space.xs }}
            >
              <BadgeTileView tile={tile} current={current} />
            </View>
          ))}
        </View>
        <Text variant="caption" tone="text3" style={{ textAlign: 'center' }}>
          {t('badges.legend', { partner })}
        </Text>
      </View>
    );
  } else if (error) {
    body = (
      <View style={{ gap: space.lg }} testID="52-error">
        <Banner tone="error" message={error.message || t('badges.loadError')} />
        <Button
          label={t('ui.retry')}
          onPress={() => {
            void catalogue.refetch();
            void awards.refetch();
            void streak.refetch();
          }}
        />
      </View>
    );
  } else {
    body = (
      <SkeletonGroup testID="52-loading">
        <Skeleton height={120} />
        <Skeleton height={240} />
      </SkeletonGroup>
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.bg }}
      testID="52-screen"
    >
      <OfflineBanner />
      <TopBar
        testID="52-top"
        title={t('badges.title')}
        onBack={back}
        right={
          count ? (
            <Chip
              testID="52-count"
              label={t('badges.count', count)}
              accessibilityLabel={t('badges.countA11y', count)}
            />
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={{ padding: space.gutter, paddingTop: space.sm }}>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}
