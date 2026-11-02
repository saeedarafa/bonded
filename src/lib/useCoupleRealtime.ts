import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { sendTyping, subscribeToCouple, type TypingPayload } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';
import { useTyping } from '@/lib/typing';

const markTyping = useTyping.getState().mark;

/**
 * Subscribes to the couple's realtime channel while mounted (CONTRACTS §2). Any number of screens
 * may mount it with the same couple id: they share one channel. Pass null/undefined while there is
 * none (signed out, or before onboarding creates the couple). Typing signals (D15) land in
 * `useTyping`.
 */
export function useCoupleRealtime(coupleId: string | null | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!coupleId) return undefined;
    return subscribeToCouple(supabase, queryClient, coupleId, (p) => markTyping(p));
  }, [coupleId, queryClient]);
}

/** D15: tells the partner I'm typing in this thread (the Composer throttles it to every 3 s). */
export function sendTypingSignal(coupleId: string, payload: TypingPayload): void {
  sendTyping(supabase, coupleId, payload);
}
