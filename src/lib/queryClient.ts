import NetInfo from '@react-native-community/netinfo';
import {
  defaultShouldDehydrateQuery,
  focusManager,
  MutationCache,
  onlineManager,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { toAppError } from '@/lib/errors';

/** Persisted cache lives this long; `gcTime` must be at least as long or restored data is collected. */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Bump to throw away every device's persisted cache (shape change). v2 (MOB-40): drops any cache
 * an earlier build wrote with a paused, token-bearing invite preview in it (#79 security review).
 */
export const CACHE_BUSTER = 'v2';

/**
 * What the persister writes to disk: successful queries only (not RevenueCat offerings), never mutations. No mutation here
 * is resumed after a restart (none has a `mutationKey` default), and mutation variables can carry
 * bearer data such as an invite link token (#38, #79 security review), so a paused or finished
 * mutation must never reach the persisted cache.
 */
export const PERSIST_DEHYDRATE_OPTIONS = {
  shouldDehydrateMutation: () => false,
  // RevenueCat offerings (MOB-19) are never written to disk: a restored cache must never show an
  // old price (D31). They are cheap to load again from the SDK. Nor are the paywall's offer clocks
  // (MOB-22): a restored, since-expired clock must never show an offer before the server is read.
  shouldDehydrateQuery: (query: Parameters<typeof defaultShouldDehydrateQuery>[0]) =>
    defaultShouldDehydrateQuery(query) &&
    query.queryKey[0] !== 'purchases' &&
    !(query.queryKey[0] === 'offer' && query.queryKey[1] === 'clocks'),
} as const;

export interface QueryClientOptions {
  /**
   * Called once when any query or mutation fails because the session is gone (NOT_AUTHENTICATED,
   * 42501, expired JWT). The app signs out locally; the auth gate (MOB-08) then shows auth.
   */
  onSignedOut?: () => void;
}

/**
 * The app's QueryClient (MOB-06).
 * - Definite backend answers (every `error_code`) are never retried; only NETWORK/UNKNOWN, twice.
 * - Errors are normalised to AppError in api.ts (`unwrap`), and a signed-out error anywhere
 *   triggers `onSignedOut`.
 * - No answer or message text is logged here or anywhere in the data layer.
 */
export function createQueryClient({ onSignedOut }: QueryClientOptions = {}): QueryClient {
  let lastSignOutAt = 0;
  const handle = (error: unknown) => {
    // One sign-out per burst: several queries usually fail together when the session dies.
    if (Date.now() - lastSignOutAt < 2000 || !toAppError(error).signedOut) return;
    lastSignOutAt = Date.now();
    onSignedOut?.();
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: CACHE_MAX_AGE_MS,
        refetchOnReconnect: true,
        retry: (failureCount, error) => toAppError(error).retryable && failureCount < 2,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * Wire TanStack Query to React Native: online state from NetInfo, focus from AppState, so
 * coming back to the app or the network refetches stale data. Returns a cleanup function.
 */
export function setupQueryManagers(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    }),
  );

  if (Platform.OS === 'web') return () => undefined;
  const sub = AppState.addEventListener('change', (status) => {
    focusManager.setFocused(status === 'active');
  });
  return () => sub.remove();
}
