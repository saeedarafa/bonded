import { BADGE_STEPS, nextBadgeStep } from '@/ui';

import type { Badge, BadgeAward } from './api';

/** Streak steps that get the full-screen milestone (25) instead of the badge sheet (52b). */
export const MILESTONE_STEPS: readonly number[] = [7, 30, 100];
/**
 * MOB-41 (lead decision): 25 and 52b celebrate only steps earned in the last 48 h. Older ones (a
 * fresh sign-in or reinstall on an existing streak) are not replayed; they just appear on 52.
 */
export const CELEBRATE_WINDOW_MS = 48 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What `pickCelebration` needs from `get_streak()` (the current run). */
export type StreakRun = { current: number; lastCompletedOn: string | null };

/**
 * Pure: when a streak step was earned, at the latest. `awarded_at` is when the server wrote the
 * award, which can be later than the day the step was reached (an award backfilled for an existing
 * streak). A step inside the current run was reached `current - step` days before its last
 * completed day, so it counts from the end of that day when that is earlier.
 */
export function stepEarnedAt(awardedAt: string, step: number, run: StreakRun | null): number {
  const awarded = new Date(awardedAt).getTime();
  if (!run?.lastCompletedOn || step < 1 || step > run.current) return awarded;
  const last = Date.parse(`${run.lastCompletedOn}T00:00:00Z`);
  if (Number.isNaN(last)) return awarded;
  const reachedDayEnd = last - (run.current - step) * DAY_MS + DAY_MS;
  return Math.min(awarded, reachedDayEnd);
}

export function isMilestoneStep(days: number): boolean {
  return MILESTONE_STEPS.includes(days);
}

/** A valid `/milestone/[n]` param: a streak step, else null. */
export function parseStep(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return (BADGE_STEPS as readonly number[]).includes(n) ? n : null;
}

function bySlug(catalogue: readonly Badge[]): Map<string, Badge> {
  return new Map(catalogue.map((b) => [b.slug, b]));
}

/** Streak thresholds awarded to the couple, ascending. */
export function earnedStreakSteps(
  awards: readonly BadgeAward[],
  catalogue: readonly Badge[],
): number[] {
  const slugs = bySlug(catalogue);
  return awards
    .map((a) => slugs.get(a.badge_slug))
    .filter((b): b is Badge => !!b && b.kind === 'streak')
    .map((b) => b.threshold)
    .sort((a, b) => a - b);
}

/**
 * Colour family of a badge tile, relative to the viewer (board 52):
 * - streak badges: `shared`, they belong to both of you (D19);
 * - personal achievements: `you` when mine, `partner` (sky) when my partner's;
 * - shared achievements: `shared`.
 * `shared` is blush, the hearts colour (D41): gold stays premium-only.
 */
export type BadgeTone = 'you' | 'partner' | 'shared';

export type BadgeTile = {
  slug: string;
  kind: Badge['kind'];
  title: string;
  threshold: number;
  state: 'earned' | 'next' | 'locked';
  awardedAt: string | null;
  tone: BadgeTone;
};

/**
 * Pure: the badge grid (52). Earned badges first, newest first; then every streak badge not
 * earned yet, in step order (the next one says how many days are left). Achievement badges are
 * listed only once awarded: nothing awards them yet (D19: P1).
 */
export function badgeTiles(input: {
  catalogue: readonly Badge[];
  awards: readonly BadgeAward[];
  current: number;
  userId: string | null;
}): BadgeTile[] {
  const slugs = bySlug(input.catalogue);
  const earned: BadgeTile[] = [];
  const seen = new Set<string>();
  for (const award of input.awards) {
    const badge = slugs.get(award.badge_slug);
    if (!badge || seen.has(badge.slug)) continue;
    seen.add(badge.slug);
    earned.push({
      slug: badge.slug,
      kind: badge.kind,
      title: badge.title,
      threshold: badge.threshold,
      state: 'earned',
      awardedAt: award.awarded_at,
      tone:
        badge.kind === 'streak'
          ? 'shared'
          : award.user_id
            ? award.user_id === input.userId
              ? 'you'
              : 'partner'
            : 'shared',
    });
  }
  earned.sort((a, b) => (b.awardedAt ?? '').localeCompare(a.awardedAt ?? ''));
  const streakSteps = earnedStreakSteps(input.awards, input.catalogue);
  const next = nextBadgeStep(input.current, BADGE_STEPS, streakSteps);
  const locked = input.catalogue
    .filter((b) => b.kind === 'streak' && !seen.has(b.slug))
    .sort((a, b) => a.threshold - b.threshold)
    .map<BadgeTile>((b) => ({
      slug: b.slug,
      kind: b.kind,
      title: b.title,
      threshold: b.threshold,
      state: b.threshold === next ? 'next' : 'locked',
      awardedAt: null,
      tone: 'shared',
    }));
  return [...earned, ...locked];
}

export type Celebration = {
  /** The streak step to celebrate: the highest one among the new awards. */
  days: number;
  kind: 'milestone' | 'sheet';
  /** Every new award id, so they are all marked seen at once. */
  awardIds: string[];
};

/**
 * Pure: what to celebrate on this device. New = not seen here and earned within the last 48 h
 * (`stepEarnedAt`). A late answer can award several steps at once; only the highest one is shown.
 */
export function pickCelebration(input: {
  awards: readonly BadgeAward[];
  catalogue: readonly Badge[];
  seen: readonly string[];
  now: Date;
  /** The couple's current run; without it only `awarded_at` counts. */
  streak?: StreakRun | null;
}): Celebration | null {
  const slugs = bySlug(input.catalogue);
  const fresh = input.awards.flatMap((a) => {
    const b = slugs.get(a.badge_slug);
    if (!b || b.kind !== 'streak' || input.seen.includes(a.id)) return [];
    const earned = stepEarnedAt(a.awarded_at, b.threshold, input.streak ?? null);
    return input.now.getTime() - earned <= CELEBRATE_WINDOW_MS
      ? [{ id: a.id, step: b.threshold }]
      : [];
  });
  const steps = fresh.map((a) => a.step);
  if (!steps.length) return null;
  const days = Math.max(...steps);
  return {
    days,
    kind: isMilestoneStep(days) ? 'milestone' : 'sheet',
    awardIds: fresh.map((a) => a.id),
  };
}
