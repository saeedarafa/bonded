// Jest setup (MOB-06): fake public env and native-module stand-ins, so anything that imports the
// data layer can run in Node. Real behaviour is checked on devices; logic is tested directly.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

jest.mock('react-native-nitro-modules', () => ({ NitroModules: {} }));

// react-native-reanimated is replaced by src/test/reanimated-stub.tsx through moduleNameMapper (package.json).

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

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

// Sign-in native modules (MOB-08): no native side in Node. Tests that care mock `features/auth/api`.
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  signInAsync: jest.fn(),
  AppleAuthenticationButton: 'AppleAuthenticationButton',
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  AppleAuthenticationButtonType: { CONTINUE: 0 },
  AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(), signIn: jest.fn() },
  isErrorWithCode: (e: unknown) => typeof (e as { code?: unknown })?.code === 'string',
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7 + 1),
  digestStringAsync: jest.fn((_algorithm: string, value: string) => Promise.resolve(`h(${value})`)),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: (() => {
    let n = 0;
    return () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`;
  })(),
}));
