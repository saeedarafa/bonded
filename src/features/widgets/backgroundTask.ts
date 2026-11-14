import type * as BackgroundTaskSdk from 'expo-background-task';
import { Platform } from 'react-native';

/**
 * Registration of the background widget-token refresh (MOB-78b, SEC-21, CONTRACTS §2
 * `mint_widget_token`: "the app mints, the widget never does … in BGAppRefreshTask / WorkManager").
 * The task itself is defined in `backgroundRefresh.ts`; this module only turns it on and off, so
 * `tokens.ts` can switch it off on every forget path without an import cycle.
 *
 * - Android: expo-background-task runs it as WorkManager work with a network constraint (survives
 *   a reboot). iOS: a BGProcessingTask (`com.expo.modules.backgroundtask.processing`).
 * - On only while signed in with a complete couple in a build whose widgets read the token
 *   (`useWidgetToken`); off on sign-out, unpair, ended or solo couple, account deletion and
 *   `wipeLocalAccount` (all of them go through `forgetWidgetToken`).
 * - Absent in Expo Go, on the web, in Jest and in an older binary without the native module: then
 *   every call is a no-op. Nothing here throws or logs.
 */

export const WIDGET_REFRESH_TASK = 'bonded.widget.token-refresh';
/**
 * Minutes between runs (a minimum; the system decides). 6 h keeps at least one run inside the 24 h
 * refresh window when Doze / App Standby defer work. WorkManager's floor is 15 minutes.
 */
export const WIDGET_REFRESH_INTERVAL_MINUTES = 6 * 60;

type Sdk = Pick<typeof BackgroundTaskSdk, 'registerTaskAsync' | 'unregisterTaskAsync'>;

let sdk: Sdk | null | undefined;

function load(): Sdk | null {
  if (sdk === undefined) {
    try {
      sdk =
        Platform.OS === 'ios' || Platform.OS === 'android'
          ? // Loaded lazily: requiring it in a binary without the native module throws.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            (require('expo-background-task') as Sdk)
          : null;
    } catch {
      sdk = null;
    }
  }
  return sdk;
}

/** Register and unregister run one after the other, so a quick sign-out never loses to a register. */
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** Turn the background refresh on. Resolves false when this build or platform has none. */
export function registerWidgetRefresh(): Promise<boolean> {
  return serial(async () => {
    const native = load();
    if (!native) return false;
    try {
      await native.registerTaskAsync(WIDGET_REFRESH_TASK, {
        minimumInterval: WIDGET_REFRESH_INTERVAL_MINUTES,
      });
      return true;
    } catch {
      return false;
    }
  });
}

/** Turn the background refresh off. Never throws; a no-op when it was not on. */
export function unregisterWidgetRefresh(): Promise<void> {
  return serial(async () => {
    const native = load();
    if (!native) return;
    try {
      await native.unregisterTaskAsync(WIDGET_REFRESH_TASK);
    } catch {
      // Not registered, or no scheduler: nothing will run.
    }
  });
}

/** Tests: load the SDK again (after changing the mock or the platform). */
export function resetWidgetRefreshForTests(): void {
  sdk = undefined;
  queue = Promise.resolve();
}
