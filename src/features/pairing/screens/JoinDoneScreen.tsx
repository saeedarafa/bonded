import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PartnerPlanNote } from '@/features/premium/components/PaywallParts';
import { usePremium } from '@/features/premium/hooks';
import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { Button, Confetti, haptics, Mascot, Text, useTheme } from '@/ui';

/**
 * J8 Paired, on the partner's plan. The "Premium · on Maya's plan" card shows only when the
 * server says the partner's entitlement covers me (D29, `usePremium().viaPartner`). J6 sends
 * only a premium couple here (MOB-47); a free couple goes to 13, which offers gift 14.
 */
export default function JoinDoneScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { me, partner } = useCoupleProfiles();
  const premium = usePremium();

  useEffect(() => {
    haptics.heavy();
  }, []);

  const meName = me?.display_name.trim() || t('pairing.partnerFallback');
  const partnerName = partner?.display_name.trim() || t('pairing.partnerFallback');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="J8-screen">
      <Confetti active testID="J8-confetti" />
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
          <Mascot mood="together" size={170} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('pairing.joinDone.title', { me: meName })}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('pairing.joinDone.body', { partner: partnerName })}
          </Text>
          {premium.viaPartner ? (
            <PartnerPlanNote partner={partnerName} testID="J8-partner-plan" />
          ) : null}
        </View>
        <Button
          testID="J8-continue"
          label={t('pairing.joinDone.cta')}
          onPress={() => router.replace('/today')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
