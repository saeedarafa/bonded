// QA-07: module fakes for the a11y suite (runs after the app's own src/test/setup.ts).
// - Every feature api.ts keeps its constants and pure helpers, but each network function is
//   replaced by the fake in world.ts. A function with no fake is recorded in `world.unfaked` and
//   rejects, so a new api call shows up as a failing "no unfaked calls" check, never as a hang.
// - The theme follows `mode` (scheme + font scale) for the whole app tree, like a phone set to
//   dark mode or 200% text.
// - Date is pinned to NOW (see below); renderRouter() brings its own fake timers.
/* eslint-disable @typescript-eslint/no-require-imports */
import { mode } from './mode';
import { NOW } from './world';

// Date is pinned to NOW with a Date subclass (no-argument constructor and Date.now() return NOW),
// so module code and world setup see NOW before any render. renderRouter() then installs Jest's
// fake timers itself and pins the fake clock to Date.now() (= NOW); the tests advance that clock.
{
  const RealDate = Date;
  const fixed = new RealDate(NOW).getTime();
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed);
      else super(...(args as [string | number | Date]));
    }
    static override now() {
      return fixed;
    }
  }
  globalThis.Date = FixedDate as DateConstructor;
}

// No request leaves the test: anything that bypasses the fakes fails loudly.
globalThis.fetch = (() =>
  Promise.reject(new Error('qa/a11y: network is disabled; fake the api call in world.ts'))) as never;

function mockFakeModule(path: string, actual: Record<string, unknown>) {
  const { fakes, world } = require('./world') as typeof import('./world');
  const own = fakes[path] ?? {};
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => {
      if (name in own) return [name, own[name]];
      if (typeof value !== 'function' || !/^[a-z]/.test(name)) return [name, value];
      // Pure helpers stay real; anything that would reach Supabase is recorded.
      return [
        name,
        (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown)(...args);
          if (result instanceof Promise) {
            result.catch(() => undefined);
            world.unfaked.push(`${path}.${name}`);
            return Promise.reject(new Error(`qa/a11y: ${path}.${name} is not faked`));
          }
          return result;
        },
      ];
    }),
  );
}

jest.mock('@/features/auth/api', () =>
  mockFakeModule('@/features/auth/api', jest.requireActual('@/features/auth/api')),
);
jest.mock('@/features/couple/api', () =>
  mockFakeModule('@/features/couple/api', jest.requireActual('@/features/couple/api')),
);
jest.mock('@/features/profile/api', () =>
  mockFakeModule('@/features/profile/api', jest.requireActual('@/features/profile/api')),
);
jest.mock('@/features/premium/api', () =>
  mockFakeModule('@/features/premium/api', jest.requireActual('@/features/premium/api')),
);
jest.mock('@/features/daily/api', () =>
  mockFakeModule('@/features/daily/api', jest.requireActual('@/features/daily/api')),
);
jest.mock('@/features/history/api', () =>
  mockFakeModule('@/features/history/api', jest.requireActual('@/features/history/api')),
);
jest.mock('@/features/badges/api', () =>
  mockFakeModule('@/features/badges/api', jest.requireActual('@/features/badges/api')),
);
jest.mock('@/features/packs/api', () =>
  mockFakeModule('@/features/packs/api', jest.requireActual('@/features/packs/api')),
);
jest.mock('@/features/thread/api', () =>
  mockFakeModule('@/features/thread/api', jest.requireActual('@/features/thread/api')),
);
jest.mock('@/features/pairing/api', () =>
  mockFakeModule('@/features/pairing/api', jest.requireActual('@/features/pairing/api')),
);
jest.mock('@/features/recap/api', () =>
  mockFakeModule('@/features/recap/api', jest.requireActual('@/features/recap/api')),
);
jest.mock('@/features/feedback/api', () =>
  mockFakeModule('@/features/feedback/api', jest.requireActual('@/features/feedback/api')),
);
jest.mock('@/features/keyDates/api', () =>
  mockFakeModule('@/features/keyDates/api', jest.requireActual('@/features/keyDates/api')),
);
jest.mock('@/features/push/api', () =>
  mockFakeModule('@/features/push/api', jest.requireActual('@/features/push/api')),
);
jest.mock('@/features/settings/api', () =>
  mockFakeModule('@/features/settings/api', jest.requireActual('@/features/settings/api')),
);

// The OS notification permission follows world.permission (41's card; 09/J6 read it too).
{
  const { world } = require('./world') as typeof import('./world');
  (jest.requireMock('expo-notifications') as { getPermissionsAsync: jest.Mock }).getPermissionsAsync.mockImplementation(
    () =>
      Promise.resolve({
        status: world.permission,
        granted: world.permission === 'granted',
        canAskAgain: world.permission === 'undetermined',
        expires: 'never',
      }),
  );
}

// QA-32 (58, MOB-27): no print web view or share sheet in Node (as in src/test/setup.ts, but
// owned here so the suite does not depend on it). Printing follows world.printFails; the HTML
// handed to expo-print is the only place answer text may go.
jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn(() => {
    const { world: w } = require('./world') as typeof import('./world');
    return w.printFails
      ? Promise.reject(new Error('print failed: file:///cache/Print/history.pdf'))
      : Promise.resolve({ uri: 'file:///cache/Print/history.pdf' });
  }),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

// No websocket in Node.
jest.mock('@/lib/useCoupleRealtime', () => ({
  useCoupleRealtime: () => undefined,
  sendTypingSignal: () => undefined,
}));
jest.mock('@/lib/useJoinRequestRealtime', () => ({ useJoinRequestRealtime: () => undefined }));

// The whole app follows `mode`, as a phone in dark mode / at 200% text would: the system scheme
// (useColorScheme, read by the real ThemeProvider and so by the navigation theme too) is
// `mode.scheme`, and the type scale is `mode.fontScale` (FontScaleOverride, the same scaling
// the gallery uses for Dynamic Type).
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => {
  const { mode: m } = require('./mode') as typeof import('./mode');
  return { __esModule: true, default: () => m.scheme };
});
jest.mock('@/ui/ThemeProvider', () => {
  const actual = jest.requireActual<typeof import('@/ui/ThemeProvider')>('@/ui/ThemeProvider');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { mode: m } = require('./mode') as typeof import('./mode');
  return {
    ...actual,
    ThemeProvider: ({ children }: { children: React.ReactNode }) =>
      createElement(
        actual.ThemeProvider,
        null,
        createElement(actual.FontScaleOverride, { scale: m.fontScale, children }),
      ),
  };
});

void mode;
