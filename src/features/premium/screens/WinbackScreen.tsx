import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatCountdown } from '@/features/daily/today';
import { useTranslation } from '@/i18n';
import { Button, Chip, Icon, Skeleton, SkeletonGroup, Text, useTheme } from '@/ui';

import { OfferBuy } from '../components/OfferBuy';
import { useOffer, useOfferCountdown, useOffering } from '../hooks';
import { useOfferShown } from '../offers';

/**
 * 36 Win-back offer (D28): day 3, shown once, while the server's `winback` clock runs. Both prices
 * come from RevenueCat (`winback` vs `default` yearly); no discount is computed or hard-coded.
 */
export default function WinbackScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const winback = useOffer('winback');
  const offering = useOffering('winback');
  const usual = useOffering('default');
  const left = useOfferCountdown(winback.offer?.expiresAt ?? null, 'winback');
  const markShown = useOfferShown((s) => s.markShown);
  const live = winback.offer !== null;

  useEffect(() => {
    if (live && winback.coupleId) markShown(winback.coupleId, 'winback');
  }, [live, winback.coupleId, markShown]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/today'));
  const plan = offering.data?.plans.find((p) => p.kind === 'yearly') ?? offering.data?.plans[0];
  const usualYearly = usual.data?.plans.find((p) => p.kind === 'yearly');
  const time = formatCountdown(left / 1000);

  if (!live) {
    const deciding = winback.status === 'loading';
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="36-screen">
        {deciding ? (
          <SkeletonGroup testID="36-loading">
            <Skeleton height={200} />
          </SkeletonGroup>
        ) : (
          <View
            testID="36-ended"
            style={{ flex: 1, justifyContent: 'center', gap: space.lg, padding: space.gutter }}
          >
            <Text variant="h2" accessibilityRole="header" style={{ textAlign: 'center' }}>
              {t('offers.opened.ended')}
            </Text>
            <Button
              testID="36-paywall"
              label={t('premium.ctaSubscribe')}
              onPress={() => router.replace('/paywall')}
            />
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="36-screen">
      <View
        style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.lg }}
      >
        <Pressable
          testID="36-close"
          accessibilityRole="button"
          accessibilityLabel={t('premium.close')}
          hitSlop={12}
          onPress={leave}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="close" color={colors.text2} />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'space-between',
          gap: space.xl,
          paddingHorizontal: space.gutter,
          paddingBottom: space.xl,
        }}
      >
        <View style={{ alignItems: 'center', gap: space.lg }}>
          <View testID="36-countdown">
            <Chip
              tone="countdown"
              label={t('offers.endsIn', { time })}
              accessibilityLabel={t('offers.endsInLabel', { time })}
            />
          </View>
          <Chip tone="premium" label={t('premium.chip')} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('offers.winback.title')}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('offers.winback.body')}
          </Text>
          <View
            testID="36-price"
            style={{
              alignSelf: 'stretch',
              alignItems: 'center',
              gap: space.xs,
              padding: space.lg,
              borderRadius: radius.card,
              borderWidth: 2,
              borderColor: colors.premium,
              backgroundColor: colors.premiumTint,
            }}
          >
            {plan ? (
              <>
                {usualYearly && usualYearly.price !== plan.price ? (
                  <Text tone="text3" style={{ textDecorationLine: 'line-through' }}>
                    {t('offers.winback.was', { price: usualYearly.price })}
                  </Text>
                ) : null}
                <Text variant="h1">{t('offers.winback.price', { price: plan.price })}</Text>
              </>
            ) : (
              <Skeleton height={32} width="60%" />
            )}
            <Text variant="caption" tone="text2">
              {t('offers.winback.covers')}
            </Text>
          </View>
        </View>
        <View style={{ gap: space.md }}>
          <OfferBuy
            testID="36"
            offeringId="winback"
            plan={plan}
            label={t('offers.winback.claim')}
          />
          <Text variant="caption" tone="text3" style={{ textAlign: 'center' }}>
            {t('offers.winback.note')}
          </Text>
          <Button
            testID="36-no"
            variant="ghost"
            label={t('offers.winback.noThanks')}
            onPress={leave}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
