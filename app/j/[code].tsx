import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';

import { parseInviteCode, parseInviteToken, usePendingInvite } from '@/features/auth/pendingInvite';
import { useSession } from '@/features/auth/session';
import { track } from '@/lib/analytics';

/**
 * Invite deep link: `https://<domain>/j/BND4827?t=<token>` or `bonded://j/BND4827?t=<token>`
 * (D02, D06, D07). Works cold-start and warm, before sign-in. Remembers the code and token (in
 * memory only) and opens J2, the personal welcome with the inviter's name and avatar (MOB-40);
 * J4 sign-in and J5 follow. A link without a valid token lands on J3 with the digits filled in,
 * and a malformed code on an empty J3, as before.
 */
export default function InviteLinkRoute() {
  const params = useLocalSearchParams<{ code?: string; t?: string }>();
  const code = parseInviteCode(params.code);
  const token = parseInviteToken(params.t);
  const { status } = useSession();
  // Analytics (MOB-24d, §3.4): once per link. `valid` = a well-formed code and token (the server
  // has not been asked yet); never the code or the token themselves.
  const sent = useRef(false);
  useEffect(() => {
    // Sent at once: this route redirects straight away, so it can't wait for a stored session.
    if (sent.current) return;
    sent.current = true;
    track('invite_link_opened', { signed_in: status === 'signedIn', valid: !!code && !!token });
  }, [status, code, token]);
  // Set during render on purpose: the redirect below navigates away immediately, and the store
  // write is idempotent. A different code forgets the name previewed for the old one.
  const previous = usePendingInvite.getState();
  usePendingInvite.getState().set({
    code,
    token,
    inviterName: previous.code === code ? previous.inviterName : null,
  });
  if (code && token) return <Redirect href="/join/welcome" />;
  return <Redirect href={code ? { pathname: '/join/code', params: { code } } : '/join/code'} />;
}
