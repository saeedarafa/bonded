import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { track } from '@/lib/analytics';

import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

import { getBadgeAwards, getBadgeCatalogue, type Badge, type BadgeAward } from './api';
import { earnedStreakSteps, pickCelebration, type Celebration, type StreakRun } from './model';
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
  number[] | undefined {
  const catalogue = useBadgeCatalogue({ enabled });
  const awards = useBadgeAwards({ enabled });
  return useMemo(
    () =>
      catalogue.data && awards.data ? earnedStreakSteps(awards.data, catalogue.data) : undefined,
    [catalogue.data, awards.data],
  );
}

/**
 * A streak badge earned in the last 48 h and not yet celebrated on this device, or null (see
 * `pickCelebration`). Waits for the streak (`get_streak()`): it tells when each step was reached.
 */
export function useBadgeCelebration({
  enabled = true,
  streak,
}: {
  enabled?: boolean;
  /** The current run; undefined while loading (nothing is celebrated until it is known). */
  streak: StreakRun | undefined;
}): {
  celebration: Celebration | null;
  markSeen: (ids: readonly string[]) => void;
} {
  const catalogue = useBadgeCatalogue({ enabled });
  const awards = useBadgeAwards({ enabled });
  const seen = useSeenBadges((s) => s.seen);
  const markSeenOnDevice = useSeenBadges((s) => s.markSeen);
  const queryClient = useQueryClient();
  // Analytics (MOB-24d, §3.6): `badge_earned` with the badge's slug when its celebration first
  // shows on this phone. Stable, so Today's focus effect does not re-run for it.
  const markSeen = useCallback(
    (ids: readonly string[]) => {
      const before = useSeenBadges.getState().seen;
      for (const id of ids) {
        if (before.includes(id)) continue;
        const slug = queryClient
          .getQueryData<BadgeAward[]>(queryKeys.badges.awards())
          ?.find((a) => a.id === id)?.badge_slug;
        if (slug) track('badge_earned', { badge_id: slug });
      }
      markSeenOnDevice(ids);
    },
    [markSeenOnDevice, queryClient],
  );
  const celebration = useMemo(
    () =>
      catalogue.data && awards.data && streak
        ? pickCelebration({
            awards: awards.data,
            catalogue: catalogue.data,
            seen,
            now: new Date(),
            streak,
          })
        : null,
    [catalogue.data, awards.data, seen, streak],
  );
  return { celebration, markSeen };
}
