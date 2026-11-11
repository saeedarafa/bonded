import { analyticsEnabled, track } from '@/lib/analytics';

/**
 * Account events that change what the session hook sends (MOB-24, ANALYTICS §3.3).
 * `account_deleted` goes out after the server confirmed, before the local wipe signs out (and
 * `resetUser()` runs); the sign-out that follows is not a `signed_out`.
 */
let accountDeleted = false;

export function trackAccountDeleted(): void {
  if (!analyticsEnabled()) return;
  track('account_deleted');
  accountDeleted = true;
}

export function consumeAccountDeleted(): boolean {
  const was = accountDeleted;
  accountDeleted = false;
  return was;
}
