import { Redirect, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatCountdown } from '@/features/daily/today';
import { useTranslation } from '@/i18n';
import { Button, Chip, Icon, Mascot, Skeleton, SkeletonGroup, Text, useTheme } from '@/ui';

import { OfferBuy } from '../components/OfferBuy';
import { useDay3Offer, useOfferCountdown, useOffering } from '../hooks';
import { countdownParts, DAY3_PERCENT, introPercent } from '../offers';
import { introPerPersonMonthly } from '../pricing';

const PERKS = [
  'perkPacks',
  'perkVoice',
  'perkLonger',
  'perkLittleThings',
  'perkSaver',
  'perkRecap',
] as const;

/**
 * 15 Gift opened (D52, board S03): a coupon, "25% off Premium, for you both", with the **real**
 * 12-hour countdown from the server's `expires_at` (the same clock on both phones, never extended).
 * Every price and the percentage come from the RevenueCat `day3` offering (first-year intro price on
 * yearly); nothing is hard-coded. "Claim 25% off" buys it; "Not now" just closes (no 17 after the
 * gift); the offer then waits on Today's chip until it ends. Ended: says so, no "last chance".
 */
export default function GiftOpenedScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const gift = useDay3Offer();
  const offering = useOffering('day3');
  const left = useOfferCountdown(gift.offer);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/today'));
  const plan = offering.data?.plans.find((p) => p.kind === 'yearly') ?? offering.data?.plans[0];
  const percent = introPercent(plan) ?? DAY3_PERCENT;
  const perPerson = introPerPersonMonthly(plan);
  const time = formatCountdown(left / 1000);
  const live = gift.offer !== null && gift.offer.opened && left > 0;

  // A live gift nobody opened yet: 14 opens it (and starts the clock).
  if (gift.offer && !gift.offer.opened) return <Redirect href="/gift" />;

  if (!live) {
    const deciding = gift.status === 'loading';
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
              testID="15-back"
              variant="ghost"
              label={t('offers.opened.back')}
              onPress={() => router.replace('/today')}
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
        <View style={{ gap: space.xl, flexGrow: 1, justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', gap: space.md }}>
            <Mascot mood="celebrating" size={116} accessibilityLabel={t('offers.opened.mascot')} />
            <Chip
              testID="15-countdown"
              tone="countdown"
              label={t('offers.opened.countdown', { time })}
              leading={<Icon name="clock" color={colors.blushText} size={16} />}
              accessibilityLabel={t('offers.opened.countdownA11y', countdownParts(left))}
            />
            <Text
              testID="15-title"
              variant="h1"
              accessibilityRole="header"
              style={{ textAlign: 'center' }}
            >
              {t('offers.opened.title', { percent })}
            </Text>
          </View>
          <View
            testID="15-coupon"
            style={{
              borderRadius: radius.card,
              borderWidth: 2,
              borderStyle: 'dashed',
              borderColor: colors.premium,
              backgroundColor: colors.premiumTint,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: space.md,
                padding: space.lg,
              }}
            >
              <View style={{ flex: 1, gap: space.xs / 2 }}>
                <Text variant="label" style={{ color: colors.premiumText }}>
                  {t('offers.opened.plan')}
                </Text>
                {plan?.introOffer ? (
                  <View
                    accessible
                    testID="15-price"
                    accessibilityLabel={t('offers.opened.priceA11y', {
                      offer: plan.introOffer.price,
                      was: plan.price,
                    })}
                    style={{ gap: space.xs / 2 }}
                  >
                    <Text variant="display" style={{ fontVariant: ['tabular-nums'] }}>
                      {plan.introOffer.price}
                    </Text>
                    <Text variant="caption" tone="text2">
                      <Text
                        variant="caption"
                        tone="text2"
                        testID="15-was"
                        style={{ textDecorationLine: 'line-through' }}
                      >
                        {plan.price}
                      </Text>
                      {` · ${t('offers.opened.firstYear')}`}
                      {perPerson ? ` · ${t('offers.opened.perPerson', { price: perPerson })}` : ''}
                    </Text>
                  </View>
                ) : offering.isPending && offering.available ? (
                  <Skeleton height={32} width="60%" />
                ) : null}
              </View>
              <View
                accessible
                accessibilityLabel={t('offers.opened.percentA11y', { percent })}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: radius.pill,
                  backgroundColor: colors.premium,
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: [{ rotate: '-8deg' }],
                }}
              >
                <Text
                  variant="h2"
                  style={{ color: colors.onPremium, fontVariant: ['tabular-nums'] }}
                >
                  {`${percent}%`}
                </Text>
                <Text variant="caption" style={{ color: colors.onPremium }}>
                  {t('offers.opened.percentOff')}
                </Text>
              </View>
            </View>
            <View
              style={{
                borderTopWidth: 2,
                borderStyle: 'dashed',
                borderColor: colors.premium,
                marginHorizontal: space.lg,
              }}
            />
            <View
              testID="15-perks"
              accessibilityLabel={t('offers.opened.perksLabel')}
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                rowGap: space.sm,
                padding: space.lg,
              }}
            >
              {PERKS.map((key) => (
                <View
                  key={key}
                  style={{
                    flexBasis: '50%',
                    flexGrow: 1,
                    minWidth: 140,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm,
                  }}
                >
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: radius.pill,
                      backgroundColor: colors.premium,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="check" color={colors.onPremium} size={12} strokeWidth={3.2} />
                  </View>
                  <Text variant="caption" style={{ flexShrink: 1 }}>
                    {t(`offers.opened.${key}`)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
        <View style={{ gap: space.sm }}>
          <OfferBuy
            testID="15"
            offeringId="day3"
            // Only a plan the store gives the intro price on: never the full price under "25% off".
            plan={plan?.introOffer ? plan : undefined}
            pending={offering.available && offering.isPending}
            label={t('offers.opened.cta', { percent })}
          />
          <Button
            testID="15-later"
            variant="link"
            label={t('offers.opened.later')}
            onPress={leave}
          />
          <Text variant="caption" tone="text2" style={{ textAlign: 'center' }}>
            {t('offers.opened.waits')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
