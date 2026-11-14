import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { AppError } from '@/lib/errors';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

import { mintWidgetToken, revokeWidgetTokens, isWidgetToken } from './api';
import { unregisterWidgetRefresh } from './backgroundTask';
import {
  widgetHasTokenReader,
  widgetKeychainGroup,
  widgetsAvailable,
  writeWidgetSnapshot,
} from './bridge';
import { emptyWidgetSnapshot } from './snapshot';

/**
 * Widget token lifecycle (MOB-77, BE-60, SEC-21 option A).
 *
 * - **Where:** the platform keychain/Keystore through expo-secure-store, never MMKV, the App Group,
 *   `bonded_widgets` or the snapshot. iOS: the shared keychain access group (from the widget
 *   module) with `AfterFirstUnlockThisDeviceOnly`, so locked-phone widgets can read it and it never
 *   reaches a backup or iCloud Keychain. Android: expo-secure-store's Keystore-encrypted prefs
 *   (`SecureStore.xml`, key `bonded.widget-token`, AES-256-GCM with the Keystore key
 *   `AES/GCM/NoPadding:bonded.widget:keystoreUnauthenticated`), excluded from Auto Backup and
 *   device transfer by the expo-secure-store plugin in app.config.ts (MOB-78, tested in
 *   androidBackup.test.ts). The MOB-78 widget receiver reads it (WidgetTokenStore.kt).
 * - **Native contract:** service `bonded.widget`, account `token`, value JSON
 *   `{"token":"bwt_…","expires_at":"<ISO>"}`. The widget only reads it; it never mints. On iOS
 *   expo-secure-store stores it as kSecAttrService `bonded.widget:no-auth` and kSecAttrAccount
 *   `Data("token")` (plugins/widgets/ios/premium/WidgetTokenStore.swift reads exactly that).
 * - **When:** the app mints when less than 24 h of the 48 h is left (on foreground, when the
 *   couple becomes complete, and in the background task of MOB-78b: `backgroundRefresh.ts`). Only a build whose native module says `hasTokenReader` mints (iOS
 *   also needs the shared keychain group): not Expo Go, web or Jest, not a build with only the free
 *   widgets (Android: `premium` off). Otherwise no widget reads the token and each mint would
 *   only use up the 20-a-day cap.
 * - **Sign-out race (SEC Info 1):** a refresh started before a sign-out never writes its token
 *   back: `forgetWidgetToken` bumps a generation, and a refresh from an older one drops its result.
 * - **Sign-out (BE-60b):** the local item is deleted and the empty snapshot written first, online
 *   or not, then `revoke_widget_tokens()` is tried with a short timeout. An offline sign-out leaves
 *   the server token valid until it expires (≤ 48 h); the local delete is what stops the widget.
 * - **Reinstall:** the keychain survives a reinstall on iOS, MMKV does not. No install id in MMKV
 *   = a fresh install: any old item is deleted before a new id is made.
 *
 * Nothing here logs, tracks or throws the token.
 */

export const WIDGET_TOKEN_SERVICE = 'bonded.widget';
export const WIDGET_TOKEN_KEY = 'token';
/** Mint again when less than this is left (CONTRACTS §2: "less than 24 h is left"). */
export const WIDGET_TOKEN_REFRESH_MS = 24 * 60 * 60 * 1000;
/** How long sign-out waits for `revoke_widget_tokens` before going on without it. */
export const WIDGET_REVOKE_TIMEOUT_MS = 4000;

export type StoredWidgetToken = { token: string; expires_at: string };
export type RefreshResult = 'minted' | 'kept' | 'skipped' | 'cleared' | 'failed';

const installStorage: KeyValueStorage = createKeyValueStorage('widgets:');
const INSTALL_KEY = 'device';

function storeOptions(): SecureStore.SecureStoreOptions {
  const group = Platform.OS === 'ios' ? widgetKeychainGroup() : null;
  return {
    keychainService: WIDGET_TOKEN_SERVICE,
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    ...(group ? { accessGroup: group } : {}),
  };
}

/** True when this build has a widget that can read the token (iOS also needs the shared group). */
export function canHoldWidgetToken(): boolean {
  if (!widgetsAvailable() || !widgetHasTokenReader()) return false;
  if (Platform.OS === 'ios') return widgetKeychainGroup() !== null;
  return Platform.OS === 'android';
}

export async function readWidgetToken(): Promise<StoredWidgetToken | null> {
  try {
    const raw = await SecureStore.getItemAsync(WIDGET_TOKEN_KEY, storeOptions());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredWidgetToken> | null;
    if (!isWidgetToken(parsed?.token) || typeof parsed?.expires_at !== 'string') return null;
    return { token: parsed.token, expires_at: parsed.expires_at };
  } catch {
    return null;
  }
}

async function writeWidgetToken(value: StoredWidgetToken): Promise<void> {
  // Whitelist: only these two keys ever reach the keychain item.
  const json = JSON.stringify({ token: value.token, expires_at: value.expires_at });
  await SecureStore.setItemAsync(WIDGET_TOKEN_KEY, json, storeOptions());
}

async function deleteWidgetToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(WIDGET_TOKEN_KEY, storeOptions());
  } catch {
    // Nothing stored or no keychain: nothing for a widget to read either.
  }
}

/**
 * This install's random id for `p_device_id` (not a hardware id). Kept in the encrypted MMKV store,
 * which a reinstall wipes; a missing id means any keychain item is from an earlier install.
 */
export async function widgetDeviceId(storage: KeyValueStorage = installStorage): Promise<string> {
  const existing = storage.getItem(INSTALL_KEY);
  if (existing) return existing;
  await deleteWidgetToken();
  const id = randomUUID();
  storage.setItem(INSTALL_KEY, id);
  return id;
}

/**
 * Delete the token on this phone, blank the widgets and stop the background refresh (MOB-78b).
 * Never touches the network, never throws: used on sign-out (even offline), unpair, ended or solo
 * couple, account deletion and `wipeLocalAccount`, and by a refresh that gets NOT_PAIRED.
 */
export async function forgetWidgetToken(now: Date = new Date()): Promise<void> {
  generation += 1;
  await deleteWidgetToken();
  writeWidgetSnapshot(emptyWidgetSnapshot(now));
  await unregisterWidgetRefresh();
}

let inFlight: Promise<RefreshResult> | null = null;
/** Bumped by every forget (sign-out, unpair, delete): an older refresh must not write its token. */
let generation = 0;

/**
 * Mint a token when the stored one has less than 24 h left (or there is none). Call only while
 * signed in with a complete couple. One call at a time; a second caller shares the first's result.
 */
export function refreshWidgetToken(now: () => number = Date.now): Promise<RefreshResult> {
  inFlight ??= doRefresh(now).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(now: () => number): Promise<RefreshResult> {
  if (!canHoldWidgetToken()) return 'skipped';
  const started = generation;
  const deviceId = await widgetDeviceId();
  const stored = await readWidgetToken();
  if (stored && Date.parse(stored.expires_at) - now() > WIDGET_TOKEN_REFRESH_MS) return 'kept';
  try {
    const minted = await mintWidgetToken(deviceId);
    // Forgotten while the mint was in flight (sign-out): drop the token, it belongs to no one now.
    if (generation !== started) return 'cleared';
    await writeWidgetToken({ token: minted.token, expires_at: minted.expiresAt });
    if (generation !== started) {
      await deleteWidgetToken();
      return 'cleared';
    }
    return 'minted';
  } catch (error) {
    const kind = error instanceof AppError ? error.kind : null;
    if (kind === 'NOT_PAIRED' || kind === 'NOT_AUTHENTICATED' || kind === 'SIGNED_OUT') {
      await forgetWidgetToken(new Date(now()));
      return 'cleared';
    }
    // Offline or rate limited: keep a token that still works, drop one that has expired.
    if (stored && Date.parse(stored.expires_at) <= now()) await deleteWidgetToken();
    return 'failed';
  }
}

/**
 * Sign-out step (CONTRACTS §2 `revoke_widget_tokens`, BE-60b): local delete and empty snapshot
 * first, so it holds even offline, then the server revoke with a timeout. Resolves true when the
 * server confirmed; never throws, never blocks sign-out for longer than the timeout.
 */
export async function revokeWidgetTokensForSignOut(
  timeoutMs: number = WIDGET_REVOKE_TIMEOUT_MS,
): Promise<boolean> {
  await forgetWidgetToken();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([
      revokeWidgetTokens(null).then(
        () => true,
        () => false,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Tests: forget a pending refresh. */
export function resetWidgetTokensForTests(): void {
  inFlight = null;
}
