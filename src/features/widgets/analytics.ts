import { useEffect } from 'react';
import { AppState } from 'react-native';

import {
  track,
  WIDGET_ACTIONS,
  WIDGET_KINDS,
  type WidgetAction,
  type WidgetKind,
} from '@/lib/analytics';

import { takeWidgetActionQueue } from './bridge';

/**
 * Premium widget analytics (D59, ANALYTICS §3.7 `widget_action`, MOB-77/78): the widget's kind and
 * the action only. Widget extensions never send to PostHog themselves: they queue
 * `{widget_kind, action}` in the shared app group (nothing else) and the app sends the queue the
 * next time it opens (`flushWidgetActions`). Never question ids, names, counts or text.
 */

export function isWidgetKind(value: unknown): value is WidgetKind {
  return typeof value === 'string' && (WIDGET_KINDS as readonly string[]).includes(value);
}

function isWidgetAction(value: unknown): value is WidgetAction {
  return typeof value === 'string' && (WIDGET_ACTIONS as readonly string[]).includes(value);
}

/** 16's `?widget_kind=` → `{ widget_kind }` for `paywall_viewed`, or nothing when unknown. */
export function widgetKindParam(value: string | undefined): { widget_kind?: WidgetKind } {
  return isWidgetKind(value) ? { widget_kind: value } : {};
}

export function trackWidgetAction(widget_kind: WidgetKind, action: WidgetAction): void {
  track('widget_action', { widget_kind, action });
}

/** The most queued actions sent per flush (a widget left alone for days cannot flood PostHog). */
export const WIDGET_ACTION_FLUSH_MAX = 50;

/**
 * Send the actions the widget extensions queued, as handed over by the native module (a JSON array
 * of `{widget_kind, action}`). Only those two keys of known values are read; anything else in an
 * entry is ignored, malformed entries are dropped. Returns how many were sent.
 */
export function flushWidgetActions(queueJson: string | null | undefined): number {
  if (!queueJson) return 0;
  let entries: unknown;
  try {
    entries = JSON.parse(queueJson);
  } catch {
    return 0;
  }
  if (!Array.isArray(entries)) return 0;
  let sent = 0;
  for (const entry of entries) {
    if (sent >= WIDGET_ACTION_FLUSH_MAX) break;
    const { widget_kind, action } = (entry ?? {}) as { widget_kind?: unknown; action?: unknown };
    if (!isWidgetKind(widget_kind) || !isWidgetAction(action)) continue;
    trackWidgetAction(widget_kind, action);
    sent += 1;
  }
  return sent;
}

/** Root hook: send the widgets' queued actions on launch and on every foreground. */
export function useWidgetActionFlush(): void {
  useEffect(() => {
    flushWidgetActions(takeWidgetActionQueue());
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flushWidgetActions(takeWidgetActionQueue());
    });
    return () => sub.remove();
  }, []);
}
