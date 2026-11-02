import type { PersistedClient } from '@tanstack/react-query-persist-client';

import { createMmkvPersister } from '@/lib/persister';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const client = (n: number): PersistedClient => ({
  timestamp: n,
  buster: 'v1',
  clientState: { mutations: [], queries: [] },
});

describe('MMKV persister', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('throttles writes and keeps the last state', async () => {
    const storage = memoryStorage();
    const setItem = jest.spyOn(storage, 'setItem');
    const persister = createMmkvPersister(storage, 1000);
    persister.persistClient(client(1));
    persister.persistClient(client(2));
    persister.persistClient(client(3));
    expect(setItem).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(await persister.restoreClient()).toEqual(client(3));
  });

  it('restores nothing from an empty store, and drops a corrupt cache', async () => {
    const storage = memoryStorage();
    const persister = createMmkvPersister(storage);
    expect(await persister.restoreClient()).toBeUndefined();
    storage.data.set('query-cache', '{not json');
    expect(await persister.restoreClient()).toBeUndefined();
    expect(storage.data.size).toBe(0);
  });

  it('removeClient clears storage and cancels a pending write', async () => {
    const storage = memoryStorage();
    const persister = createMmkvPersister(storage, 1000);
    persister.persistClient(client(1));
    jest.advanceTimersByTime(1000);
    persister.persistClient(client(2));
    await persister.removeClient();
    jest.advanceTimersByTime(5000);
    expect(storage.data.size).toBe(0);
  });

  it('survives a failing write', () => {
    const storage = memoryStorage();
    jest.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('disk full');
    });
    const persister = createMmkvPersister(storage, 10);
    persister.persistClient(client(1));
    expect(() => jest.advanceTimersByTime(10)).not.toThrow();
  });
});

describe('key-value storage over MMKV', () => {
  it('prefixes keys so auth and cache never collide', () => {
    const real = new Map<string, string>();
    const fake = {
      getString: (k: string) => real.get(k),
      set: (k: string, v: string) => void real.set(k, v),
      remove: (k: string) => real.delete(k),
    };
    const auth = createKeyValueStorage('auth:', () => fake);
    const cache = createKeyValueStorage('cache:', () => fake);
    auth.setItem('session', 'a');
    cache.setItem('session', 'b');
    expect(auth.getItem('session')).toBe('a');
    expect(cache.getItem('session')).toBe('b');
    expect(auth.getItem('missing')).toBeNull();
    auth.removeItem('session');
    expect(auth.getItem('session')).toBeNull();
    expect(cache.getItem('session')).toBe('b');
  });
});
