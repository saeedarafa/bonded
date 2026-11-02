import { getItem } from 'expo-secure-store';

import { authStorage, cacheStorage, secureStore } from '@/lib/storage';

describe('secure storage (MMKV mock in Jest)', () => {
  it('generates a 32-byte key once and keeps it in the keychain', () => {
    expect(getItem('bonded.storage.key')).toBeNull();
    secureStore();
    const key = getItem('bonded.storage.key');
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(secureStore()).toBe(secureStore());
    expect(getItem('bonded.storage.key')).toBe(key);
  });

  it('keeps auth and cache entries apart in the same store', () => {
    authStorage.setItem('k', 'session');
    cacheStorage.setItem('k', 'cache');
    expect(authStorage.getItem('k')).toBe('session');
    expect(cacheStorage.getItem('k')).toBe('cache');
    authStorage.removeItem('k');
    expect(authStorage.getItem('k')).toBeNull();
    expect(cacheStorage.getItem('k')).toBe('cache');
  });
});
