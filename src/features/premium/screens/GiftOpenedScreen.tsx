import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatCountdown } from '@/features/daily/today';
import { useTranslation } from '@/i18n';
import { Button, Chip, PerkTile, Skeleton, SkeletonGroup, Text, useTheme } from '@/ui';

import { OfferBuy } from '../components/OfferBuy';
import { useOffer, useOfferCountdown, useOffering } from '../hooks';

/**
 * 15 Gift opened (D28): the couple's intro offer with a **real** countdown to the server's
 * `expires_at` (the same clock on both phones). The trial length and the price come only from
 * the RevenueCat `intro` offering (D31). Once the server says it's over: the usual paywall.
 */
export default function GiftOpenedScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const intro = useOffer('intro');
  const offering = useOffering('intro');
  const usual = useOffering('default');
  const left = useOfferCountdown(intro.offer?.expiresAt ?? null, 'intro');

  const plan = offering.data?.plans.find((p) => p.kind === 'yearly') ?? offering.data?.plans[0];
  const usualYearly = usual.data?.plans.find((p) => p.kind === 'yearly');
  const days = plan?.trial?.days ?? null;
  const time = formatCountdown(left / 1000);

  if (!intro.offer) {
    const deciding = intro.status === 'loading';
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="15-screen">
        {deciding ? (
          <SkeletonGroup testID="15-loading">
            <Skeleton height={200} />
          </SkeletonGroup>
        ) : (
          <View
            testID="15-ended"
            style={{ flex: 1, justifyContent: 'center', gap: space.lg, padding: space.gutter }}
          >
            <Text variant="h2" accessibilityRole="header" style={{ textAlign: 'center' }}>
              {t('offers.opened.ended')}
            </Text>
            <Button
              testID="15-paywall"
              label={t('premium.ctaSubscribe')}
              onPress={() => router.replace('/paywall')}
            />
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="15-screen">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'space-between',
          gap: space.xl,
          padding: space.gutter,
        }}
      >
        <View style={{ gap: space.lg }}>
          <View testID="15-countdown" style={{ alignItems: 'center' }}>
            <Chip
              tone="countdown"
              label={t('offers.opened.countdown', { time })}
              accessibilityLabel={t('offers.endsInLabel', { time })}
            />
          </View>
          <Chip tone="premium" label={t('premium.chip')} />
          <Text variant="h1" accessibilityRole="header">
            {days !== null
              ? t('offers.opened.titleDays', { count: days })
              : t('offers.opened.titleGeneric')}
          </Text>
          <View style={{ gap: space.sm }}>
            <PerkTile premium icon="packs" title={t('offers.opened.perkPacks')} />
            <PerkTile premium icon="today" title={t('offers.opened.perkSaver')} />
            <PerkTile premium icon="history" title={t('offers.opened.perkRecap')} />
            <PerkTile premium icon="heart" title={t('offers.opened.perkTwo')} />
          </View>
        </View>
        <View style={{ gap: space.md }}>
          {plan ? (
            <Text testID="15-price" tone="text2" style={{ textAlign: 'center' }}>
              {usualYearly && usualYearly.price !== plan.price
                ? t('offers.opened.thenWas', { price: plan.price, was: usualYearly.price })
                : t('offers.opened.then', { price: plan.price })}
            </Text>
          ) : offering.isPending && offering.available ? (
            <Skeleton height={20} />
          ) : null}
          <OfferBuy
            testID="15"
            offeringId="intro"
            plan={plan}
            label={
              days !== null ? t('offers.opened.ctaDays', { count: days }) : t('offers.opened.cta')
            }
          />
          <Button
            testID="15-later"
            variant="ghost"
            label={t('offers.opened.later')}
            onPress={() => router.replace('/today')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
