// Jest setup (MOB-06): fake public env and native-module stand-ins, so anything that imports the
// data layer can run in Node. Real behaviour is checked on devices; logic is tested directly.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

jest.mock('react-native-nitro-modules', () => ({ NitroModules: {} }));

jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
});

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7 + 1),
}));
