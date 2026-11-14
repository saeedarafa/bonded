import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect, useState, type ReactNode } from 'react';

import { clearDrafts } from '@/lib/drafts';
import { clearHttpCache } from '@/lib/httpCache';
import { clearOutbox } from '@/lib/outbox';
import { createMmkvPersister } from '@/lib/persister';
import {
  CACHE_BUSTER,
  CACHE_MAX_AGE_MS,
  createQueryClient,
  PERSIST_DEHYDRATE_OPTIONS,
  setupQueryManagers,
} from '@/lib/queryClient';
import { startAuthAutoRefresh, supabase } from '@/lib/supabase';
import { cacheStorage } from '@/lib/storage';

/**
 * Data layer provider (MOB-06): TanStack Query with the encrypted MMKV persister, online/focus
 * wiring, token auto-refresh, and the sign-out rules:
 * - any query/mutation failing with a signed-out error signs out locally (the auth gate, MOB-08,
 *   reacts to the session change);
 * - on SIGNED_OUT the in-memory and persisted cache are wiped, so the next user never sees the
 *   previous couple's data; answer drafts and reveal marks (src/lib/drafts.ts) go with it.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [{ queryClient, persister }] = useState(() => ({
    queryClient: createQueryClient({
      onSignedOut: () => void supabase.auth.signOut({ scope: 'local' }),
    }),
    persister: createMmkvPersister(cacheStorage),
  }));

  useEffect(() => {
    const stopManagers = setupQueryManagers();
    const stopRefresh = startAuthAutoRefresh();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        // MOB-89: first, so nothing below can skip it: drop what the OS HTTP cache still holds.
        clearHttpCache();
        queryClient.clear();
        void persister.removeClient();
        clearDrafts();
        clearOutbox();
      }
    });
    return () => {
      data.subscription.unsubscribe();
      stopRefresh();
      stopManagers();
    };
  }, [queryClient, persister]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE_MS,
        buster: CACHE_BUSTER,
        dehydrateOptions: PERSIST_DEHYDRATE_OPTIONS,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
