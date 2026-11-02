import { useLocalSearchParams, useRouter } from 'expo-router';

import { parseInviteCode, usePendingInvite } from '@/features/auth/pendingInvite';
import { JoinCodeView } from '@/features/pairing/JoinCodeView';

/**
 * J3 (code filled from the link), J9 (wrong code) and 56 (expired): `/join/code?code=4827`.
 * Works before sign-in: `invite_preview` shows who is inviting without an account.
 */
export default function JoinCodeRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const pendingCode = usePendingInvite((s) => s.code);
  const initialCode = parseInviteCode(params.code) ?? pendingCode ?? '';
  return (
    <JoinCodeView
      mode="public"
      initialCode={initialCode}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
    />
  );
}
