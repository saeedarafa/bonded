import type { ActiveCouple } from '@/features/couple/api';
import { onceOnDevice, recallOnDevice, rememberOnDevice, track } from '@/lib/analytics';

/**
 * Couple and device lifecycle (MOB-24d, ANALYTICS §2, §3.4, §3.8): who started the couple, the
 * `paired` moment on both phones, and a push permission changed in the OS settings.
 */

export type Role = 'starter' | 'joiner';

/**
 * `role`: the starter made the couple, so joined it first; the joiner came in later. Null until
 * the couple has two active members whose join times are known.
 */
export function coupleRole(
  couple: ActiveCouple | null | undefined,
  userId: string | null,
): Role | null {
  if (!couple || !userId) return null;
  const members = couple.couple_members.filter((m) => m.left_at === null);
  if (members.length < 2) return null;
  const me = members.find((m) => m.user_id === userId);
  const times = members.map((m) => Date.parse(m.joined_at ?? ''));
  if (!me || times.some((t) => !Number.isFinite(t))) return null;
  const mine = Date.parse(me.joined_at ?? '');
  return times.every((t) => mine <= t) ? 'starter' : 'joiner';
}

/**
 * How long after pairing a phone still reports `paired`: the moment itself (13, J8, or the next
 * open after the partner joined), not couples that were paired before this build.
 */
export const PAIRED_RECENT_MS = 24 * 60 * 60 * 1000;

/**
 * `paired` once per couple on this phone. Waits (sends nothing, remembers nothing) until the role
 * and the sign-up time are known.
 */
export function trackPaired(
  {
    coupleId,
    pairedAt,
    role,
    signedUpAt,
  }: {
    coupleId: string;
    pairedAt: string | null | undefined;
    role: Role | null;
    signedUpAt: string | null;
  },
  now = Date.now(),
): void {
  const paired = Date.parse(pairedAt ?? '');
  const signup = Date.parse(signedUpAt ?? '');
  if (!role || !Number.isFinite(paired) || !Number.isFinite(signup)) return;
  if (now - paired > PAIRED_RECENT_MS) return;
  if (!onceOnDevice(`paired:${coupleId}`)) return;
  track('paired', {
    role,
    hours_from_signup: Math.max(0, Math.floor((paired - signup) / 3_600_000)),
  });
}

const PUSH_PERMISSION = 'push_permission';

/**
 * On app open: the OS push permission, compared with the last one seen on this phone. Only a
 * decided permission that flipped (allowed ↔ not allowed) is a `push_permission_changed`; the
 * first answer to the prompt is `reminder_permission_result`.
 */
export function notePushPermission(state: 'granted' | 'denied' | 'undetermined'): void {
  const before = recallOnDevice(PUSH_PERMISSION);
  if (state === 'undetermined') return;
  if ((before === 'granted' || before === 'denied') && before !== state) {
    track('push_permission_changed', { granted: state === 'granted' });
  }
  rememberOnDevice(PUSH_PERMISSION, state);
}

/**
 * §3.6 `streak_extended` / `streak_broken`, from the streak the app reads (root, every refetch),
 * compared with the last one seen on this phone for this couple. The first reading only sets the
 * baseline (an existing streak on a new install is not news).
 */
export function noteStreak(coupleId: string, current: number): void {
  const key = `streak:${coupleId}`;
  const before = Number(recallOnDevice(key) ?? NaN);
  if (Number.isInteger(before) && before >= 0) {
    if (current > before) track('streak_extended', { streak: current });
    else if (current < before && before > 0) {
      track('streak_broken', { previous_streak: before });
    }
  }
  if (before !== current) rememberOnDevice(key, String(current));
}
