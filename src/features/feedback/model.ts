import type { IconName } from '@/ui';

/** The tags on 27, in board order. The id is what is stored (stable across languages). */
export const FEEDBACK_TAGS = [
  { id: 'repetitive_questions', icon: 'repeat' },
  { id: 'partner_forgets', icon: 'bell' },
  { id: 'reminder_timing', icon: 'bell' },
  { id: 'something_broke', icon: 'alert' },
  { id: 'something_else', icon: 'plus' },
] as const satisfies readonly { id: string; icon: IconName }[];
export type FeedbackTag = (typeof FEEDBACK_TAGS)[number]['id'];

/** CONTRACTS §2: body is at most 2,000 characters. */
export const FEEDBACK_BODY_MAX = 2000;

/** 27 sends when at least one tag is picked or something is written. */
export function canSendFeedback(tags: readonly FeedbackTag[], body: string): boolean {
  return tags.length > 0 || body.trim().length > 0;
}

/** Toggle a tag, keeping board order. */
export function toggleTag(tags: readonly FeedbackTag[], id: FeedbackTag): FeedbackTag[] {
  const next = tags.includes(id) ? tags.filter((t) => t !== id) : [...tags, id];
  return FEEDBACK_TAGS.map((t) => t.id).filter((t) => next.includes(t));
}

/** The 26 face scale, 1 (very unhappy) to 5 (love it). */
export const CHECK_IN_SCORES = [1, 2, 3, 4, 5] as const;
export type CheckInScore = (typeof CHECK_IN_SCORES)[number];

/** 26 asks at most once every 30 days, from day 30 together (GAPS 2026-11-10 / 26). */
export const CHECK_IN_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
export const CHECK_IN_FIRST_DAY = 30;

/**
 * Pure: may 26 open now? Only on a good moment (both answered today, "Bonded today"), from day 30
 * together, never twice within 30 days on this device (Send and Skip both count), and never over
 * another sheet or screen that Today opens itself (badges, milestones, offers).
 */
export function shouldOfferCheckIn(input: {
  bondedToday: boolean;
  day: number;
  lastAskedAt: number | null;
  now: number;
  busy: boolean;
}): boolean {
  if (!input.bondedToday || input.busy) return false;
  if (input.day < CHECK_IN_FIRST_DAY) return false;
  return input.lastAskedAt === null || input.now - input.lastAskedAt >= CHECK_IN_INTERVAL_MS;
}
