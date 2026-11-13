/**
 * Crash reports (MOB-24, D54): Sentry with nothing a person wrote or is called.
 *
 * - No DSN (`EXPO_PUBLIC_SENTRY_DSN` empty: Jest, CI, local dev) = no-op; the SDK is never loaded.
 * - One Sentry project (PO 2026-11-11), so every event carries `environment`
 *   (`development` | `preview` | `production`, from the EAS build profile's `EXPO_PUBLIC_APP_ENV`).
 * - `sendDefaultPii: false`, no IP, no screenshots, no view hierarchy, no session replay, no
 *   tracing, no logs. The user is `{ id: <Supabase uuid> }` only (ANALYTICS §1 rule 8: Diagnostics
 *   are "linked to the user"); never an email or a name.
 * - `beforeSend` / `beforeBreadcrumb` scrub every event (rules below); the scrubbers are pure and
 *   unit-tested with fixture answers, messages, names, emails and codes.
 * - Crash reports do not follow "Share usage data": ANALYTICS §1 rule 6 ties that toggle to
 *   PostHog only, and rule 8 lists Sentry as Diagnostics for app functionality.
 *
 * The SDK is required lazily: `@sentry/react-native` ships ESM that Jest cannot load, and a build
 * without a DSN should not pay for it either.
 */
import type * as SentryNative from '@sentry/react-native';
import { useEffect } from 'react';

type Breadcrumb = SentryNative.Breadcrumb;
type ErrorEvent = SentryNative.ErrorEvent;
type ReactNativeOptions = SentryNative.ReactNativeOptions;

export type CrashEnvironment = 'development' | 'preview' | 'production';
export const CRASH_ENVIRONMENTS: readonly CrashEnvironment[] = [
  'development',
  'preview',
  'production',
];

/** DSN and environment. Anything but a known profile name counts as `development`. */
export function crashReportsEnv(): { dsn: string; environment: CrashEnvironment } {
  const raw = (process.env.EXPO_PUBLIC_APP_ENV ?? '').trim() as CrashEnvironment;
  return {
    dsn: (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim(),
    environment: CRASH_ENVIRONMENTS.includes(raw) ? raw : 'development',
  };
}

// ---------------------------------------------------------------------------------------------
// Scrubbing
// ---------------------------------------------------------------------------------------------

export const REDACTED = '[redacted]';

/**
 * Keys whose values are free text or secrets (answers, thread messages, names, emails, key-date
 * titles, feedback, invite codes and tokens, push tokens, Supabase `details` / `hint` that echo
 * row data, request and response bodies). Matched case-insensitively on the whole key, after
 * removing `_` and `-`, so `partner_name`, `partnerName` and `display-name` all match.
 */
const FREE_TEXT_KEYS = new Set(
  [
    'answer',
    'answers',
    'answer_text',
    'body',
    'text',
    'message',
    'messages',
    'content',
    'comment',
    'note',
    'notes',
    'transcript',
    'name',
    'names',
    'first_name',
    'last_name',
    'full_name',
    'display_name',
    'partner_name',
    'your_name',
    'inviter_name',
    'couple_name',
    'nickname',
    'username',
    'email',
    'emails',
    'title',
    'key_date',
    'key_dates',
    'feedback',
    'code',
    'p_code',
    'invite_code',
    'otp',
    'token',
    'p_token',
    'access_token',
    'refresh_token',
    'id_token',
    'push_token',
    'expo_push_token',
    'authorization',
    'cookie',
    'cookies',
    'apikey',
    'password',
    'details',
    'hint',
    'data',
    'request_body',
    'response_body',
    'query',
    'query_string',
    'headers',
    'ip_address',
    'path',
    'file',
    'filename',
    'uri',
  ].map(normaliseKey),
);

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

export function isFreeTextKey(key: string): boolean {
  return FREE_TEXT_KEYS.has(normaliseKey(key));
}

/**
 * A URL without its query string or fragment (tokens, codes, PostgREST filters with ids or text)
 * and with `/j/<code>` and `/join/<code>` reduced to `[code]`. Works on `https://`, `bonded://`
 * and bare paths.
 */
export function scrubUrl(url: string): string {
  const noQuery = url.replace(/[?#].*$/s, '');
  return noQuery
    .replace(/\/(j|join)\/[^/]+/gi, (_m, seg: string) => `/${seg}/[code]`)
    .replace(/\/\/[^/@]*@/, '//') // credentials in the authority
    .replace(EMAIL, '[email]');
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
/** Long opaque strings: link tokens (192-bit url-safe), push tokens, API keys. */
const OPAQUE = /\b[A-Za-z0-9_-]{32,}\b/g;
const EXPO_PUSH = /ExponentPushToken\[[^\]]*\]/g;
/** Invite codes as shown (`BND·4827`, `BND-4827`, `BND 4827`, `BND4827`). */
const INVITE_CODE = /\bBND[\s·.-]?\d{4}\b/gi;
/** `code=4827`, `"p_code":"4827"`, `token: abc`, `t=…`. */
const KEYED_SECRET =
  /\b(p_code|code|invite_code|otp|p_token|token|access_token|refresh_token|t)(["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi;
const URL_IN_TEXT = /\b(?:https?|bonded|exp\+bonded):\/\/[^\s"'<>)]+/gi;
/** Postgres echoes row data: `Failing row contains (…)`, `Key (col)=(value) already exists`. */
const FAILING_ROW = /(Failing row contains )\(.*\)/gis;
const KEY_VALUE = /(Key \([^)]*\)=)\([^)]*\)/gi;
/** Postgres quotes values in `invalid input syntax for type x: "…"` and similar. */
const DOUBLE_QUOTED = /"[^"]*"/g;

/**
 * Free text that may still reach an event (exception messages, breadcrumb messages): URLs lose
 * their query strings, emails, tokens, invite codes and Postgres row data are replaced, and every
 * double-quoted value (where Postgres and PostgREST echo input) becomes `"[redacted]"`.
 */
export function scrubText(text: string): string {
  return text
    .replace(URL_IN_TEXT, (u) => scrubUrl(u))
    .replace(FAILING_ROW, (_m, lead: string) => `${lead}(${REDACTED})`)
    .replace(KEY_VALUE, (_m, lead: string) => `${lead}(${REDACTED})`)
    .replace(EXPO_PUSH, '[token]')
    .replace(JWT, '[token]')
    .replace(EMAIL, '[email]')
    .replace(INVITE_CODE, '[code]')
    .replace(KEYED_SECRET, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`)
    .replace(DOUBLE_QUOTED, `"${REDACTED}"`)
    .replace(OPAQUE, '[token]');
}

/** Deep copy of a plain object with free-text keys removed and every string scrubbed. */
export function scrubData(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubData(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (isFreeTextKey(key)) continue;
      out[key] = scrubData(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Contexts the SDK fills itself (device, OS, app, runtime): kept, because they hold no user data,
 * except the device's name ("Maya's iPhone"). Every other context is treated like `extra`.
 */
const SDK_CONTEXTS = new Set([
  'app',
  'os',
  'device',
  'culture',
  'runtime',
  'trace',
  'react_native_context',
  'expo_context',
  'ota_updates',
  'cloud_resource',
  'state',
]);

function scrubContexts(contexts: ErrorEvent['contexts']): ErrorEvent['contexts'] | undefined {
  if (!contexts) return contexts;
  const out: Record<string, unknown> = {};
  for (const [key, ctx] of Object.entries(contexts)) {
    if (!ctx || typeof ctx !== 'object') continue;
    if (SDK_CONTEXTS.has(key)) {
      const kept: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(ctx as Record<string, unknown>)) {
        if (key === 'device' && (k === 'name' || k === 'device_name')) continue;
        kept[k] = typeof v === 'string' ? scrubText(v) : v;
      }
      out[key] = kept;
    } else if (!isFreeTextKey(key)) {
      const scrubbed = scrubData(ctx) as Record<string, unknown>;
      // A custom context left empty (all free text) is dropped altogether.
      if (Object.keys(scrubbed).length > 0) out[key] = scrubbed;
    }
  }
  return out as ErrorEvent['contexts'];
}

/** SDK lifecycle breadcrumbs: their messages are state names, not user data. */
const LIFECYCLE_CATEGORIES = new Set([
  'app.lifecycle',
  'ui.lifecycle',
  'device.orientation',
  'device.event',
  'device.connectivity',
  'navigation',
]);

function scrubBreadcrumbData(data: Breadcrumb['data']): Breadcrumb['data'] {
  if (!data) return undefined;
  return scrubData(data) as Breadcrumb['data'];
}

/**
 * Breadcrumb rules:
 * - `console`: only the level stays (message and arguments dropped).
 * - `touch` / `ui.*`: dropped (labels can carry names).
 * - `http` / `xhr` / `fetch`: method, status and the scrubbed URL only; no bodies, headers or sizes.
 * - `navigation`: `from` / `to` without query strings, `/j/<code>` reduced.
 * - anything else: free-text keys removed from `data`; the message is dropped, except for the
 *   SDK's lifecycle categories (app state, orientation, connectivity, screen lifecycle), scrubbed.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb, _hint?: unknown): Breadcrumb | null {
  const category = breadcrumb.category ?? '';
  if (category === 'touch' || (category.startsWith('ui.') && category !== 'ui.lifecycle')) {
    return null;
  }
  if (category === 'console') {
    return {
      type: breadcrumb.type,
      category,
      level: breadcrumb.level,
      timestamp: breadcrumb.timestamp,
    };
  }
  if (
    category === 'http' ||
    category === 'xhr' ||
    category === 'fetch' ||
    breadcrumb.type === 'http'
  ) {
    const data = (breadcrumb.data ?? {}) as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    if (typeof data.method === 'string') kept.method = data.method;
    if (typeof data.status_code === 'number') kept.status_code = data.status_code;
    if (typeof data.url === 'string') kept.url = scrubUrl(data.url);
    return {
      type: breadcrumb.type,
      category,
      level: breadcrumb.level,
      timestamp: breadcrumb.timestamp,
      data: kept,
    };
  }
  if (category === 'navigation') {
    const data = (breadcrumb.data ?? {}) as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const key of ['from', 'to']) {
      if (typeof data[key] === 'string') kept[key] = scrubUrl(data[key] as string);
    }
    return { ...breadcrumb, message: undefined, data: kept };
  }
  return {
    ...breadcrumb,
    message:
      breadcrumb.message !== undefined && LIFECYCLE_CATEGORIES.has(category)
        ? scrubText(breadcrumb.message)
        : undefined,
    data: scrubBreadcrumbData(breadcrumb.data),
  };
}

/**
 * Event rules (on top of the SDK options in `crashReportOptions`):
 * - user: `{ id }` only; never an IP, email or name.
 * - request: URL scrubbed; no body, cookies, headers or query string.
 * - message, exception values, transaction, tags: `scrubText`.
 * - extra and custom contexts: free-text keys removed, strings scrubbed; device name removed.
 * - breadcrumbs (also the native ones): `scrubBreadcrumb`.
 * - stack frames: no local variables; `server_name` (the device's host name) removed.
 */
export function scrubEvent(event: ErrorEvent, _hint?: unknown): ErrorEvent | null {
  const out: ErrorEvent = { ...event };
  out.user = event.user?.id ? { id: String(event.user.id) } : undefined;
  delete out.server_name;
  if (event.request) {
    out.request = event.request.url ? { url: scrubUrl(event.request.url) } : undefined;
    if (event.request.method && out.request) out.request.method = event.request.method;
  }
  if (event.message) out.message = scrubText(event.message);
  if (event.transaction) out.transaction = scrubUrl(event.transaction);
  if (event.logentry) {
    out.logentry = event.logentry.message
      ? { message: scrubText(event.logentry.message) }
      : undefined;
  }
  if (event.exception?.values) {
    out.exception = {
      ...event.exception,
      values: event.exception.values.map((ex) => ({
        ...ex,
        value: ex.value === undefined ? undefined : scrubText(ex.value),
        stacktrace: ex.stacktrace?.frames
          ? {
              ...ex.stacktrace,
              frames: ex.stacktrace.frames.map(({ vars: _vars, ...frame }) => frame),
            }
          : ex.stacktrace,
      })),
    };
  }
  if (event.tags) {
    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(event.tags)) {
      if (isFreeTextKey(key)) continue;
      tags[key] = typeof value === 'string' ? scrubText(value) : String(value);
    }
    out.tags = tags;
  }
  if (event.extra) out.extra = scrubData(event.extra) as ErrorEvent['extra'];
  if (event.contexts) out.contexts = scrubContexts(event.contexts);
  if (event.breadcrumbs) {
    out.breadcrumbs = event.breadcrumbs
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is Breadcrumb => b !== null);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------------------------

/** The SDK options; exported so the test can assert every privacy switch. */
export function crashReportOptions(dsn: string, environment: CrashEnvironment): ReactNativeOptions {
  return {
    dsn,
    environment,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    attachStacktrace: true,
    enableCaptureFailedRequests: false,
    enableUserInteractionTracing: false,
    enableAutoPerformanceTracing: false,
    enableLogs: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    maxBreadcrumbs: 50,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendTransaction: () => null,
  };
}

type SentrySdk = Pick<typeof SentryNative, 'init' | 'setUser'>;
let sdk: SentrySdk | null | undefined;
let loader: () => SentrySdk = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@sentry/react-native') as SentrySdk;

/** Call once at startup. No DSN = nothing happens (and the SDK is never required). */
export function initCrashReports(): boolean {
  if (sdk !== undefined) return sdk !== null;
  const { dsn, environment } = crashReportsEnv();
  if (!dsn) {
    sdk = null;
    return false;
  }
  try {
    const loaded = loader();
    loaded.init(crashReportOptions(dsn, environment));
    sdk = loaded;
  } catch {
    // Crash reporting must never crash the app.
    sdk = null;
  }
  return sdk !== null;
}

/** The signed-in person's Supabase uuid, or `null` after sign-out. Never an email or a name. */
export function setCrashReportUser(userId: string | null): void {
  if (!sdk) return;
  try {
    sdk.setUser(userId ? { id: userId } : null);
  } catch {
    // ignore
  }
}

/** Tests only: swap the SDK loader and forget the previous init. */
export function setCrashReportsForTests(options: { load?: () => SentrySdk } = {}): void {
  sdk = undefined;
  if (options.load) loader = options.load;
}

/** Root hook: the crash-report user follows the session (uuid only). */
export function useCrashReportUser(userId: string | null | undefined): void {
  useEffect(() => {
    setCrashReportUser(userId ?? null);
  }, [userId]);
}
