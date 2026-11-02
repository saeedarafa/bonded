import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, IosAuthorizationStatus } from 'expo-notifications';
import { Platform } from 'react-native';

import { t } from '@/i18n';
import { easProjectId } from '@/lib/env';

import { PUSH_TYPES } from './links';

/**
 * The device side of push (MOB-15): OS permission, Android channels and the Expo push token.
 * Thin wrappers over expo-notifications so the rest of the feature is plain logic (and tests mock
 * this one file's native module, not the logic).
 */

export type PermissionState = 'granted' | 'denied' | 'undetermined';

function toState(p: Notifications.NotificationPermissionsStatus): PermissionState {
  if (p.granted) return 'granted';
  // iOS provisional/ephemeral authorisation also delivers (quietly).
  const ios = p.ios?.status;
  if (ios === IosAuthorizationStatus.PROVISIONAL || ios === IosAuthorizationStatus.EPHEMERAL) {
    return 'granted';
  }
  if (p.status === 'undetermined' || p.canAskAgain) return 'undetermined';
  return 'denied';
}

export async function getPermission(): Promise<PermissionState> {
  return toState(await Notifications.getPermissionsAsync());
}

/**
 * Android notification channels, one per push type (CONTRACTS §5: `channelId` = type). Android 13
 * shows the permission prompt only once a channel exists, so this runs before asking.
 */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    PUSH_TYPES.map((type) =>
      Notifications.setNotificationChannelAsync(type, {
        name: t(`push.channels.${type}`),
        importance: AndroidImportance.DEFAULT,
      }),
    ),
  );
}

/** The system prompt. Only ever called from the soft-ask (09, J6) after "Turn on reminders". */
export async function requestPermission(): Promise<PermissionState> {
  await ensureChannels();
  return toState(await Notifications.requestPermissionsAsync());
}

function projectId(): string {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return easProjectId() || Constants.easConfig?.projectId || extra?.eas?.projectId || '';
}

/**
 * The Expo push token (`ExponentPushToken[…]`), or null where there can't be one: no EAS project
 * yet, a simulator without push, or the push service being unreachable. Never throws.
 */
export async function getExpoToken(): Promise<string | null> {
  const id = projectId();
  if (!id) return null;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return data || null;
  } catch {
    return null;
  }
}

export function devicePlatform(): 'ios' | 'android' | null {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
}
