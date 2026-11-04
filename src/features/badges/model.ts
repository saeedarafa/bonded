import { BADGE_STEPS, nextBadgeStep } from '@/ui';

import type { Badge, BadgeAward } from './api';

/** Streak steps that get the full-screen milestone (25) instead of the badge sheet (52b). */
export const MILESTONE_STEPS: readonly number[] = [7, 30, 100];
/** An award older than this is not celebrated any more (reinstall, a long time away). */
export const CELEBRATE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

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
 * Pure: what to celebrate on this device. New = not seen here and awarded within the window.
 * A late answer can award several steps at once; only the highest one is shown.
 */
export function pickCelebration(input: {
  awards: readonly BadgeAward[];
  catalogue: readonly Badge[];
  seen: readonly string[];
  now: Date;
}): Celebration | null {
  const slugs = bySlug(input.catalogue);
  const fresh = input.awards.filter(
    (a) =>
      !input.seen.includes(a.id) &&
      input.now.getTime() - new Date(a.awarded_at).getTime() <= CELEBRATE_WINDOW_MS,
  );
  const steps = fresh
    .map((a) => slugs.get(a.badge_slug))
    .filter((b): b is Badge => !!b && b.kind === 'streak')
    .map((b) => b.threshold);
  if (!steps.length) return null;
  const days = Math.max(...steps);
  return {
    days,
    kind: isMilestoneStep(days) ? 'milestone' : 'sheet',
    awardIds: fresh.map((a) => a.id),
  };
}
