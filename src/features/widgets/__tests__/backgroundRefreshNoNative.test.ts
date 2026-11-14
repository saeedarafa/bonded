import { Platform } from 'react-native';

import type * as BackgroundTaskModule from '../backgroundTask';

/**
 * MOB-78b: a binary without the expo-task-manager / expo-background-task native modules (Expo Go,
 * an older build running a newer update) must still start: the task module is imported by the app
 * entry, so importing it never throws, and registering is a quiet no-op.
 */

jest.mock('expo-task-manager', () => {
  throw new Error("Cannot find native module 'ExpoTaskManager'");
});
jest.mock('expo-background-task', () => {
  throw new Error("Cannot find native module 'ExpoBackgroundTask'");
});
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), auth: {} } }));

beforeEach(() => {
  Platform.OS = 'android';
});

it('importing the task module never throws; nothing is defined', () => {
  let defined: boolean | undefined;
  expect(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    defined = (require('../backgroundRefresh') as { widgetRefreshTaskDefined: boolean })
      .widgetRefreshTaskDefined;
  }).not.toThrow();
  expect(defined).toBe(false);
});

it('register and unregister resolve quietly', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../backgroundTask') as typeof BackgroundTaskModule;
  await expect(mod.registerWidgetRefresh()).resolves.toBe(false);
  await expect(mod.unregisterWidgetRefresh()).resolves.toBeUndefined();
});
