import { Redirect, useLocalSearchParams } from 'expo-router';

import { parseInviteCode, parseInviteToken, usePendingInvite } from '@/features/auth/pendingInvite';

/**
 * Invite deep link: `https://<domain>/j/BND4827?t=<token>` or `bonded://j/BND4827?t=<token>`
 * (D02, D07). Works cold-start and warm, before sign-in. Remembers the code and token (in memory)
 * and lands on J3 with the digits filled in. A malformed code still lands on J3, empty.
 */
export default function InviteLinkRoute() {
  const params = useLocalSearchParams<{ code?: string; t?: string }>();
  const code = parseInviteCode(params.code);
  const token = parseInviteToken(params.t);
  // Set during render on purpose: the redirect below navigates away immediately, and the store
  // write is idempotent. MOB-09's J3 reads it for `invite_preview` and `accept_invite`.
  usePendingInvite.getState().set({ code, token });
  return <Redirect href={code ? { pathname: '/join/code', params: { code } } : '/join/code'} />;
}
