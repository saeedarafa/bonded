import { track, type EventProps } from '@/lib/analytics';
import type { AppError } from '@/lib/errors';

/**
 * Pairing funnel call sites (MOB-24d, ANALYTICS §3.4). Never the code, the token, the link or a
 * name: only how it went.
 */

/** CONTRACTS §2 `create_invite`: an invite lives 48 hours. */
export const INVITE_LIFETIME_MS = 48 * 60 * 60 * 1000;

/** Whole hours since the open invite was made (from its `expires_at`), or null. */
export function hoursSinceInvite(expiresAt: string | null | undefined, now = Date.now()) {
  const expires = Date.parse(expiresAt ?? '');
  if (!Number.isFinite(expires)) return null;
  return Math.max(0, Math.floor((now - (expires - INVITE_LIFETIME_MS)) / 3_600_000));
}

type CodeResult = EventProps<'join_code_entered'>['result'];

/**
 * A typed code's answer as `join_code_entered.result`. Null when the answer says nothing about the
 * code (offline, a server error, the D37 consent): no event then.
 */
export function codeResult(error: AppError | null): CodeResult | null {
  if (!error) return 'ok';
  switch (error.kind) {
    case 'RATE_LIMITED':
      return 'rate_limited';
    case 'COUPLE_FULL':
      return 'full';
    case 'INVALID_CODE':
    case 'INVITE_EXPIRED':
    case 'OWN_CODE':
      return 'invalid';
    default:
      return null;
  }
}

/** `join_code_entered` for a typed code (a link's token is not a typed code). */
export function trackCodeEntered(error: AppError | null): void {
  const result = codeResult(error);
  if (result) track('join_code_entered', { result });
}

/** Paired codes already reported this run (a retry after success says ALREADY_PAIRED). */
const completed = new Set<string>();

export function trackJoinCompleted(
  code: string,
  { via, archivedSolo }: { via: 'link' | 'code'; archivedSolo: boolean },
): void {
  if (completed.has(code)) return;
  completed.add(code);
  track('join_completed', { via, archived_solo: archivedSolo });
}

/** Tests: forget what was reported. */
export function resetPairingAnalyticsForTests(): void {
  completed.clear();
}
