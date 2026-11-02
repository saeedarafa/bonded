import { useRouter } from 'expo-router';

import { SignInView } from '@/features/auth/SignInView';
import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useTranslation } from '@/i18n';

/** J4: quick sign in for the joining partner (1 of 3). Next is J5, "Your name". */
export default function JoinSignInRoute() {
  const router = useRouter();
  const { t } = useTranslation();
  const inviterName = usePendingInvite((s) => s.inviterName);
  return (
    <SignInView
      screenId="J4"
      step={1}
      total={3}
      title={t('auth.joinTitle')}
      body={inviterName ? t('auth.joinBody', { name: inviterName }) : t('auth.joinBodyNoName')}
      mascotSize={130}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/join/welcome'))}
      onSignedIn={() => router.replace('/join/name')}
    />
  );
}
