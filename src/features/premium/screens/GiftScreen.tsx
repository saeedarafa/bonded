import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import {
  Banner,
  Button,
  haptics,
  Icon,
  Mascot,
  Skeleton,
  SkeletonGroup,
  Text,
  useTheme,
} from '@/ui';

import { useDay3Offer, useOpenOffer } from '../hooks';

/**
 * 14 "3 days in a row! You earned a gift." (D52, board S03): replaces badge sheet 52b for the
 * couple's first 3-day streak badge while the server's `day3` gift is live. Both partners see it.
 * "Open the gift" calls `open_offer('day3')` (the first open by either partner starts the shared
 * 12-hour clock), then 15. Leaving here starts nothing; the gift then waits on Today's chip.
 */
export default function GiftScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const { partner } = useCoupleProfiles();
  const gift = useDay3Offer();
  const open = useOpenOffer();
  const live = gift.offer !== null;

  useEffect(() => {
    if (live) haptics.heavy();
  }, [live]);

  // Not (or no longer) live: nothing to open here.
  if (gift.status === 'none') return <Redirect href="/today" />;

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/today'));
  const partnerName = partner?.display_name.trim() || t('pairing.partnerFallback');
  const onOpen = () => {
    if (open.isPending) return;
    open.mutate(undefined, {
      onSuccess: (offer) =>
        router.replace(offer.eligible && offer.opened ? '/gift/opened' : '/today'),
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="14-screen">
      {!live ? (
        <SkeletonGroup testID="14-loading">
          <Skeleton height={200} />
          <Skeleton height={56} />
        </SkeletonGroup>
      ) : (
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'space-between',
            gap: space.xl,
            padding: space.gutter,
            paddingTop: space.hero,
          }}
        >
          <View style={{ alignItems: 'center', gap: space.lg }}>
            <View style={{ marginBottom: space.md }}>
              <View
                style={{
                  width: 104,
                  height: 104,
                  borderRadius: radius.card + space.sm,
                  borderWidth: 2,
                  borderColor: colors.premium,
                  backgroundColor: colors.premiumTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="gift" color={colors.premiumText} size={56} strokeWidth={1.6} />
              </View>
              <View
                testID="14-badge"
                accessible
                accessibilityLabel={t('offers.gift.badgeA11y')}
                style={{
                  position: 'absolute',
                  right: -18,
                  bottom: -14,
                  minWidth: 54,
                  minHeight: 54,
                  padding: space.xs,
                  borderRadius: radius.pill,
                  borderWidth: 3,
                  borderColor: colors.premium,
                  backgroundColor: colors.premiumTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="number" style={{ color: colors.premiumText }}>
                  3
                </Text>
                <Text variant="caption" style={{ color: colors.premiumText }}>
                  {t('offers.gift.badgeDays')}
                </Text>
              </View>
            </View>
            <Mascot mood="celebrating" size={140} accessibilityLabel={t('offers.gift.mascot')} />
            <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
              {t('offers.gift.title')}
            </Text>
            <Text tone="text2" style={{ textAlign: 'center' }}>
              {t('offers.gift.body')}
            </Text>
          </View>
          <View style={{ gap: space.md }}>
            {open.isError ? (
              <Banner tone="error" testID="14-error" message={t('offers.gift.openError')} />
            ) : null}
            <Button
              testID="14-open"
              variant="premium"
              label={t('offers.gift.open')}
              loading={open.isPending}
              onPress={onOpen}
            />
            <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
              {t('offers.gift.note', { partner: partnerName })}
            </Text>
            <Button
              testID="14-later"
              variant="link"
              label={t('offers.gift.later')}
              onPress={leave}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
