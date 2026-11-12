import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { deletePushToken, registerPushToken, saveRitualTime } from '@/features/push/api';
import {
  lastRegistered,
  setPushStorage,
  syncPushToken,
  unregisterPushToken,
} from '@/features/push/registration';
import {
  acceptSoftAsk,
  declineSoftAsk,
  setSoftAskStorage,
  shouldSoftAsk,
  softAskAnswer,
} from '@/features/push/softAsk';
import { memoryStorage } from '@/test/memoryStorage';

jest.mock('@/features/push/api', () => ({
  registerPushToken: jest.fn(() => Promise.resolve()),
  deletePushToken: jest.fn(() => Promise.resolve()),
  saveRitualTime: jest.fn(() => Promise.resolve()),
  PARTNER_RITUAL_AVAILABLE: false,
  getPartnerRitualTime: () => Promise.resolve(null),
}));

// D27: little things are a build switch, off by default; on per test.
let mockShipLittleThings = false;
jest.mock('@/features/premium/features', () => {
  const actual = jest.requireActual('@/features/premium/features');
  const shipped = { ...actual.SHIPPED };
  Object.defineProperty(shipped, 'littleThings', {
    get: () => mockShipLittleThings,
    enumerable: true,
  });
  return { ...actual, SHIPPED: shipped };
});

const N = jest.mocked(Notifications);
const register = jest.mocked(registerPushToken);
const remove = jest.mocked(deletePushToken);
const saveTime = jest.mocked(saveRitualTime);

type Perm = Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;
const perm = (status: 'granted' | 'denied' | 'undetermined', canAskAgain = status !== 'denied') =>
  ({ status, granted: status === 'granted', canAskAgain, expires: 'never' }) as Perm;
const token = (data: string) => ({ type: 'expo' as const, data });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID = 'test-project';
  setPushStorage(memoryStorage());
  setSoftAskStorage(memoryStorage());
  N.getPermissionsAsync.mockResolvedValue(perm('granted'));
  N.requestPermissionsAsync.mockResolvedValue(perm('granted'));
  N.getExpoPushTokenAsync.mockResolvedValue(token('ExponentPushToken[aaa]'));
});

afterAll(() => {
  delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
});

describe('push token registration', () => {
  it('registers once per token: repeated syncs and restarts do not call the RPC again', async () => {
    await syncPushToken('u1');
    await syncPushToken('u1');
    await syncPushToken('u1');
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('ExponentPushToken[aaa]', Platform.OS);
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project' });
    expect(lastRegistered()).toEqual({ token: 'ExponentPushToken[aaa]', userId: 'u1' });
  });

  it('registers again when the token rotates', async () => {
    await syncPushToken('u1');
    N.getExpoPushTokenAsync.mockResolvedValue(token('ExponentPushToken[bbb]'));
    await syncPushToken('u1');
    expect(register).toHaveBeenCalledTimes(2);
    expect(register).toHaveBeenLastCalledWith('ExponentPushToken[bbb]', Platform.OS);
  });

  it('registers again when someone else signs in on the same phone', async () => {
    await syncPushToken('u1');
    await syncPushToken('u2');
    expect(register).toHaveBeenCalledTimes(2);
    expect(lastRegistered()?.userId).toBe('u2');
  });

  it('runs one pass at a time, and one more when asked while running', async () => {
    let release: () => void = () => undefined;
    register.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const first = syncPushToken('u1');
    await new Promise((r) => setTimeout(r, 0));
    expect(register).toHaveBeenCalledTimes(1);
    // The token rotates while the first registration is still in flight.
    N.getExpoPushTokenAsync.mockResolvedValue(token('ExponentPushToken[bbb]'));
    const second = syncPushToken('u1');
    expect(register).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(register).toHaveBeenCalledTimes(2);
    expect(lastRegistered()?.token).toBe('ExponentPushToken[bbb]');
  });

  it('never prompts and never registers without OS permission', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm('undetermined'));
    await syncPushToken('u1');
    N.getPermissionsAsync.mockResolvedValue(perm('denied'));
    await syncPushToken('u1');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('does nothing without an EAS project id (no token can exist)', async () => {
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID = '';
    await syncPushToken('u1');
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it('a failed registration is retried on the next sync', async () => {
    register.mockRejectedValueOnce(new Error('offline'));
    await syncPushToken('u1');
    expect(lastRegistered()).toBeNull();
    await syncPushToken('u1');
    expect(register).toHaveBeenCalledTimes(2);
    expect(lastRegistered()?.token).toBe('ExponentPushToken[aaa]');
  });

  it('a simulator without a push token is not an error', async () => {
    N.getExpoPushTokenAsync.mockRejectedValue(new Error('no APNs'));
    await expect(syncPushToken('u1')).resolves.toBeUndefined();
    expect(register).not.toHaveBeenCalled();
  });

  it('sign-out deletes my token and forgets it, so the next person registers afresh', async () => {
    await syncPushToken('u1');
    await unregisterPushToken();
    expect(remove).toHaveBeenCalledWith('ExponentPushToken[aaa]');
    expect(lastRegistered()).toBeNull();
    await syncPushToken('u2');
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('sign-out without a registered token does not call the server', async () => {
    await unregisterPushToken();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('soft-ask (09, J6)', () => {
  beforeEach(() => {
    N.getPermissionsAsync.mockResolvedValue(perm('undetermined'));
  });

  it('asks a phone that was never asked', async () => {
    expect(await shouldSoftAsk()).toBe(true);
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('accept: saves the ritual time, shows the system prompt once, registers the token', async () => {
    N.getPermissionsAsync
      .mockResolvedValueOnce(perm('undetermined'))
      .mockResolvedValue(perm('granted'));
    expect(await shouldSoftAsk()).toBe(true);
    await expect(acceptSoftAsk('u1', '08:00', '09')).resolves.toBe('granted');
    expect(saveTime).toHaveBeenCalledWith('u1', '08:00');
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
    expect(softAskAnswer()).toBe('accepted');
    expect(await shouldSoftAsk()).toBe(false);
  });

  it('accept, then the OS prompt declined: moves on, no token, never asked again', async () => {
    N.requestPermissionsAsync.mockResolvedValue(perm('denied'));
    N.getPermissionsAsync.mockResolvedValue(perm('undetermined'));
    await expect(acceptSoftAsk('u1', '21:00', '09')).resolves.toBe('denied');
    expect(register).not.toHaveBeenCalled();
    expect(await shouldSoftAsk()).toBe(false);
  });

  it('a failed time save still shows the prompt', async () => {
    saveTime.mockRejectedValueOnce(new Error('offline'));
    await expect(acceptSoftAsk('u1', '21:00', '09')).resolves.toBe('granted');
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('decline: no system prompt, no time saved, never asked again', async () => {
    declineSoftAsk('09');
    expect(softAskAnswer()).toBe('declined');
    expect(await shouldSoftAsk()).toBe(false);
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(saveTime).not.toHaveBeenCalled();
  });

  it('is skipped when the OS already decided (granted or denied for good)', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm('granted'));
    expect(await shouldSoftAsk()).toBe(false);
    N.getPermissionsAsync.mockResolvedValue(perm('denied', false));
    expect(await shouldSoftAsk()).toBe(false);
  });

  it('creates the Android channels before the prompt (Android 13 needs one)', async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      await acceptSoftAsk('u1', '21:00', '09');
      expect(N.setNotificationChannelAsync).toHaveBeenCalledWith(
        'thread_activity',
        expect.objectContaining({ name: 'Replies and reactions' }),
      );
      expect(N.setNotificationChannelAsync).toHaveBeenCalledWith('nudge', expect.anything());
      expect(N.setNotificationChannelAsync).toHaveBeenCalledWith(
        'offer_ending',
        expect.objectContaining({ name: 'Offer reminder' }),
      );
      // Little things are off (D27): no per-gesture channels, and never a `little_thing` one.
      const ids = N.setNotificationChannelAsync.mock.calls.map((c) => c[0]);
      expect(ids.some((id) => id.startsWith('little_thing'))).toBe(false);
      const firstChannel = N.setNotificationChannelAsync.mock.invocationCallOrder[0] ?? 0;
      const prompt = N.requestPermissionsAsync.mock.invocationCallOrder[0] ?? 0;
      expect(firstChannel).toBeLessThan(prompt);
    } finally {
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    }
  });

  it('little things shipped: one channel per gesture plus a silent quiet-hours one (CONTRACTS §5)', async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    mockShipLittleThings = true;
    try {
      await acceptSoftAsk('u1', '21:00', '09');
      for (const kind of ['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you']) {
        expect(N.setNotificationChannelAsync).toHaveBeenCalledWith(
          `little_thing_${kind}`,
          expect.objectContaining({
            importance: AndroidImportance.DEFAULT,
            // MOB-65: each channel plays its gesture's bundled sound (CONTRACTS §5).
            sound: `little_thing_${kind}.wav`,
          }),
        );
      }
      expect(N.setNotificationChannelAsync).toHaveBeenCalledWith(
        'little_thing_kiss',
        expect.objectContaining({ name: 'Kisses' }),
      );
      expect(N.setNotificationChannelAsync).toHaveBeenCalledWith(
        'little_thing_quiet',
        expect.objectContaining({
          importance: AndroidImportance.LOW,
          sound: null,
          enableVibrate: false,
        }),
      );
      const ids = N.setNotificationChannelAsync.mock.calls.map((c) => c[0]);
      expect(ids).not.toContain('little_thing');
    } finally {
      mockShipLittleThings = false;
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    }
  });
});
