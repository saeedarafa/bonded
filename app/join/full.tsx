import { Linking, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSession } from '@/features/auth/session';
import { useTranslation } from '@/i18n';
import { inviteDomain } from '@/lib/env';
import { Button, Mascot, Text, useTheme } from '@/ui';

/**
 * J10 Couple already full: exactly two per couple. Start a bond of your own instead. Names the
 * inviter when the code was previewed first (J5); COUPLE_FULL itself carries no name.
 */
export default function JoinFullRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space, radius } = useTheme();
  const domain = inviteDomain();
  const { status } = useSession();
  const name = usePendingInvite((s) => s.inviterName)?.trim() ?? '';

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
            {name ? t('pairing.full.titleName', { name }) : t('pairing.full.title')}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {name ? t('pairing.full.bodyName', { name }) : t('pairing.full.body')}
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
              {name ? t('pairing.full.mistakeBodyName', { name }) : t('pairing.full.mistakeBody')}
            </Text>
          </View>
        </View>
        <View style={{ gap: space.md }}>
          <Button
            testID="J10-own"
            // D37: someone signed in already has their own space: back to it, not to onboarding.
            label={
              status === 'signedIn'
                ? t('pairing.joinPartner.backToMine')
                : t('pairing.full.startOwn')
            }
            onPress={() => {
              usePendingInvite.getState().clear();
              router.replace(status === 'signedIn' ? '/' : '/welcome');
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
