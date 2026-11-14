import type { ExpoConfig } from 'expo/config';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { signOut } from '@/features/auth/api';
import { wipeLocalAccount } from '@/features/settings/localData';
import { secureStore } from '@/lib/storage';

import { setWidgetModuleForTests } from '../bridge';
import {
  runWidgetRefreshTask,
  TASK_FAILED,
  TASK_SUCCESS,
  widgetRefreshTaskDefined,
} from '../backgroundRefresh';
import {
  registerWidgetRefresh,
  resetWidgetRefreshForTests,
  unregisterWidgetRefresh,
  WIDGET_REFRESH_INTERVAL_MINUTES,
  WIDGET_REFRESH_TASK,
} from '../backgroundTask';
import type { WidgetSnapshot } from '../snapshot';
import {
  forgetWidgetToken,
  readWidgetToken,
  refreshWidgetToken,
  resetWidgetTokensForTests,
  revokeWidgetTokensForSignOut,
  WIDGET_TOKEN_KEY,
  WIDGET_TOKEN_SERVICE,
  widgetDeviceId,
} from '../tokens';

/**
 * MOB-78b (SEC-21, CONTRACTS §2 `mint_widget_token`: "the app mints, the widget never does … in
 * BGAppRefreshTask / WorkManager"): the background task runs the foreground refresh path, never
 * throws or logs, is defined when the bundle loads, is on only while paired in a build with a
 * token reader, and goes off on every forget path.
 */

// defineTask runs while this file's imports load, before any `const` here is initialised.
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
const mockDefineTask = jest.requireMock<{ defineTask: jest.Mock }>('expo-task-manager').defineTask;
const mockRegisterTask = jest.fn((_name: string, _options: unknown) => Promise.resolve());
const mockUnregisterTask = jest.fn((_name: string) => Promise.resolve());
jest.mock('expo-background-task', () => ({
  registerTaskAsync: (name: string, options: unknown) => mockRegisterTask(name, options),
  unregisterTaskAsync: (name: string) => mockUnregisterTask(name),
}));

const mockRpc = jest.fn();
const mockGetSession = jest.fn();
const mockAuthSignOut = jest.fn((_args: unknown) => Promise.resolve({ error: null }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => mockRpc(name, args),
    auth: {
      getSession: () => mockGetSession(),
      signOut: (args: unknown) => mockAuthSignOut(args),
    },
  },
}));
jest.mock('@/features/push/registration', () => ({
  unregisterPushToken: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/features/premium/purchases', () => ({
  resetPurchaser: jest.fn(() => Promise.resolve()),
}));

// The executor passed to defineTask at import time (captured before beforeEach clears mocks).
const definedAtImport = mockDefineTask.mock.calls.map((c) => c as [string, () => Promise<number>]);

const TOKEN_A = `bwt_${'A'.repeat(43)}`;
const TOKEN_B = `bwt_${'B'.repeat(43)}`;
const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const setSnapshot = jest.fn<void, [string]>();
const snapshots = (): WidgetSnapshot[] =>
  setSnapshot.mock.calls.map(([json]) => JSON.parse(json) as WidgetSnapshot);

const signedIn = { data: { session: { access_token: 'jwt' } }, error: null };
const signedOutReply = { data: { session: null }, error: null };
const refreshFailed = { data: { session: null }, error: { message: 'Network request failed' } };
const mintReply = (token: string, expiresAt: number) => ({
  data: { token, expires_at: iso(expiresAt) },
  error: null,
});
const offline = { data: null, error: { message: 'Network request failed' } };
const notPaired = { data: null, error: { message: 'NOT_PAIRED', code: 'P0001' } };

async function store(token: string, expiresAt: number) {
  await widgetDeviceId();
  await SecureStore.setItemAsync(
    WIDGET_TOKEN_KEY,
    JSON.stringify({ token, expires_at: iso(expiresAt) }),
    { keychainService: WIDGET_TOKEN_SERVICE },
  );
}

const unregistered = () =>
  mockUnregisterTask.mock.calls.filter(([name]) => name === WIDGET_REFRESH_TASK).length;

beforeEach(async () => {
  jest.clearAllMocks();
  resetWidgetTokensForTests();
  resetWidgetRefreshForTests();
  secureStore().clearAll();
  await SecureStore.deleteItemAsync(WIDGET_TOKEN_KEY, { keychainService: WIDGET_TOKEN_SERVICE });
  Platform.OS = 'android';
  setWidgetModuleForTests({ setSnapshot, hasTokenReader: true });
  mockRpc.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue(signedIn);
});

afterAll(() => setWidgetModuleForTests(undefined));

describe('task definition (headless start)', () => {
  it('defineTask runs at import time, with the task name, before any React renders', () => {
    expect(widgetRefreshTaskDefined).toBe(true);
    expect(definedAtImport).toHaveLength(1);
    expect(definedAtImport[0]?.[0]).toBe(WIDGET_REFRESH_TASK);
    expect(WIDGET_REFRESH_TASK).toBe('bonded.widget.token-refresh');
  });

  it('the defined executor is the refresh task', async () => {
    mockGetSession.mockResolvedValue(signedOutReply);
    await expect(definedAtImport[0]?.[1]()).resolves.toBe(TASK_SUCCESS);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  it('the app entry imports the task module before expo-router, the root layout imports it too', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };
    const pkg = require('../../../../package.json') as { main: string };
    expect(pkg.main).toBe('index.ts');
    const entry = fs
      .readFileSync(`${process.cwd()}/index.ts`, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('import'));
    expect(entry).toEqual([
      "import './src/features/widgets/backgroundRefresh';",
      "import 'expo-router/entry';",
    ]);
    const layout = fs.readFileSync(`${process.cwd()}/app/_layout.tsx`, 'utf8');
    expect(layout).toContain("import '@/features/widgets/backgroundRefresh';");
  });
});

describe('task body', () => {
  it('signed in and paired, less than 24 h left: mints and stores the new token', async () => {
    await store(TOKEN_A, Date.now() + 10 * HOUR);
    mockRpc.mockResolvedValue(mintReply(TOKEN_B, Date.now() + 48 * HOUR));
    await expect(runWidgetRefreshTask()).resolves.toBe(TASK_SUCCESS);
    expect(mockRpc).toHaveBeenCalledWith('mint_widget_token', {
      p_device_id: expect.any(String),
    });
    await expect(readWidgetToken()).resolves.toMatchObject({ token: TOKEN_B });
    expect(unregistered()).toBe(0);
  });

  it('more than 24 h left: keeps the token, no mint', async () => {
    await store(TOKEN_A, Date.now() + 40 * HOUR);
    await expect(runWidgetRefreshTask()).resolves.toBe(TASK_SUCCESS);
    expect(mockRpc).not.toHaveBeenCalled();
    await expect(readWidgetToken()).resolves.toMatchObject({ token: TOKEN_A });
  });

  it('no session (signed out while closed): deletes the token, blanks the widgets, unregisters', async () => {
    await store(TOKEN_A, Date.now() + 40 * HOUR);
    mockGetSession.mockResolvedValue(signedOutReply);
    await expect(runWidgetRefreshTask()).resolves.toBe(TASK_SUCCESS);
    await expect(readWidgetToken()).resolves.toBeNull();
    expect(snapshots().at(-1)?.state).toBe('none');
    expect(unregistered()).toBe(1);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('NOT_PAIRED (unpaired while closed): deletes the token and unregisters', async () => {
    await store(TOKEN_A, Date.now() + 10 * HOUR);
    mockRpc.mockResolvedValue(notPaired);
    await expect(runWidgetRefreshTask()).resolves.toBe(TASK_SUCCESS);
    await expect(readWidgetToken()).resolves.toBeNull();
    expect(unregistered()).toBe(1);
  });

  it('offline mint: keeps a token that still works, reports Failed, stays registered', async () => {
    await store(TOKEN_A, Date.now() + 10 * HOUR);
    mockRpc.mockResolvedValue(offline);
    await expect(runWidgetRefreshTask()).resolves.toBe(TASK_FAILED);
    await expect(readWidgetToken()).resolves.toMatchObject({ token: TOKEN_A });
    expect(unregistered()).toBe(0);
  });

  it.each([
    ['the session refresh failed (offline)', () => mockGetSession.mockResolvedValue(refreshFailed)],
    ['getSession threw', () => mockGetSession.mockRejectedValue(new Error('storage'))],
  ])('%s: keeps the token, no mint, Failed', async (_name, arrange) => {
    await store(TOKEN_A, Date.now() + 10 * HOUR);
    arrange();
    await expect(runWidgetRefreshTask()).resolves.toBe(TASK_FAILED);
    await expect(readWidgetToken()).resolves.toMatchObject({ token: TOKEN_A });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(unregistered()).toBe(0);
  });

  it('a build without a token reader: no session read, no mint, unregisters itself', async () => {
    setWidgetModuleForTests({ setSnapshot });
    await expect(runWidgetRefreshTask()).resolves.toBe(TASK_SUCCESS);
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(unregistered()).toBe(1);
  });

  it('never throws, whatever fails', async () => {
    setWidgetModuleForTests({
      setSnapshot,
      get hasTokenReader(): boolean {
        throw new Error('native crash');
      },
    });
    await expect(runWidgetRefreshTask()).resolves.toBe(TASK_FAILED);

    setWidgetModuleForTests({ setSnapshot, hasTokenReader: true });
    mockRpc.mockRejectedValue(new Error('boom'));
    await expect(runWidgetRefreshTask()).resolves.toBe(TASK_FAILED);

    mockGetSession.mockResolvedValue(signedOutReply);
    mockUnregisterTask.mockRejectedValueOnce(new Error('no scheduler'));
    (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(new Error('no keychain'));
    await expect(runWidgetRefreshTask()).resolves.toBe(TASK_SUCCESS);
  });

  it('logs nothing and sends nothing anywhere but the mint RPC', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      await store(TOKEN_A, Date.now() + 10 * HOUR);
      mockRpc.mockResolvedValueOnce(mintReply(TOKEN_B, Date.now() + 48 * HOUR));
      await runWidgetRefreshTask();
      mockRpc.mockResolvedValueOnce(offline);
      resetWidgetTokensForTests();
      await store(TOKEN_A, Date.now() + 10 * HOUR);
      await runWidgetRefreshTask();
      mockGetSession.mockResolvedValue(signedOutReply);
      await runWidgetRefreshTask();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(new Set(mockRpc.mock.calls.map(([name]) => name))).toEqual(
        new Set(['mint_widget_token']),
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('source: no analytics, crash reports or console in the task modules', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };
    for (const file of ['backgroundRefresh.ts', 'backgroundTask.ts']) {
      const code = fs
        .readFileSync(`${process.cwd()}/src/features/widgets/${file}`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code).not.toMatch(/console\.|analytics|crashReports|Sentry|posthog|breadcrumb/i);
    }
  });
});

describe('registration', () => {
  it('registers the task with a 6 h minimum interval', async () => {
    await expect(registerWidgetRefresh()).resolves.toBe(true);
    expect(mockRegisterTask).toHaveBeenCalledWith(WIDGET_REFRESH_TASK, {
      minimumInterval: WIDGET_REFRESH_INTERVAL_MINUTES,
    });
    expect(WIDGET_REFRESH_INTERVAL_MINUTES).toBe(360);
    // WorkManager's floor is 15 minutes; 6 h leaves at least one run in the 24 h refresh window.
    expect(WIDGET_REFRESH_INTERVAL_MINUTES).toBeGreaterThanOrEqual(15);
    expect(WIDGET_REFRESH_INTERVAL_MINUTES * 60 * 1000).toBeLessThan((24 * HOUR) / 3);
  });

  it('a scheduler error resolves false / quietly, never throws', async () => {
    mockRegisterTask.mockRejectedValueOnce(new Error('Task not defined'));
    await expect(registerWidgetRefresh()).resolves.toBe(false);
    mockUnregisterTask.mockRejectedValueOnce(new Error('not registered'));
    await expect(unregisterWidgetRefresh()).resolves.toBeUndefined();
  });

  it('web: a no-op', async () => {
    Platform.OS = 'web';
    resetWidgetRefreshForTests();
    await expect(registerWidgetRefresh()).resolves.toBe(false);
    await unregisterWidgetRefresh();
    expect(mockRegisterTask).not.toHaveBeenCalled();
    expect(mockUnregisterTask).not.toHaveBeenCalled();
  });

  it('a sign-out right after a register is applied after it (calls run in order)', async () => {
    let release: () => void = () => undefined;
    mockRegisterTask.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const order: string[] = [];
    mockUnregisterTask.mockImplementationOnce(() => {
      order.push('unregister');
      return Promise.resolve();
    });
    const registering = registerWidgetRefresh().then(() => order.push('register'));
    const forgetting = forgetWidgetToken();
    await Promise.resolve();
    expect(mockUnregisterTask).not.toHaveBeenCalled();
    release();
    await Promise.all([registering, forgetting]);
    expect(order).toEqual(['register', 'unregister']);
  });
});

describe('every forget path turns the background refresh off', () => {
  it.each<[string, () => Promise<unknown>]>([
    [
      'forgetWidgetToken (unpair, ended or solo couple from useWidgetToken)',
      () => forgetWidgetToken(),
    ],
    ['sign-out revoke step', () => revokeWidgetTokensForSignOut(10)],
    ['signOut()', () => signOut().catch(() => undefined)],
    ['delete account / wipeLocalAccount', () => wipeLocalAccount()],
    [
      'a foreground refresh that gets NOT_PAIRED',
      () => {
        mockRpc.mockResolvedValue(notPaired);
        return refreshWidgetToken();
      },
    ],
  ])('%s', async (_name, run) => {
    await store(TOKEN_A, Date.now() + 10 * HOUR);
    mockRpc.mockResolvedValue({ data: null, error: null });
    await run();
    expect(unregistered()).toBeGreaterThanOrEqual(1);
    await expect(readWidgetToken()).resolves.toBeNull();
  });
});

describe('config plugin (iOS BGTaskScheduler, Android WorkManager)', () => {
  function appConfig(): ExpoConfig {
    let config: ExpoConfig | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../../../../app.config') as {
        default: (ctx: { config: Partial<ExpoConfig> }) => ExpoConfig;
      };
      config = mod.default({ config: {} });
    });
    return config as ExpoConfig;
  }

  it('lists expo-background-task, not expo-task-manager (no UIBackgroundModes fetch)', () => {
    const names = (appConfig().plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toContain('expo-background-task');
    expect(names).not.toContain('expo-task-manager');
  });

  it('Info.plist: UIBackgroundModes processing + the permitted identifier, no fetch or audio', async () => {
    type InfoPlist = Record<string, unknown>;
    type Mod = (c: ExpoConfig & { modResults: InfoPlist; modRequest: unknown }) => Promise<{
      modResults: InfoPlist;
    }>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { withPlugins } = require('expo/config-plugins') as {
      withPlugins: (config: ExpoConfig, plugins: unknown[]) => ExpoConfig & { mods?: unknown };
    };
    const base = appConfig();
    const config = withPlugins(
      { ...base, _internal: { projectRoot: process.cwd() } } as ExpoConfig,
      base.plugins ?? [],
    ) as ExpoConfig & { mods?: { ios?: { infoPlist?: Mod } } };
    const mod = config.mods?.ios?.infoPlist;
    if (!mod) throw new Error('no ios.infoPlist mod');
    const result = await mod({
      ...config,
      modResults: {},
      modRequest: {
        projectRoot: process.cwd(),
        platformProjectRoot: `${process.cwd()}/ios`,
        platform: 'ios',
        modName: 'infoPlist',
        introspect: true,
      },
    });
    expect(result.modResults.UIBackgroundModes).toContain('processing');
    expect(result.modResults.UIBackgroundModes).not.toContain('fetch');
    expect(result.modResults.UIBackgroundModes).not.toContain('audio');
    expect(result.modResults.BGTaskSchedulerPermittedIdentifiers).toEqual([
      'com.expo.modules.backgroundtask.processing',
    ]);
  });
});
