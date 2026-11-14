import { runWidgetRefreshTask, TASK_FAILED } from './backgroundRefresh';

/**
 * The silent widget-token refresh push (MOB-78d, BE-64, CONTRACTS §5 "Widget token refresh"):
 * `{ data: { type: "widget_refresh" }, _contentAvailable: true }`, no title, body or sound. The
 * server sends it when a person's widget token expires within 12 h and the app has not refreshed
 * it, so a closed app still mints a new one. The app runs the same `runWidgetRefreshTask()` as the
 * WorkManager / BGTask path (single-flight, mints only when less than 24 h is left, forgets the
 * token when signed out).
 *
 * - Background and terminated: the expo-notifications background task (`refreshPushTask.ts`,
 *   defined and registered when the bundle loads, from `index.ts`). iOS needs UIBackgroundModes
 *   `remote-notification` (`enableBackgroundRemoteNotifications` in app.config.ts).
 * - Foreground: `usePushRouting` skips it (no banner, no refetch) and runs the refresh only while
 *   signed in; `configureForegroundPresentation` presents nothing for it (not even the list).
 *
 * Never shows anything, never logs or tracks the payload, never throws. Kept free of side effects
 * so the push routing can import it.
 */

export const WIDGET_REFRESH_PUSH_TYPE = 'widget_refresh';
export const WIDGET_REFRESH_PUSH_TASK = 'bonded.widget.refresh-push';

/** expo-notifications' `BackgroundNotificationTaskResult` (not imported: native module). */
export const PUSH_TASK_NEW_DATA = 0;
export const PUSH_TASK_NO_DATA = 1;
export const PUSH_TASK_FAILED = 2;
export type PushTaskResult =
  typeof PUSH_TASK_NEW_DATA | typeof PUSH_TASK_NO_DATA | typeof PUSH_TASK_FAILED;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function typeOf(value: unknown): unknown {
  return asRecord(value)?.type;
}

function typeFromJson(json: unknown): unknown {
  if (typeof json !== 'string') return undefined;
  try {
    return typeOf(JSON.parse(json));
  } catch {
    return undefined;
  }
}

/**
 * True for a notification `data` object (foreground: `request.content.data`) or a background task
 * `data` (Android: FCM data with `dataString` = Expo's JSON `body`; iOS: the APNs payload without
 * `aps`, with `body` = the data object, plus `dataString`).
 */
export function isWidgetRefreshData(data: unknown): boolean {
  const record = asRecord(data);
  if (!record) return false;
  const type =
    typeOf(record) ??
    typeFromJson(record.dataString) ??
    typeOf(record.body) ??
    typeFromJson(record.body);
  return type === WIDGET_REFRESH_PUSH_TYPE;
}

/**
 * The background task body (`payload` = expo-notifications' `NotificationTaskPayload`). A tap
 * response (Android action) or any other push: nothing to do.
 */
export async function handleWidgetRefreshPushTask(payload: unknown): Promise<PushTaskResult> {
  try {
    const record = asRecord(payload);
    if (!record || 'actionIdentifier' in record) return PUSH_TASK_NO_DATA;
    if (!isWidgetRefreshData(record.data)) return PUSH_TASK_NO_DATA;
    const result = await runWidgetRefreshTask();
    return result === TASK_FAILED ? PUSH_TASK_FAILED : PUSH_TASK_NEW_DATA;
  } catch {
    return PUSH_TASK_FAILED;
  }
}
