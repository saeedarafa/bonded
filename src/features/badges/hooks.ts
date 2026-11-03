import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

import { getBadgeAwards, getBadgeCatalogue, type Badge, type BadgeAward } from './api';
import { earnedStreakSteps, pickCelebration, type Celebration } from './model';
import { useSeenBadges } from './seen';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The catalogue changes only with a content load: cache it for a day. */
export function useBadgeCatalogue({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<Badge[], AppError>({
    queryKey: queryKeys.badges.catalogue(),
    queryFn: getBadgeCatalogue,
    staleTime: DAY_MS,
    enabled,
  });
}

/** Our awards; an `answers` change (realtime or my own save) invalidates them. */
export function useBadgeAwards({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<BadgeAward[], AppError>({
    queryKey: queryKeys.badges.awards(),
    queryFn: getBadgeAwards,
    enabled,
  });
}

/** Streak steps awarded to the couple (Today's ladder, 24), or undefined while loading. */
export function useEarnedStreakSteps({ enabled = true }: { enabled?: boolean } = {}):
  | number[]
  | undefined {
  const catalogue = useBadgeCatalogue({ enabled });
  const awards = useBadgeAwards({ enabled });
  return useMemo(
    () =>
      catalogue.data && awards.data ? earnedStreakSteps(awards.data, catalogue.data) : undefined,
    [catalogue.data, awards.data],
  );
}

/** A streak badge awarded since this device last looked, or null (see `pickCelebration`). */
export function useBadgeCelebration({ enabled = true }: { enabled?: boolean } = {}): {
  celebration: Celebration | null;
  markSeen: (ids: readonly string[]) => void;
} {
  const catalogue = useBadgeCatalogue({ enabled });
  const awards = useBadgeAwards({ enabled });
  const seen = useSeenBadges((s) => s.seen);
  const markSeen = useSeenBadges((s) => s.markSeen);
  const celebration = useMemo(
    () =>
      catalogue.data && awards.data
        ? pickCelebration({
            awards: awards.data,
            catalogue: catalogue.data,
            seen,
            now: new Date(),
          })
        : null,
    [catalogue.data, awards.data, seen],
  );
  return { celebration, markSeen };
}
