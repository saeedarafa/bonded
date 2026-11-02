import { Redirect, useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSession } from '@/features/auth/session';
import { useTranslation } from '@/i18n';
import { Button, Mascot, Text, useTheme } from '@/ui';

/**
 * J2 Personal welcome, for an invite we already know (code, token and the inviter's name in
 * memory, e.g. after a deferred deep link). Without one it falls back to typing the code.
 */
export default function JoinWelcomeRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { status } = useSession();
  const { code, inviterName } = usePendingInvite();

  if (!code || !inviterName) return <Redirect href="/join/code" />;
  const name = inviterName.trim() || t('pairing.partnerFallback');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="J2-screen">
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
          <Mascot mood="together" size={180} />
          <Text variant="caption" tone="text2">
            {t('pairing.welcome.kicker', { name })}
          </Text>
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            {t('pairing.welcome.title', { name })}
          </Text>
          <Text tone="text2" style={{ textAlign: 'center' }}>
            {t('pairing.welcome.body')}
          </Text>
        </View>
        <View style={{ gap: space.md }}>
          <Button
            testID="J2-join"
            label={t('pairing.welcome.join', { name })}
            onPress={() => router.push(status === 'signedIn' ? '/join/name' : '/join/sign-in')}
          />
          <Button
            testID="J2-no"
            variant="ghost"
            label={t('pairing.welcome.notMine')}
            onPress={() => {
              usePendingInvite.getState().clear();
              router.replace('/welcome');
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
