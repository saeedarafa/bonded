import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import EmailCallbackScreen from '@/features/auth/EmailCallbackScreen';
import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useEmailLinkError, useSession } from '@/features/auth/session';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { frontDoor } from '@/features/onboarding/frontDoor';
import { useIsNewAccount } from '@/features/onboarding/hooks';
import { SetupBond } from '@/features/onboarding/SetupBond';
import { hasOnboardingAnswers, useOnboarding, useSetupInFlight } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';
import { Banner, Button, Skeleton, SkeletonGroup, useTheme } from '@/ui';

/**
 * The front door (MOB-08). Signed out: onboarding. Signed in: see `frontDoor` (Today, 10 after a
 * returning sign-in, SetupBond, or the story and quiz for a brand-new account; D40). The couple
 * comes from the persisted query cache first, so a returning person on a plane still gets in.
 */
export default function Index() {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { status, userId } = useSession();
  const linkError = useEmailLinkError();
  const pendingInviteCode = usePendingInvite((s) => s.code);
  const couple = useActiveCouple({ enabled: status === 'signedIn' });
  const returning = useOnboarding((s) => s.returning);
  const hasAnswers = useOnboarding(hasOnboardingAnswers);
  const settingUp = useSetupInFlight((s) => s.active);
  const newAccount = useIsNewAccount(couple.data === null && !hasAnswers, userId);

  if (linkError) return <EmailCallbackScreen />;
  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href="/welcome" />;
  // Email links return through `/`, unlike the in-form OTP's onSignedIn callback.
  if (pendingInviteCode) return <Redirect href="/join/name" />;
  if (couple.data !== undefined || settingUp) {
    const door = frontDoor({
      settingUp,
      couple: couple.data ? { paired: isCoupleComplete(couple.data) } : null,
      returning,
      hasAnswers,
      newAccount,
    });
    if (door === 'today') return <Redirect href="/today" />;
    if (door === 'invite') return <Redirect href="/invite" />;
    if (door === 'onboarding') return <Redirect href="/story/1" />;
    // No couple yet: write the onboarding answers (`create_couple`), then 09 and the invite step.
    if (door === 'setup') return <SetupBond />;
  }

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
