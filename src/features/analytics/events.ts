import {
  analyticsEnabled,
  pauseForAccountDeletion,
  resumeAfterAccountDeletion,
  track,
} from '@/lib/analytics';

/**
 * Account deletion and analytics (MOB-24c, ANALYTICS §3.3, SEC-16 Info 6, BE-51):
 * 1. `beginAccountDeletion()` before `delete-account`: capture stops and unsent events are dropped,
 *    so nothing re-creates the person after the server asked PostHog to delete it.
 * 2. `trackAccountDeleted()` once the server confirmed: a fresh anonymous id (`reset()`), then
 *    `account_deleted` under it. The local wipe's sign-out that follows is not a `signed_out` and
 *    does not reset again.
 * 3. `endAccountDeletion()` when the account was not deleted: capture resumes as before.
 */
let accountDeleted = false;

export function beginAccountDeletion(): Promise<void> {
  return pauseForAccountDeletion();
}

export function endAccountDeletion(): Promise<void> {
  return resumeAfterAccountDeletion({ deleted: false });
}

export async function trackAccountDeleted(): Promise<void> {
  if (!analyticsEnabled()) return;
  await resumeAfterAccountDeletion({ deleted: true });
  track('account_deleted');
  accountDeleted = true;
}

export function consumeAccountDeleted(): boolean {
  const was = accountDeleted;
  accountDeleted = false;
  return was;
}
