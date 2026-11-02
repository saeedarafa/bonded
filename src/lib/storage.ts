import { getRandomBytes } from 'expo-crypto';
import { getItem, setItem } from 'expo-secure-store';
import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * Encrypted on-device key-value store (MOB-06).
 *
 * The TanStack Query cache holds answers and thread messages, and the Supabase session holds
 * tokens, so both live in one MMKV instance encrypted with AES-256. The key is generated once,
 * kept in the platform keychain/keystore (expo-secure-store) and never leaves the device.
 *
 * MMKV is a native module (Nitro): it needs a development build or EAS build, not Expo Go.
 * Created lazily so importing this file (and the tests) has no side effects.
 */
const KEY_NAME = 'bonded.storage.key';
const STORE_ID = 'bonded.secure';

function storageKey(): string {
  const existing = getItem(KEY_NAME);
  if (existing) return existing;
  // 16 random bytes as 32 hex characters = a 32-byte AES-256 key.
  const key = Array.from(getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
  setItem(KEY_NAME, key);
  return key;
}

let instance: MMKV | undefined;

export function secureStore(): MMKV {
  instance ??= createMMKV({ id: STORE_ID, encryptionKey: storageKey(), encryptionType: 'AES-256' });
  return instance;
}

/** Minimal sync key-value shape: what the Supabase auth client and the query persister need. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type StringStore = Pick<MMKV, 'getString' | 'set' | 'remove'>;

export function createKeyValueStorage(
  prefix: string,
  store: () => StringStore = secureStore,
): KeyValueStorage {
  return {
    getItem: (key) => store().getString(`${prefix}${key}`) ?? null,
    setItem: (key, value) => store().set(`${prefix}${key}`, value),
    removeItem: (key) => {
      store().remove(`${prefix}${key}`);
    },
  };
}

/** Supabase session storage. */
export const authStorage: KeyValueStorage = createKeyValueStorage('auth:');
/** TanStack Query persisted cache storage. */
export const cacheStorage: KeyValueStorage = createKeyValueStorage('cache:');
