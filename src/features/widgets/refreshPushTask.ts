import type * as NotificationsSdk from 'expo-notifications';
import type * as TaskManagerSdk from 'expo-task-manager';

import { handleWidgetRefreshPushTask, WIDGET_REFRESH_PUSH_TASK } from './refreshPush';

/**
 * Defines and registers the expo-notifications background task for the silent `widget_refresh`
 * push (MOB-78d, see `refreshPush.ts`). Runs at import time from the app entry (`index.ts`): a
 * headless start (a push to a closed app) never mounts React, and Expo requires both calls at
 * module scope. Registering is idempotent; the task itself ignores every other push and does
 * nothing for a signed-out person beyond what `runWidgetRefreshTask` does (forget the local token).
 */

type TaskManager = Pick<typeof TaskManagerSdk, 'defineTask'>;
type Notifications = Pick<typeof NotificationsSdk, 'registerTaskAsync'>;

function defineAndRegister(): boolean {
  try {
    // Loaded lazily: requiring either in a binary without the native module (Expo Go, web, an
    // older build running a newer update) throws, and this runs when the bundle loads.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const taskManager = require('expo-task-manager') as TaskManager;
    // `data` is expo-notifications' `NotificationTaskPayload`.
    taskManager.defineTask(WIDGET_REFRESH_PUSH_TASK, ({ data }: { data?: unknown }) =>
      handleWidgetRefreshPushTask(data),
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const notifications = require('expo-notifications') as Notifications;
    void notifications.registerTaskAsync(WIDGET_REFRESH_PUSH_TASK).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** True when the push task is defined and registered in this bundle. */
export const widgetRefreshPushTaskDefined = defineAndRegister();
