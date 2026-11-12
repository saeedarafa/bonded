import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { SessionState } from '@/features/auth/session';
import { useActiveCouple } from '@/features/couple/hooks';
import { useStreak, useTodayQuestion } from '@/features/daily/hooks';
import { getCoupleProfiles, type Profile } from '@/features/profile/api';
import type { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

import { writeWidgetSnapshot } from './bridge';
import {
  buildWidgetSnapshot,
  emptyWidgetSnapshot,
  sameForWidgets,
  type WidgetSnapshot,
} from './snapshot';

/**
 * Keeps the home and lock-screen widgets in step with Today (MOB-30). It only watches the cache
 * (every query here is disabled): Today, realtime and the answer queue fetch and invalidate, and
 * each change of the couple, today's question, the streak or the names writes a new snapshot.
 * Signing out writes the empty snapshot, so no name or state stays on the home screen.
 */
export function useWidgetSync(session: SessionState): void {
  const { status, userId } = session;
  const signedIn = status === 'signedIn';
  const couple = useActiveCouple({ enabled: false });
  const question = useTodayQuestion({ enabled: false });
  const streak = useStreak({ enabled: false });
  const profiles = useQuery<Profile[], AppError>({
    queryKey: queryKeys.profiles.couple(),
    queryFn: getCoupleProfiles,
    enabled: false,
  });
  const last = useRef<WidgetSnapshot | null>(null);

  const partnerProfile = profiles.data?.find((p) => p.id !== userId) ?? null;
  const partnerDisplayName =
    partnerProfile?.display_name?.trim() || couple.data?.partner_name?.trim() || null;

  useEffect(() => {
    if (status === 'loading') return;
    const now = new Date();
    const next = signedIn
      ? buildWidgetSnapshot({
          userId,
          couple: couple.data,
          question: question.data,
          questionFetchedAt: question.dataUpdatedAt,
          streak: streak.data,
          partnerDisplayName,
          now,
        })
      : emptyWidgetSnapshot(now);
    if (!next || sameForWidgets(last.current, next)) return;
    last.current = next;
    writeWidgetSnapshot(next);
  }, [
    status,
    signedIn,
    userId,
    couple.data,
    question.data,
    question.dataUpdatedAt,
    streak.data,
    partnerDisplayName,
  ]);
}
