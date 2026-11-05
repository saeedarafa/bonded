import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { Button, Chip, Confetti, haptics, Icon, Mascot, Text, useTheme } from '@/ui';

/**
 * 35 You're both Premium. Reached after the server confirmed the entitlement (paywall 16/34).
 * The partner gets the `partner_premium` push from the backend (BE-08); nothing is sent here.
 */
export default function PremiumSuccessScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, radius, space } = useTheme();
  const params = useLocalSearchParams<{ pack?: string; packId?: string }>();
  const couple = useActiveCouple();
  const { partner } = useCoupleProfiles();
  const paired = isCoupleComplete(couple.data);
  const partnerName = partner?.display_name.trim() || t('pairing.partnerFallback');

  useEffect(() => {
    haptics.heavy();
  }, []);

  const perks = [
    t('premium.success.packs'),
    t('premium.success.saver'),
    t('premium.success.recap'),
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="35-screen">
      <Confetti active testID="35-confetti" />
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
          <Mascot mood="celebrating" size={170} />
          <View testID="35-chip">
            <Chip tone="premium" label={t('premium.chip')} />
          </View>
          <Text
            variant="h1"
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            style={{ textAlign: 'center' }}
          >
            {paired ? t('premium.success.titleBoth') : t('premium.success.titleSolo')}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {paired
              ? t('premium.success.bodyBoth', { partner: partnerName })
              : t('premium.success.bodySolo')}
          </Text>
        </View>
        <View
          style={{
            gap: space.md,
            padding: space.lg,
            borderRadius: radius.card,
            backgroundColor: colors.surface,
          }}
        >
          {perks.map((perk) => (
            <View key={perk} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
              <Icon name="check" color={colors.premiumText} />
              <Text style={{ flex: 1 }}>{perk}</Text>
            </View>
          ))}
        </View>
        <Button
          testID="35-continue"
          label={
            params.pack && params.packId
              ? t('premium.success.startPack', { pack: params.pack })
              : t('premium.success.explore')
          }
          onPress={() =>
            router.replace(
              params.packId
                ? { pathname: '/packs/[packId]', params: { packId: params.packId } }
                : '/packs',
            )
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}
