import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { subscribeToSession } from '@/features/auth/api';

export type SessionState =
  | { status: 'loading'; userId: null }
  | { status: 'signedOut'; userId: null }
  | { status: 'signedIn'; userId: string };

const LOADING: SessionState = { status: 'loading', userId: null };
const SessionContext = createContext<SessionState>(LOADING);

/**
 * The auth gate's source of truth (MOB-08): `loading` until Supabase has read the stored session,
 * then `signedIn` / `signedOut`. Token refreshes keep the same state object, so nothing re-renders.
 * The data layer signs out locally on any signed-out error (MOB-06) and that arrives here too.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => subscribeToSession((user) => setUserId(user?.userId ?? null)), []);

  const state = useMemo<SessionState>(() => {
    if (userId === undefined) return LOADING;
    if (userId === null) return { status: 'signedOut', userId: null };
    return { status: 'signedIn', userId };
  }, [userId]);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
