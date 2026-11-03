import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCoupleProfiles } from '@/features/profile/hooks';
import { useTranslation } from '@/i18n';
import { Button, Chip, Confetti, haptics, Mascot, Text, useTheme } from '@/ui';

/** 13 You're paired: shown on both phones. Confetti and one heavy haptic (none of it when reduced motion). */
export default function PairingPairedRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { me, partner } = useCoupleProfiles();

  useEffect(() => {
    haptics.heavy();
  }, []);

  const meName = me?.display_name.trim() || t('pairing.partnerFallback');
  const partnerName = partner?.display_name.trim() || t('pairing.partnerFallback');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="13-screen">
      <Confetti active testID="13-confetti" />
      <View
        style={{
          flex: 1,
          justifyContent: 'space-between',
          gap: space.xl,
          padding: space.gutter,
          paddingTop: space.hero,
        }}
      >
        <View style={{ alignItems: 'center', gap: space.lg }}>
          <Mascot mood="celebrating" size={180} />
          {/* Chip aligns itself to the start; the wrapper centres it with the title (#37). */}
          <View testID="13-day">
            <Chip tone="streak" label={t('pairing.paired.day')} />
          </View>
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('pairing.paired.title')}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('pairing.paired.body', { me: meName, partner: partnerName })}
          </Text>
        </View>
        <Button
          testID="13-continue"
          label={t('pairing.paired.cta')}
          onPress={() => router.replace('/today')}
        />
      </View>
    </SafeAreaView>
  );
}
