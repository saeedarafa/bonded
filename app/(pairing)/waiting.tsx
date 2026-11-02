import { Redirect, useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useActiveCouple } from '@/features/couple/hooks';
import { usePartnerJoined } from '@/features/pairing/hooks';
import { useTranslation } from '@/i18n';
import { Banner, Button, Mascot, Text, useTheme } from '@/ui';

/** 11 Waiting, answer first: the partner hasn't joined. Moves on by itself when they do. */
export default function PairingWaitingRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const couple = useActiveCouple();
  const { joined } = usePartnerJoined();

  if (joined) return <Redirect href="/paired" />;
  if (couple.data === null) return <Redirect href="/" />;

  const partner = couple.data?.partner_name?.trim() || t('pairing.partnerFallback');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="11-screen">
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
          <Mascot mood="waiting" size={160} partnerName={partner} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('pairing.waiting.title', { partner })}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('pairing.waiting.body')}
          </Text>
          {couple.error ? <Banner tone="error" message={couple.error.message} /> : null}
        </View>
        <View style={{ gap: space.md }}>
          <Button
            testID="11-answer"
            label={t('pairing.waiting.answerFirst')}
            onPress={() => router.push('/today')}
          />
          <Button
            testID="11-resend"
            variant="ghost"
            label={t('pairing.waiting.resend')}
            onPress={() => router.push('/invite')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
