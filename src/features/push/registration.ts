import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

import { deletePushToken, registerPushToken } from './api';
import { devicePlatform, ensureChannels, getExpoToken, getPermission } from './device';

/**
 * Push token registration (MOB-15). The server learns a token once per change: the last
 * registered `{ token, userId }` is kept on the device (encrypted MMKV, prefix `push:`), and the
 * RPC runs again only when the token or the signed-in person differs. Never prompts: without OS
 * permission it does nothing (the soft-ask on 09 / J6 is the only place that asks).
 */
const REGISTERED_KEY = 'registered';

type Registered = { token: string; userId: string };

let storage: KeyValueStorage = createKeyValueStorage('push:');

/** Tests swap the store. */
export function setPushStorage(next: KeyValueStorage): void {
  storage = next;
}

function readRegistered(): Registered | null {
  try {
    const raw = storage.getItem(REGISTERED_KEY);
    const value = raw ? (JSON.parse(raw) as Partial<Registered>) : null;
    return value?.token && value.userId ? { token: value.token, userId: value.userId } : null;
  } catch {
    return null;
  }
}

export function lastRegistered(): Registered | null {
  return readRegistered();
}

let running: Promise<void> | null = null;
let again: string | null = null;

async function sync(userId: string): Promise<void> {
  const platform = devicePlatform();
  if (!platform) return;
  if ((await getPermission()) !== 'granted') return;
  await ensureChannels();
  const token = await getExpoToken();
  if (!token) return;
  const last = readRegistered();
  if (last?.token === token && last.userId === userId) return;
  await registerPushToken(token, platform);
  storage.setItem(REGISTERED_KEY, JSON.stringify({ token, userId } satisfies Registered));
}

/**
 * Registers this device's token for `userId` if it changed. Single-flight; failures are dropped
 * (the next app focus tries again) and never logged with any payload.
 */
export function syncPushToken(userId: string): Promise<void> {
  if (running) {
    // A pass is in flight (maybe with an older token or person): run once more after it.
    again = userId;
    return running;
  }
  running = (async () => {
    let next: string | null = userId;
    while (next) {
      const current: string = next;
      again = null;
      await sync(current).catch(() => undefined);
      next = again;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * Before signing out: remove my token from the server (best effort, while the session still
 * works) and forget the local mark, so the next person who signs in here registers afresh.
 */
export async function unregisterPushToken(): Promise<void> {
  const last = readRegistered();
  storage.removeItem(REGISTERED_KEY);
  if (!last) return;
  try {
    await deletePushToken(last.token);
  } catch {
    // Signed-out or offline: `register_push_token` moves the token to the next account anyway.
  }
}

/** Root hook: sync at sign-in, when the app returns to the foreground and when the token rotates. */
export function usePushTokenSync(userId: string | null): void {
  useEffect(() => {
    if (!userId) return undefined;
    void syncPushToken(userId);
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncPushToken(userId);
    });
    const rotated = Notifications.addPushTokenListener(() => void syncPushToken(userId));
    return () => {
      app.remove();
      rotated.remove();
    };
  }, [userId]);
}
