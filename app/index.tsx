import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import EmailCallbackScreen from '@/features/auth/EmailCallbackScreen';
import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useEmailLinkError, useSession } from '@/features/auth/session';
import { useActiveCouple } from '@/features/couple/hooks';
import { SetupBond } from '@/features/onboarding/SetupBond';
import { useTranslation } from '@/i18n';
import { Banner, Button, Skeleton, SkeletonGroup, useTheme } from '@/ui';

/**
 * The front door (MOB-08). Signed out: onboarding. Signed in: Today once there is a couple, the
 * invite step while there isn't one yet (MOB-07 puts `create_couple` in front of it). The couple
 * comes from the persisted query cache first, so a returning person on a plane still gets in.
 */
export default function Index() {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { status } = useSession();
  const linkError = useEmailLinkError();
  const pendingInviteCode = usePendingInvite((s) => s.code);
  const couple = useActiveCouple({ enabled: status === 'signedIn' });

  if (linkError) return <EmailCallbackScreen />;
  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;
  // Email links return through `/`, unlike the in-form OTP's onSignedIn callback.
  if (pendingInviteCode) return <Redirect href="/join/name" />;
  if (couple.data) return <Redirect href="/today" />;
  // No couple yet: write the onboarding answers (`create_couple`), then the invite step.
  if (couple.data === null) return <SetupBond />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} testID="index-loading">
      <View style={{ flex: 1, padding: space.gutter, gap: space.lg, justifyContent: 'center' }}>
        {couple.error ? (
          <>
            <Banner tone="error" message={couple.error.message} />
            <Button label={t('ui.retry')} onPress={() => void couple.refetch()} />
          </>
        ) : (
          <SkeletonGroup>
            <Skeleton height={32} width="60%" />
            <Skeleton height={120} />
          </SkeletonGroup>
        )}
      </View>
    </SafeAreaView>
  );
}
