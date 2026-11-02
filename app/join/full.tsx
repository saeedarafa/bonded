import { Linking, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useTranslation } from '@/i18n';
import { inviteDomain } from '@/lib/env';
import { Button, Mascot, Text, useTheme } from '@/ui';

/** J10 Couple already full: exactly two per couple. Start a bond of your own instead. */
export default function JoinFullRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space, radius } = useTheme();
  const domain = inviteDomain();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="J10-screen">
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
          <Mascot mood="together" size={140} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('pairing.full.title')}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('pairing.full.body')}
          </Text>
          <View
            accessible
            style={{
              alignSelf: 'stretch',
              gap: space.xs,
              padding: space.lg,
              borderRadius: radius.card,
              backgroundColor: colors.surface2,
            }}
          >
            <Text variant="label">{t('pairing.full.mistakeTitle')}</Text>
            <Text variant="caption" tone="text2">
              {t('pairing.full.mistakeBody')}
            </Text>
          </View>
        </View>
        <View style={{ gap: space.md }}>
          <Button
            testID="J10-own"
            label={t('pairing.full.startOwn')}
            onPress={() => {
              usePendingInvite.getState().clear();
              router.replace('/welcome');
            }}
          />
          {domain ? (
            <Button
              testID="J10-support"
              variant="link"
              label={t('pairing.full.support')}
              onPress={() => void Linking.openURL(`https://${domain}/support`)}
            />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
