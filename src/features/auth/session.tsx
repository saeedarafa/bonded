import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { subscribeToSession, type SessionUser } from '@/features/auth/api';
import { useEmailAuthLinks } from '@/features/auth/hooks';
import type { AppError } from '@/lib/errors';

export type SessionState =
  | { status: 'loading'; userId: null }
  | { status: 'signedOut'; userId: null }
  | { status: 'signedIn'; userId: string };

const LOADING: SessionState = { status: 'loading', userId: null };
const SessionContext = createContext<SessionState>(LOADING);
const EmailLinkErrorContext = createContext<{ error: AppError | null; dismiss: () => void }>({
  error: null,
  dismiss: () => {},
});

/**
 * The auth gate's source of truth (MOB-08): `loading` until Supabase has read the stored session,
 * then `signedIn` / `signedOut`. Token refreshes keep the same state object, so nothing re-renders.
 * The data layer signs out locally on any signed-out error (MOB-06) and that arrives here too.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const onLinkSession = useCallback((user: SessionUser) => setUserId(user.userId), []);
  const callback = useEmailAuthLinks(onLinkSession);

  useEffect(() => subscribeToSession((user) => setUserId(user?.userId ?? null)), []);

  const state = useMemo<SessionState>(() => {
    if (userId === undefined || callback.pending) return LOADING;
    if (userId === null) return { status: 'signedOut', userId: null };
    return { status: 'signedIn', userId };
  }, [userId, callback.pending]);

  return (
    <SessionContext.Provider value={state}>
      <EmailLinkErrorContext.Provider
        value={{ error: callback.error, dismiss: callback.clearError }}
      >
        {children}
      </EmailLinkErrorContext.Provider>
    </SessionContext.Provider>
  );
}

export function useEmailLinkError() {
  return useContext(EmailLinkErrorContext).error;
}

export function useDismissEmailLinkError() {
  return useContext(EmailLinkErrorContext).dismiss;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
