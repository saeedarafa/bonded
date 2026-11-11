import { useRouter } from 'expo-router';

import { SignInView } from '@/features/auth/SignInView';
import { useOnboarding } from '@/features/onboarding/store';
import { useTranslation } from '@/i18n';

/**
 * 08: "Save your bond", after onboarding (D50: the quiz ends with 06 at 4 of 4, so 08 shows no
 * progress). Opened from 01 "I already have an account" (D40) it says "Welcome back".
 */
export default function AuthSignInRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const returning = useOnboarding((s) => s.returning);
  return (
    <SignInView
      screenId="08"
      title={returning ? t('auth.returningTitle') : t('auth.saveTitle')}
      body={returning ? t('auth.returningBody') : t('auth.saveBody')}
      mascotSize={140}
      onBack={() => {
        if (returning) useOnboarding.getState().setReturning(false);
        if (router.canGoBack()) router.back();
        else router.replace('/welcome');
      }}
      // `/` decides: Today, the invite (10) or the first-run setup (see `frontDoor`).
      onSignedIn={() => router.replace('/')}
    />
  );
}
