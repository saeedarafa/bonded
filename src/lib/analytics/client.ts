import type * as PostHogSdk from 'posthog-react-native';

import { analyticsEnv } from '@/lib/env';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

import {
  EVENTS,
  isEventName,
  sanitizeEvent,
  sanitizePersonProperties,
  sanitizeSuperProperties,
  SUPER_PROPERTIES,
  type EventName,
  type EventProps,
  type PersonProperties,
  type SuperProperties,
} from './catalogue';

/**
 * PostHog behind a typed API (MOB-24, D54, docs/ANALYTICS.md). The rest of the app only sees
 * `track()`, `trackScreen()`, `identifyUser()`, `resetUser()`, `setSuperProperties()` and the
 * opt-out; nothing imports `posthog-react-native` directly.
 *
 * - No key (dev, CI, Jest, a build without `EXPO_PUBLIC_POSTHOG_KEY`): every call is a no-op and
 *   the SDK is never loaded.
 * - Opted out on this device (40 "Share usage data"): no client is created at all, so not even a
 *   remote-config request leaves the phone.
 * - Autocapture, session replay, surveys, heatmaps, feature flags, lifecycle events, push-token
 *   capture and exception capture are all off. Only catalogue events and route-name screen views
 *   are sent, after a second check in `before_send`.
 * - The SDK never reads an advertising id; the device name (which can hold a person's name) is
 *   removed from the app properties.
 */

/** The SDK surface we use: tests swap in a recorder. */
export type AnalyticsClient = Pick<
  PostHogSdk.PostHog,
  | 'capture'
  | 'identify'
  | 'setPersonProperties'
  | 'reset'
  | 'register'
  | 'optOut'
  | 'optIn'
  | 'flush'
  | 'setPersistedProperty'
>;

export type ClientFactory = (key: string, options: PostHogSdk.PostHogOptions) => AnalyticsClient;

const OPTED_OUT_KEY = 'optedOut';

let storage: KeyValueStorage = createKeyValueStorage('analytics:');
let factory: ClientFactory = (key, options) => {
  // Loaded only when there is a key, so dev builds, CI and Jest never touch the SDK.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require('posthog-react-native') as typeof PostHogSdk;
  const Client = sdk.PostHog;
  return new Client(key, options);
};
let client: AnalyticsClient | null | undefined;
let superProps: Record<string, unknown> = {};
let identifiedAs: string | null = null;
let personProps: Record<string, unknown> = {};
/** Account deletion in flight (SEC-16 Info 6): nothing is captured until it settles. */
let paused = false;

/** §2 values that describe the install, not the person: they survive `resetUser()`. */
const DEVICE_PROPERTIES = new Set(['app_version', 'build', 'platform', 'os_version']);
/** Events the SDK itself sends for `identify()`; everything else must be in the catalogue. */
const SDK_EVENTS = new Set(['$identify', '$set']);
/** SDK properties that could identify a person or a device beyond what D54 allows. */
const BLOCKED_SDK_PROPERTIES = new Set([
  '$device_name',
  '$ip',
  '$screen_name',
  '$current_url',
  '$pathname',
  '$referrer',
  '$advertising_id',
  '$device_id',
  '$exception_list',
  '$elements',
  '$event_type',
]);

type CaptureEvent = Parameters<
  Extract<PostHogSdk.PostHogOptions['before_send'], (...args: never) => unknown>
>[0];

/**
 * Last gate before the network: drops events that are not in the catalogue, and properties that
 * are neither the event's own, the §2 properties nor plain SDK properties (`$lib`, `$os_name`,
 * `$session_id`, …). Person properties are filtered against §2's person list.
 */
export function beforeSend(event: CaptureEvent | null): CaptureEvent | null {
  if (!event) return null;
  const isSdk = SDK_EVENTS.has(event.event);
  if (!isSdk && !isEventName(event.event)) return null;
  const own: Record<string, unknown> = isSdk ? {} : EVENTS[event.event as EventName];
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.properties ?? {})) {
    if (key === '$set' || key === '$set_once') {
      properties[key] = sanitizePersonProperties((value ?? {}) as Record<string, unknown>);
    } else if (key.startsWith('$')) {
      if (!BLOCKED_SDK_PROPERTIES.has(key)) properties[key] = value;
    } else if (key in own) {
      properties[key] = value;
    } else if (key in SUPER_PROPERTIES) {
      const checked = sanitizeSuperProperties({ [key]: value });
      if (key in checked) properties[key] = checked[key];
    }
  }
  if (!isSdk) {
    const checked = sanitizeEvent(event.event, pickOwn(properties, own));
    if (!checked) return null;
    for (const key of Object.keys(own)) delete properties[key];
    Object.assign(properties, checked);
  }
  return {
    ...event,
    properties: properties as CaptureEvent['properties'],
    ...(event.$set ? { $set: sanitizePersonProperties(event.$set) as CaptureEvent['$set'] } : {}),
    ...(event.$set_once
      ? { $set_once: sanitizePersonProperties(event.$set_once) as CaptureEvent['$set_once'] }
      : {}),
  };
}

function pickOwn(props: Record<string, unknown>, own: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(props).filter(([k]) => k in own));
}

export function clientOptions(host: string): PostHogSdk.PostHogOptions {
  return {
    host,
    persistence: 'file',
    customStorage: {
      getItem: (key) => storage.getItem(`ph:${key}`),
      setItem: (key, value) => storage.setItem(`ph:${key}`, value),
    },
    captureAppLifecycleEvents: false,
    enableSessionReplay: false,
    disableSurveys: true,
    preloadFeatureFlags: false,
    disableRemoteFeatureFlags: true,
    sendFeatureFlagEvent: false,
    setDefaultPersonProperties: false,
    personProfiles: 'identified_only',
    errorTracking: { autocapture: false },
    capturePushNotificationSubscriptions: false,
    capturePushNotificationOpened: false,
    customAppProperties: (props) => ({ ...props, $device_name: null }),
    before_send: beforeSend,
  };
}

function getClient(): AnalyticsClient | null {
  if (client !== undefined) return client;
  const { key, host } = analyticsEnv();
  if (!key || isOptedOut()) {
    client = null;
    return null;
  }
  try {
    client = factory(key, clientOptions(host));
    if (Object.keys(superProps).length > 0) void client.register(superProps as never);
  } catch {
    // Analytics must never break the app.
    client = null;
  }
  return client;
}

/** True when events can be sent: a key is configured and this device has not opted out. */
export function analyticsEnabled(): boolean {
  return getClient() !== null;
}

type TrackArgs<E extends EventName> =
  Record<string, never> extends EventProps<E> ? [props?: EventProps<E>] : [props: EventProps<E>];

/** Send one catalogue event. Properties are typed per event and checked again at runtime. */
export function track<E extends EventName>(event: E, ...args: TrackArgs<E>): void {
  const c = getClient();
  if (!c || paused) return;
  const props = sanitizeEvent(event, args[0] as Record<string, unknown> | undefined);
  if (!props) {
    if (__DEV__)
      console.warn(`[analytics] dropped ${event}: properties failed the catalogue check`);
    return;
  }
  try {
    c.capture(event, props as never);
  } catch {
    // never throws into the UI
  }
}

/** Route-name screen view: `app/(tabs)/today/answer`, never parameters or screen text. */
export function trackScreen(screen: string, screenId?: EventProps<'screen_viewed'>['screen_id']) {
  track('screen_viewed', screenId ? { screen, screen_id: screenId } : { screen });
}

/** §2 properties on every event; only the keys given change. `undefined` removes a value. */
export function setSuperProperties(next: Partial<SuperProperties>): void {
  const merged: Record<string, unknown> = { ...superProps };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  superProps = sanitizeSuperProperties(merged);
  const c = getClient();
  if (!c) return;
  try {
    void c.register(superProps as never);
  } catch {
    // ignore
  }
}

/** Sign-in: the Supabase user uuid, never an email or a name. Person properties are §2's only. */
export function identifyUser(userId: string, person: PersonProperties = {}): void {
  const c = getClient();
  if (!c || paused || identifiedAs === userId) return;
  identifiedAs = userId;
  personProps = {};
  try {
    c.identify(userId, { $set: sanitizePersonProperties(person) } as never);
  } catch {
    // ignore
  }
}

/** Person properties for the signed-in person (`$set`). */
export function setPersonProperties(person: PersonProperties): void {
  const c = getClient();
  if (!c || paused || !identifiedAs) return;
  const props = sanitizePersonProperties(person);
  const merged = { ...personProps, ...props };
  // Only what changed: the root hook re-runs on every refetch.
  if (Object.keys(props).length === 0 || JSON.stringify(merged) === JSON.stringify(personProps)) {
    return;
  }
  personProps = merged;
  try {
    c.setPersonProperties(props as never, undefined, false);
  } catch {
    // ignore
  }
}

/** Sign-out (and after account deletion): a fresh anonymous id, no §2 values carried over. */
export function resetUser(): void {
  identifiedAs = null;
  personProps = {};
  superProps = Object.fromEntries(
    Object.entries(superProps).filter(([key]) => DEVICE_PROPERTIES.has(key)),
  );
  const c = getClient();
  if (!c) return;
  try {
    c.reset();
  } catch {
    // ignore
  }
}

/**
 * Before `delete-account` (SEC-16 Info 6, BE-51): stop capturing and drop the events still waiting
 * on this phone. The server asks PostHog to delete the person; an event sent after that request
 * would create the person again. The SDK's own opt-out also stops `$set` and `$identify`.
 */
export async function pauseForAccountDeletion(): Promise<void> {
  const c = getClient();
  if (!c) return;
  paused = true;
  try {
    await c.optOut();
  } catch {
    // ignore
  }
  try {
    // PostHogPersistedProperty.Queue: the unsent events. `reset()` keeps it, so clear it here.
    c.setPersistedProperty('queue' as PostHogSdk.PostHogPersistedProperty, null);
  } catch {
    // ignore
  }
}

/**
 * After `delete-account` settled. `deleted`: a fresh anonymous id first (`resetUser()`), so what
 * follows (`account_deleted`, ANALYTICS §3.3) is never tied to the deleted person. Otherwise the
 * account still exists and capture just resumes under the same person.
 */
export async function resumeAfterAccountDeletion({ deleted }: { deleted: boolean }): Promise<void> {
  const c = getClient();
  if (!c || !paused) return;
  if (deleted) resetUser();
  try {
    await c.optIn();
  } catch {
    // ignore
  }
  paused = false;
}

/**
 * True the first time a key is seen on this install (`onboarding_started`), false after. Only
 * stored when analytics is on, so the first real event is not lost to a dev run.
 */
export function onceOnDevice(key: string): boolean {
  if (!getClient()) return false;
  try {
    if (storage.getItem(`once:${key}`) === '1') return false;
    storage.setItem(`once:${key}`, '1');
    return true;
  } catch {
    return false;
  }
}

export function isOptedOut(): boolean {
  try {
    return storage.getItem(OPTED_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 40 "Share usage data" off: `analytics_opted_out` is the last event, then the SDK stops and the
 * choice is stored on this device (it survives restarts; nothing is created on the next start).
 */
export async function optOutOfAnalytics(): Promise<void> {
  const c = getClient();
  if (c) {
    track('analytics_opted_out');
    try {
      await c.flush();
    } catch {
      // the event may be lost; the opt-out still holds
    }
    try {
      await c.optOut();
    } catch {
      // ignore
    }
  }
  try {
    storage.setItem(OPTED_OUT_KEY, '1');
  } catch {
    // ignore
  }
  client = null;
}

/** 40 "Share usage data" back on. */
export async function optInToAnalytics(): Promise<void> {
  try {
    storage.removeItem(OPTED_OUT_KEY);
  } catch {
    // ignore
  }
  client = undefined;
  identifiedAs = null;
  personProps = {};
  const c = getClient();
  if (!c) return;
  try {
    await c.optIn();
  } catch {
    // ignore
  }
}

/** Tests: a recorder instead of the SDK, a memory store, and a clean module state. */
export function setAnalyticsForTests(options: {
  factory?: ClientFactory;
  storage?: KeyValueStorage;
}): void {
  if (options.factory) factory = options.factory;
  if (options.storage) storage = options.storage;
  client = undefined;
  superProps = {};
  identifiedAs = null;
  personProps = {};
  paused = false;
}
