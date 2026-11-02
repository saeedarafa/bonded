import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { subscribeToCouple } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';

/**
 * Subscribes to the couple's realtime channel while mounted (CONTRACTS §2). Mount it once, high
 * in the signed-in tree, with the active couple's id; pass null/undefined while there is none
 * (signed out, or before pairing/onboarding creates the couple). Skeleton: MOB-13 verifies the
 * two-device latency and MOB-12 adds typing presence.
 */
export function useCoupleRealtime(coupleId: string | null | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!coupleId) return undefined;
    return subscribeToCouple(supabase, queryClient, coupleId);
  }, [coupleId, queryClient]);
}
