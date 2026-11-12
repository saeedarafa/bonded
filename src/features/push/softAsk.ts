import { useEffect, useState } from 'react';

import { track } from '@/lib/analytics';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

import { saveRitualTime } from './api';
import { getPermission, requestPermission, type PermissionState } from './device';
import { syncPushToken } from './registration';

/**
 * The soft-ask (09 inviter, J6 joiner; MOB-15). Our own screen first, the system prompt only after
 * "Turn on reminders". Asked at most once per device: the answer is remembered (encrypted MMKV,
 * prefix `push:`), and a phone whose OS permission is already decided is never asked either.
 */
const ASKED_KEY = 'softAsk';

export type SoftAskAnswer = 'accepted' | 'declined';

/**
 * The screens that ask (ANALYTICS §3.2 `screen`): N before sign-in, 09 inviter, J6 joiner, and
 * 41's "Turn on" (the same OS prompt, from settings).
 */
export type SoftAskScreen = 'N' | '09' | 'J6' | '41';

/**
 * The system prompt with its analytics (MOB-24d, §3.2): `reminder_permission_requested` only when
 * the OS will really show its prompt (permission still undetermined), then the result.
 */
async function askOs(screen: SoftAskScreen): Promise<PermissionState> {
  let shows = false;
  try {
    shows = (await getPermission()) === 'undetermined';
  } catch {
    // unknown: no event
  }
  if (shows) track('reminder_permission_requested', { screen });
  const permission = await requestPermission();
  if (shows) track('reminder_permission_result', { granted: permission === 'granted', screen });
  return permission;
}

let storage: KeyValueStorage = createKeyValueStorage('push:');

/** Tests swap the store. */
export function setSoftAskStorage(next: KeyValueStorage): void {
  storage = next;
}

export function softAskAnswer(): SoftAskAnswer | null {
  const value = storage.getItem(ASKED_KEY);
  return value === 'accepted' || value === 'declined' ? value : null;
}

/** Show the soft-ask only if it was never answered here and the OS would still ask. */
export async function shouldSoftAsk(): Promise<boolean> {
  if (softAskAnswer()) return false;
  try {
    return (await getPermission()) === 'undetermined';
  } catch {
    return false;
  }
}

/**
 * "Turn on reminders": save the ritual time, then the system prompt, then the token. The answer is
 * remembered first so a crash or a second tap can never show the prompt twice. Resolves with the
 * OS answer; the caller moves on either way.
 */
export async function acceptSoftAsk(
  userId: string,
  ritualTime: string,
  screen: SoftAskScreen,
): Promise<PermissionState> {
  storage.setItem(ASKED_KEY, 'accepted' satisfies SoftAskAnswer);
  // The time matters even if the OS prompt is declined (it is shown in settings, 41).
  await saveRitualTime(userId, ritualTime).catch(() => undefined);
  let permission: PermissionState = 'denied';
  try {
    permission = await askOs(screen);
  } catch {
    // No prompt available (web, a broken module): treat as declined.
  }
  if (permission === 'granted') await syncPushToken(userId);
  return permission;
}

/**
 * N (MOB-61, D50): "Turn on reminders" before there is an account. Remembered first (09 then steps
 * aside after sign-in), then the system prompt. No token yet: `usePushTokenSync` registers it
 * for the person once they are signed in. The ritual time is kept by N and written after sign-in.
 */
export async function acceptSoftAskSignedOut(): Promise<PermissionState> {
  storage.setItem(ASKED_KEY, 'accepted' satisfies SoftAskAnswer);
  try {
    return await askOs('N');
  } catch {
    return 'denied';
  }
}

/** "Not now": never shown again on this device (41 keeps the switches). */
export function declineSoftAsk(screen: SoftAskScreen): void {
  storage.setItem(ASKED_KEY, 'declined' satisfies SoftAskAnswer);
  track('reminder_soft_ask_declined', { screen });
}

/** null while checking, then whether 09 / J6 should show. */
export function useShouldSoftAsk(): boolean | null {
  const [value, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void shouldSoftAsk().then((v) => {
      if (live) setValue(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return value;
}
