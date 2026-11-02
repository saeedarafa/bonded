import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

import type { KeyValueStorage } from '@/lib/storage';

const STORAGE_KEY = 'query-cache';

/**
 * TanStack Query persister over (encrypted) MMKV (MOB-06). Writes are throttled (trailing, so the
 * last state always lands) because the cache changes on every fetch. Reading never throws: a
 * corrupt or old-shape cache is dropped and the app just refetches.
 */
export function createMmkvPersister(storage: KeyValueStorage, throttleMs = 1000): Persister {
  let pending: PersistedClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    if (!pending) return;
    const client = pending;
    pending = undefined;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(client));
    } catch {
      // Storage full or unavailable: the cache is an optimisation, not a source of truth.
    }
  };

  return {
    persistClient: (client) => {
      pending = client;
      timer ??= setTimeout(flush, throttleMs);
    },
    restoreClient: () => {
      try {
        const raw = storage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as PersistedClient) : undefined;
      } catch {
        storage.removeItem(STORAGE_KEY);
        return undefined;
      }
    },
    removeClient: () => {
      pending = undefined;
      if (timer) clearTimeout(timer);
      timer = undefined;
      storage.removeItem(STORAGE_KEY);
    },
  };
}
