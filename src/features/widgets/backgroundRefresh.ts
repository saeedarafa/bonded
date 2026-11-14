import type * as TaskManagerSdk from 'expo-task-manager';

import { widgetSessionState } from './api';
import { unregisterWidgetRefresh, WIDGET_REFRESH_TASK } from './backgroundTask';
import { canHoldWidgetToken, forgetWidgetToken, refreshWidgetToken } from './tokens';

/**
 * The background widget-token refresh (MOB-78b, SEC-21, CONTRACTS §2 `mint_widget_token`). The
 * system starts it (Android WorkManager, iOS BGTaskScheduler) while the app is closed, so a
 * Premium widget keeps a live token without the app being opened. It runs the same JS path as the
 * foreground (`refreshWidgetToken`: single-flight, mints only when less than 24 h is left); the
 * widget never mints.
 *
 * Defined at import time: a headless start never mounts React, so the definition must run when
 * the bundle loads. Imported from the entry (`index.ts`) before expo-router, and from the root
 * layout. Registration lives in `backgroundTask.ts`.
 *
 * Never throws, never logs, no analytics, no crash-report breadcrumbs: nothing about the token or
 * the session leaves this function.
 */

/** expo-background-task's `BackgroundTaskResult` (not imported: that would load the native module). */
export const TASK_SUCCESS = 1;
export const TASK_FAILED = 2;
export type TaskResult = typeof TASK_SUCCESS | typeof TASK_FAILED;

export async function runWidgetRefreshTask(): Promise<TaskResult> {
  try {
    // A build without a token reader has nothing to refresh: stop being woken up.
    if (!canHoldWidgetToken()) {
      await unregisterWidgetRefresh();
      return TASK_SUCCESS;
    }
    const session = await widgetSessionState();
    if (session === 'signedOut') {
      // Signed out while the app was closed: delete the token, blank the widgets, unregister.
      await forgetWidgetToken();
      return TASK_SUCCESS;
    }
    // Offline or the session refresh failed: keep a token that still works, try next run.
    if (session === 'unknown') return TASK_FAILED;
    // NOT_PAIRED / NOT_AUTHENTICATED → forget (and unregister) inside; offline / RATE_LIMITED keep.
    const result = await refreshWidgetToken();
    return result === 'failed' ? TASK_FAILED : TASK_SUCCESS;
  } catch {
    return TASK_FAILED;
  }
}

function defineWidgetRefreshTask(): boolean {
  try {
    // Loaded lazily: requiring it in a binary without the native module (Expo Go, web, an older
    // build running a newer update) throws, and this runs at import time of the app entry.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const taskManager = require('expo-task-manager') as Pick<typeof TaskManagerSdk, 'defineTask'>;
    taskManager.defineTask(WIDGET_REFRESH_TASK, () => runWidgetRefreshTask());
    return true;
  } catch {
    return false;
  }
}

/** True when the task is defined in this bundle (false without the native module). */
export const widgetRefreshTaskDefined = defineWidgetRefreshTask();
