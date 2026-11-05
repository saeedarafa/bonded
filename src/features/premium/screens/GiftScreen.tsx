import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { Button, Chip, haptics, Icon, Mascot, Skeleton, SkeletonGroup, Text, useTheme } from '@/ui';

import { useOffer } from '../hooks';
import { useOfferShown } from '../offers';

/**
 * 14 You both earned a gift (D28): shown after pairing while the server says the couple's intro
 * offer is live. Shown once per couple on this device; the partner's phone shows the same gift.
 */
export default function GiftScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const { partner } = useCoupleProfiles();
  const intro = useOffer('intro');
  const markShown = useOfferShown((s) => s.markShown);
  const live = intro.offer !== null;

  useEffect(() => {
    if (live && intro.coupleId) {
      markShown(intro.coupleId, 'intro');
      haptics.success();
    }
  }, [live, intro.coupleId, markShown]);

  // Not (or no longer) eligible: nothing to open here.
  if (intro.status === 'none') return <Redirect href="/today" />;

  const partnerName = partner?.display_name.trim() || t('pairing.partnerFallback');
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
            <Mascot mood="celebrating" size={150} />
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: radius.card,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.premium,
              }}
            >
              <Icon name="sparkle" color={colors.onPremium} size={44} filled />
            </View>
            <Chip tone="premium" label={t('premium.chip')} />
            <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
              {t('offers.gift.title')}
            </Text>
            <Text tone="text2" style={{ textAlign: 'center' }}>
              {t('offers.gift.body')}
            </Text>
          </View>
          <View style={{ gap: space.md }}>
            <Button
              testID="14-open"
              variant="premium"
              label={t('offers.gift.open')}
              onPress={() => router.replace('/gift/opened')}
            />
            <Text variant="caption" tone="text3" style={{ textAlign: 'center' }}>
              {t('offers.gift.note', { partner: partnerName })}
            </Text>
            <Button
              testID="14-later"
              variant="ghost"
              label={t('offers.gift.later')}
              onPress={() => router.replace('/today')}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
