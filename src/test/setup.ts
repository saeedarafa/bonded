import type * as ReactModule from 'react';
import type * as RNModule from 'react-native';

// Jest setup (MOB-06): fake public env and native-module stand-ins, so anything that imports the
// data layer can run in Node. Real behaviour is checked on devices; logic is tested directly.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

jest.mock('react-native-nitro-modules', () => ({ NitroModules: {} }));

// Reanimated 4's own Jest mock pulls in the native runtime; the components only use this small
// surface, so a hand-written stand-in is simpler and deterministic. Animations jump to their end
// value; behaviour that depends on time is driven by JS timers in the component and tested there.
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const { View } = jest.requireActual<typeof RNModule>('react-native');
  const end = <T>(value: T): T => value;
  const animation = (value: unknown) => value;
  const createAnimatedComponent = <T>(component: T) => component;
  return {
    __esModule: true,
    default: { View, createAnimatedComponent },
    View,
    createAnimatedComponent,
    useAnimatedProps: (factory: () => object) => factory(),
    useSharedValue: <T>(initial: T) => React.useRef({ value: initial }).current,
    useAnimatedStyle: (factory: () => object) => factory(),
    withTiming: animation,
    withSpring: animation,
    withDelay: (_ms: number, value: unknown) => value,
    withRepeat: animation,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    cancelAnimation: () => undefined,
    runOnJS: <T>(fn: T) => fn,
    interpolate: end,
    Easing: {
      linear: 'linear',
      bezier: () => 'bezier',
      out: end,
      inOut: end,
      ease: 'ease',
    },
  };
});

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

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7 + 1),
}));
