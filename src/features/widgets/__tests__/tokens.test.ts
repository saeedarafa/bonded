import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { signOut } from '@/features/auth/api';
import { wipeLocalAccount } from '@/features/settings/localData';
import { secureStore } from '@/lib/storage';

import { mintWidgetToken } from '../api';
import { setWidgetModuleForTests } from '../bridge';
import type { WidgetSnapshot } from '../snapshot';
import {
  canHoldWidgetToken,
  forgetWidgetToken,
  readWidgetToken,
  refreshWidgetToken,
  resetWidgetTokensForTests,
  revokeWidgetTokensForSignOut,
  WIDGET_TOKEN_KEY,
  WIDGET_TOKEN_SERVICE,
  widgetDeviceId,
} from '../tokens';

/** MOB-77 (BE-60, BE-60b, SEC-21): the widget token lives only in the keychain and dies on sign-out. */

const mockRpc = jest.fn();
const mockAuthSignOut = jest.fn((_args: unknown) => Promise.resolve({ error: null }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => mockRpc(name, args),
    auth: { signOut: (args: unknown) => mockAuthSignOut(args) },
  },
}));
jest.mock('@/features/push/registration', () => ({
  unregisterPushToken: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/features/premium/purchases', () => ({
  resetPurchaser: jest.fn(() => Promise.resolve()),
}));
jest.mock('../reload', () => ({ requestWidgetReload: jest.fn() }));
const mockReload = jest.requireMock<{ requestWidgetReload: jest.Mock }>(
  '../reload',
).requestWidgetReload;

const TOKEN_A = `bwt_${'A'.repeat(43)}`;
const TOKEN_B = `bwt_${'b'.repeat(40)}-_9`;
const GROUP = 'TEAMID.com.hellobonded.app.widget';
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-11-14T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

const setSnapshot = jest.fn<void, [string]>();
const snapshots = (): WidgetSnapshot[] =>
  setSnapshot.mock.calls.map(([json]) => JSON.parse(json) as WidgetSnapshot);

const getItemAsync = SecureStore.getItemAsync as jest.Mock;
const setItemAsync = SecureStore.setItemAsync as jest.Mock;
const deleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;

/** A token minted earlier by this install (the install id exists). */
async function store(token: string, expiresAt: number) {
  await widgetDeviceId();
  await storeRaw(token, expiresAt);
}

async function storeRaw(token: string, expiresAt: number) {
  await SecureStore.setItemAsync(
    WIDGET_TOKEN_KEY,
    JSON.stringify({ token, expires_at: iso(expiresAt) }),
    { keychainService: WIDGET_TOKEN_SERVICE },
  );
}

const mintReply = (token: string, expiresAt: number) => ({
  data: { token, expires_at: iso(expiresAt) },
  error: null,
});
const offline = { data: null, error: { message: 'Network request failed' } };

/** Every string written anywhere except the keychain item: must never hold a token. */
function writtenOutsideKeychain(): string {
  const mmkv = secureStore();
  const values = mmkv.getAllKeys().map((k) => `${k}=${mmkv.getString(k) ?? ''}`);
  return [...values, ...setSnapshot.mock.calls.map(([json]) => json)].join('\n');
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetWidgetTokensForTests();
  secureStore().clearAll();
  await SecureStore.deleteItemAsync(WIDGET_TOKEN_KEY, { keychainService: WIDGET_TOKEN_SERVICE });
  Platform.OS = 'ios';
  setWidgetModuleForTests({ setSnapshot, keychainAccessGroup: GROUP, hasTokenReader: true });
  mockRpc.mockReset();
});

afterAll(() => setWidgetModuleForTests(undefined));

describe('where the token may live', () => {
  it('mints only in a build whose widget can read it', () => {
    expect(canHoldWidgetToken()).toBe(true);
    // iOS module without the shared keychain group
    setWidgetModuleForTests({ setSnapshot, hasTokenReader: true });
    expect(canHoldWidgetToken()).toBe(false);
    // iOS group set but no token reader (free widgets only)
    setWidgetModuleForTests({ setSnapshot, keychainAccessGroup: GROUP });
    expect(canHoldWidgetToken()).toBe(false);
    Platform.OS = 'android';
    setWidgetModuleForTests({ setSnapshot, hasTokenReader: true }); // MOB-78 receivers
    expect(canHoldWidgetToken()).toBe(true);
    setWidgetModuleForTests({ setSnapshot }); // today's Android build: free widgets only
    expect(canHoldWidgetToken()).toBe(false);
    setWidgetModuleForTests(null); // Expo Go, web
    expect(canHoldWidgetToken()).toBe(false);
  });

  it('SEC L1: Android without a token reader never mints (free widgets ship the module)', async () => {
    Platform.OS = 'android';
    setWidgetModuleForTests({ setSnapshot, hasTokenReader: false });
    mockRpc.mockResolvedValue(mintReply(TOKEN_A, NOW + 48 * HOUR));
    await expect(refreshWidgetToken(() => NOW)).resolves.toBe('skipped');
    setWidgetModuleForTests({ setSnapshot });
    resetWidgetTokensForTests();
    await expect(refreshWidgetToken(() => NOW)).resolves.toBe('skipped');
    expect(mockRpc).not.toHaveBeenCalled();
    expect(setItemAsync).not.toHaveBeenCalled();
  });

  it('never mints without a widget that can read the token', async () => {
    setWidgetModuleForTests(null);
    await expect(refreshWidgetToken(() => NOW)).resolves.toBe('skipped');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('stores it in the shared keychain group, after first unlock, this device only', async () => {
    mockRpc.mockResolvedValue(mintReply(TOKEN_A, NOW + 48 * HOUR));
    await expect(refreshWidgetToken(() => NOW)).resolves.toBe('minted');
    expect(setItemAsync).toHaveBeenCalledWith(
      WIDGET_TOKEN_KEY,
      JSON.stringify({ token: TOKEN_A, expires_at: iso(NOW + 48 * HOUR) }),
      {
        keychainService: WIDGET_TOKEN_SERVICE,
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        accessGroup: GROUP,
      },
    );
    await expect(readWidgetToken()).resolves.toEqual({
      token: TOKEN_A,
      expires_at: iso(NOW + 48 * HOUR),
    });
    // Not in MMKV, not in the widget snapshot (App Group / bonded_widgets).
    expect(writtenOutsideKeychain()).not.toMatch(/bwt_/);
  });

  it('Android: no access group (Keystore prefs of the app itself)', async () => {
    Platform.OS = 'android';
    setWidgetModuleForTests({ setSnapshot, hasTokenReader: true });
    mockRpc.mockResolvedValue(mintReply(TOKEN_A, NOW + 48 * HOUR));
    await refreshWidgetToken(() => NOW);
    expect(setItemAsync.mock.calls[0]![2]).not.toHaveProperty('accessGroup');
  });
});

describe('mint and rotate (CONTRACTS §2 mint_widget_token)', () => {
  it('sends one stable random install id, not a hardware id', async () => {
    mockRpc.mockResolvedValue(mintReply(TOKEN_A, NOW + 2 * HOUR));
    await refreshWidgetToken(() => NOW);
    await refreshWidgetToken(() => NOW);
    const ids = mockRpc.mock.calls.map(([, args]) => (args as { p_device_id: string }).p_device_id);
    expect(mockRpc.mock.calls.map(([name]) => name)).toEqual([
      'mint_widget_token',
      'mint_widget_token',
    ]);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toBe(ids[0]);
  });

  it('keeps a token with more than 24 h left, rotates one with less', async () => {
    await store(TOKEN_A, NOW + 30 * HOUR);
    await expect(refreshWidgetToken(() => NOW)).resolves.toBe('kept');
    expect(mockRpc).not.toHaveBeenCalled();

    mockRpc.mockResolvedValue(mintReply(TOKEN_B, NOW + 48 * HOUR));
    await expect(refreshWidgetToken(() => NOW + 7 * HOUR)).resolves.toBe('minted');
    expect((await readWidgetToken())?.token).toBe(TOKEN_B);
  });

  it('MOB-78c: a new token redraws the widgets; keep and failure do not', async () => {
    await store(TOKEN_A, NOW + 30 * HOUR);
    await refreshWidgetToken(() => NOW);
    mockRpc.mockResolvedValue(offline);
    await refreshWidgetToken(() => NOW + 7 * HOUR);
    expect(mockReload).not.toHaveBeenCalled();
    mockRpc.mockResolvedValue(mintReply(TOKEN_B, NOW + 48 * HOUR));
    await refreshWidgetToken(() => NOW + 7 * HOUR);
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(mockReload).toHaveBeenCalledWith('state');
  });

  it('one mint at a time: a second foreground shares the first call', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockRpc.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = refreshWidgetToken(() => NOW);
    const b = refreshWidgetToken(() => NOW);
    // Let the first call reach the RPC, then answer it.
    await new Promise((r) => setTimeout(r, 0));
    resolve(mintReply(TOKEN_A, NOW + 48 * HOUR));
    await expect(Promise.all([a, b])).resolves.toEqual(['minted', 'minted']);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('NOT_PAIRED: deletes the token and blanks the widgets', async () => {
    await store(TOKEN_A, NOW + 10 * HOUR);
    mockRpc.mockResolvedValue({ data: null, error: { message: 'NOT_PAIRED' } });
    await expect(refreshWidgetToken(() => NOW)).resolves.toBe('cleared');
    await expect(readWidgetToken()).resolves.toBeNull();
    expect(snapshots().at(-1)?.state).toBe('none');
  });

  it('offline or rate limited: keeps a token that still works, drops an expired one', async () => {
    await store(TOKEN_A, NOW + 10 * HOUR);
    mockRpc.mockResolvedValue(offline);
    await expect(refreshWidgetToken(() => NOW)).resolves.toBe('failed');
    expect((await readWidgetToken())?.token).toBe(TOKEN_A);

    mockRpc.mockResolvedValue({ data: null, error: { message: 'RATE_LIMITED' } });
    await expect(refreshWidgetToken(() => NOW + 11 * HOUR)).resolves.toBe('failed');
    await expect(readWidgetToken()).resolves.toBeNull();
  });

  it('rejects a malformed reply without storing or echoing it', async () => {
    mockRpc.mockResolvedValue({ data: { token: 'not-a-token', expires_at: 'soon' }, error: null });
    await expect(mintWidgetToken('d')).rejects.toMatchObject({ kind: 'UNKNOWN' });
    await expect(mintWidgetToken('d')).rejects.not.toHaveProperty(
      'message',
      expect.stringContaining('not-a-token'),
    );
    await expect(refreshWidgetToken(() => NOW)).resolves.toBe('failed');
    await expect(readWidgetToken()).resolves.toBeNull();
  });

  it('a fresh install deletes a keychain item left by an earlier one', async () => {
    await storeRaw(TOKEN_A, NOW + 40 * HOUR); // keychain survived the reinstall, MMKV did not
    const id = await widgetDeviceId();
    await expect(readWidgetToken()).resolves.toBeNull();
    await expect(widgetDeviceId()).resolves.toBe(id);
  });
});

describe('sign-out (CONTRACTS §2 revoke_widget_tokens, BE-60b)', () => {
  it('SEC Info 1: a mint in flight at sign-out never writes its token back', async () => {
    await widgetDeviceId();
    let reply: (value: unknown) => void = () => undefined;
    mockRpc.mockImplementation((name: string) =>
      name === 'mint_widget_token'
        ? new Promise((resolve) => {
            reply = resolve;
          })
        : Promise.resolve({ data: null, error: null }),
    );
    const refresh = refreshWidgetToken(() => NOW);
    await Promise.resolve();
    await revokeWidgetTokensForSignOut(50);
    reply(mintReply(TOKEN_A, NOW + 48 * HOUR));
    await expect(refresh).resolves.toBe('cleared');
    await expect(readWidgetToken()).resolves.toBeNull();
    expect(setItemAsync).not.toHaveBeenCalled();
  });

  it('online: deletes locally, blanks the widgets, revokes all tokens on the server', async () => {
    await store(TOKEN_A, NOW + 40 * HOUR);
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(revokeWidgetTokensForSignOut()).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('revoke_widget_tokens', {});
    await expect(readWidgetToken()).resolves.toBeNull();
    expect(snapshots().at(-1)).toMatchObject({ state: 'none', partnerName: null });
  });

  it('offline: the RPC fails, the token is still deleted on this phone', async () => {
    await store(TOKEN_A, NOW + 40 * HOUR);
    mockRpc.mockResolvedValue(offline);
    await expect(revokeWidgetTokensForSignOut()).resolves.toBe(false);
    await expect(readWidgetToken()).resolves.toBeNull();
    expect(snapshots().at(-1)?.state).toBe('none');
  });

  it('a hanging network never blocks sign-out past the timeout', async () => {
    jest.useFakeTimers();
    try {
      await store(TOKEN_A, NOW + 40 * HOUR);
      mockRpc.mockReturnValue(new Promise(() => {}));
      const done = revokeWidgetTokensForSignOut(4000);
      await jest.advanceTimersByTimeAsync(4000);
      await expect(done).resolves.toBe(false);
      await expect(readWidgetToken()).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('signOut(): the token is gone before the session is, even when the network is down', async () => {
    await store(TOKEN_A, NOW + 40 * HOUR);
    mockRpc.mockResolvedValue(offline);
    mockAuthSignOut.mockResolvedValueOnce({
      error: { message: 'Network request failed' },
    } as never);
    await expect(signOut()).rejects.toMatchObject({ kind: 'NETWORK' });
    await expect(readWidgetToken()).resolves.toBeNull();
    const deleted = deleteItemAsync.mock.invocationCallOrder.at(-1) ?? Infinity;
    expect(deleted).toBeLessThan(mockAuthSignOut.mock.invocationCallOrder[0] ?? 0);
    expect(mockRpc).toHaveBeenCalledWith('revoke_widget_tokens', {});
  });

  it('delete account: the token is deleted with the rest of the local data', async () => {
    await store(TOKEN_A, NOW + 40 * HOUR);
    await wipeLocalAccount();
    await expect(readWidgetToken()).resolves.toBeNull();
  });

  it('forgetting never throws, even without a keychain', async () => {
    deleteItemAsync.mockRejectedValueOnce(new Error('no keychain'));
    await expect(forgetWidgetToken()).resolves.toBeUndefined();
    getItemAsync.mockRejectedValueOnce(new Error('no keychain'));
    await expect(readWidgetToken()).resolves.toBeNull();
  });
});
