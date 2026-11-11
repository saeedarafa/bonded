import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import EmailCallbackScreen from '@/features/auth/EmailCallbackScreen';
import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useEmailLinkError, useSession } from '@/features/auth/session';
import { isCoupleComplete, useActiveCouple } from '@/features/couple/hooks';
import { FIRST_STEP } from '@/features/onboarding/flow';
import { frontDoor } from '@/features/onboarding/frontDoor';
import { useIsNewAccount } from '@/features/onboarding/hooks';
import { SetupBond } from '@/features/onboarding/SetupBond';
import {
  hasOnboardingAnswers,
  quizInProgress,
  resumeStep,
  useOnboarding,
  useSetupInFlight,
} from '@/features/onboarding/store';
import { usePartnerLeft } from '@/features/settings/hooks';
import { useTranslation } from '@/i18n';
import { Banner, Button, Skeleton, SkeletonGroup, useTheme } from '@/ui';

/**
 * The front door (MOB-08). Signed out: onboarding, resumed at the step this phone was last on
 * after an app kill (MOB-61b). Signed in: see `frontDoor` (Today, 10 after a
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
  const resumeAt = useOnboarding(resumeStep);
  const midQuiz = useOnboarding(quizInProgress);
  const settingUp = useSetupInFlight((s) => s.active);
  const newAccount = useIsNewAccount(couple.data === null && !hasAnswers, userId);
  // MOB-18: no active couple may mean my partner left (58). Read only then; an error never blocks.
  const left = usePartnerLeft({
    enabled: couple.data === null && !hasAnswers && !midQuiz && !settingUp,
  });
  const door =
    status === 'signedIn' && (couple.data !== undefined || settingUp)
      ? frontDoor({
          settingUp,
          couple: couple.data ? { paired: isCoupleComplete(couple.data) } : null,
          returning,
          hasAnswers,
          midQuiz: midQuiz !== null,
          newAccount,
          partnerLeft: left.couple === undefined ? null : left.couple !== null,
        })
      : null;
  // MOB-61b: an account already in a couple never uses what this phone kept from a quiz; drop it
  // so it can't steer the front door later (e.g. to SetupBond after the partner leaves).
  useEffect(() => {
    if (door === 'today' && !pendingInviteCode) useOnboarding.getState().reset();
  }, [door, pendingInviteCode]);

  if (linkError) return <EmailCallbackScreen />;
  if (status === 'loading') return null;
  if (status !== 'signedIn') return <Redirect href={resumeAt ?? '/welcome'} />;
  // Email links return through `/`, unlike the in-form OTP's onSignedIn callback.
  if (pendingInviteCode) return <Redirect href="/join/name" />;
  if (door) {
    if (door === 'today') return <Redirect href="/today" />;
    if (door === 'invite') return <Redirect href="/invite" />;
    if (door === 'onboarding') return <Redirect href={FIRST_STEP} />;
    if (door === 'resume' && midQuiz) return <Redirect href={midQuiz} />;
    if (door === 'partnerLeft') return <Redirect href="/partner-left" />;
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
