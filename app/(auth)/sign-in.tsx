import { useRouter } from 'expo-router';

import { SignInView } from '@/features/auth/SignInView';
import { useTranslation } from '@/i18n';

/** 08: "Save your bond", the last step of onboarding (4 of 4). */
export default function AuthSignInRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <SignInView
      screenId="08"
      step={4}
      total={4}
      title={t('auth.saveTitle')}
      body={t('auth.saveBody')}
      mascotSize={140}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
      // `/` sends a signed-in person to Today, or on to the invite when there is no couple yet.
      onSignedIn={() => router.replace('/')}
    />
  );
}
