import { EVENTS, sanitizeEvent, type EventName } from '@/lib/analytics/catalogue';
import { setAnalyticsForTests, type AnalyticsClient } from '@/lib/analytics/client';

import { memoryStorage } from './memoryStorage';

export type Captured = { event: string; props: Record<string, unknown> };

/**
 * Tests (MOB-24c): turn analytics on with a recorder instead of PostHog. `stop()` turns it off
 * again. Use `expectOnlyAllowedKeys` on what was captured.
 */
export function recordAnalytics() {
  const captured: Captured[] = [];
  const people: Record<string, unknown>[] = [];
  const client = {
    capture: (event: string, props?: Record<string, unknown>) =>
      void captured.push({ event, props: props ?? {} }),
    identify: () => undefined,
    setPersonProperties: (props?: Record<string, unknown>) => void people.push(props ?? {}),
    reset: () => undefined,
    register: () => Promise.resolve(),
    optOut: () => Promise.resolve(),
    optIn: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    setPersistedProperty: () => undefined,
  } as unknown as AnalyticsClient;
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
  setAnalyticsForTests({ factory: () => client, storage: memoryStorage() });
  return {
    captured,
    people,
    events: () => captured.map((c) => c.event),
    of: (event: EventName) => captured.filter((c) => c.event === event).map((c) => c.props),
    stop: () => {
      delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
      setAnalyticsForTests({ storage: memoryStorage() });
    },
  };
}

/** Every captured event is in the catalogue with only its own keys and valid values. */
export function expectOnlyAllowedKeys(captured: readonly Captured[]): void {
  for (const { event, props } of captured) {
    const allowed = Object.keys(EVENTS[event as EventName] ?? {});
    expect({ event, keys: Object.keys(props).filter((k) => !allowed.includes(k)) }).toEqual({
      event,
      keys: [],
    });
    expect({ event, props: sanitizeEvent(event as EventName, props) }).toEqual({ event, props });
  }
}
