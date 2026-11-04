import { useLocalSearchParams, useRouter } from 'expo-router';

import { parseInviteCode, usePendingInvite } from '@/features/auth/pendingInvite';
import { JoinCodeView } from '@/features/pairing/JoinCodeView';
import { AppError, isErrorCode, messageFor } from '@/lib/errors';

/**
 * J3 (code filled from the link), J9 (wrong code) and 56 (expired): `/join/code?code=4827`.
 * Works before sign-in: `invite_preview` shows who is inviting without an account. J2 sends a dead
 * link here with what its preview said (`failed=INVITE_EXPIRED`), shown without asking again.
 */
export default function JoinCodeRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; failed?: string }>();
  const pendingCode = usePendingInvite((s) => s.code);
  const initialCode = parseInviteCode(params.code) ?? pendingCode ?? '';
  const failed = isErrorCode(params.failed) ? params.failed : null;
  return (
    <JoinCodeView
      mode="public"
      initialCode={initialCode}
      initialError={failed ? new AppError(failed, messageFor(failed)) : null}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
    />
  );
}
