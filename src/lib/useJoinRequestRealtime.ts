import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { subscribeToJoinRequest } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';

/**
 * BE-26, the joiner: Realtime on my own `join_requests` row while it waits for the inviter. Events
 * only refetch it (src/lib/realtime.ts). Pass null when there is no request.
 */
export function useJoinRequestRealtime(requestId: string | null | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!requestId) return undefined;
    return subscribeToJoinRequest(supabase, queryClient, requestId);
  }, [requestId, queryClient]);
}
