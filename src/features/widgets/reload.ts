import { reloadWidgetsNow } from './bridge';

/**
 * MOB-78c (QA-49b): the widgets redraw when the app comes to the foreground and when what they
 * show depends on changes (Premium, the couple, a new widget token), so a lapsed plan never leaves
 * "Send a hug" on the home screen until it is tapped.
 *
 * Every request is debounced into one native reload. A foreground reload is also throttled: each
 * Premium widget reload is one `state` read on the widget token (SEC-21 read bucket), and flipping
 * between apps must not spend it. A state change always reloads. Nothing here logs or carries data.
 */
export const widgetReloadTiming = { debounceMs: 750, foregroundMinIntervalMs: 30_000 };

export type WidgetReloadReason = 'foreground' | 'state';

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingState = false;
let lastReloadAt = Number.NEGATIVE_INFINITY;

/** Schedule a widget redraw. Never throws; a no-op in builds without the native function. */
export function requestWidgetReload(
  reason: WidgetReloadReason,
  now: () => number = Date.now,
): void {
  if (reason === 'state') pendingState = true;
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    const force = pendingState;
    pendingState = false;
    const at = now();
    if (!force && at - lastReloadAt < widgetReloadTiming.foregroundMinIntervalMs) return;
    if (reloadWidgetsNow()) lastReloadAt = at;
  }, widgetReloadTiming.debounceMs);
}

/** Tests: drop a pending reload and the throttle. */
export function resetWidgetReloadForTests(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pendingState = false;
  lastReloadAt = Number.NEGATIVE_INFINITY;
}
