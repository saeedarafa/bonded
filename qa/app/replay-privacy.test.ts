// QA-54 (D63, SEC-23 A1-A4 and C.7/C.9), extending QA-08: the masked session replay can never
// carry content, and "Share usage data" off stops it.
//
// One layer below the device, like qa/app/privacy.test.ts: the app's real analytics wrapper
// (src/lib/analytics) drives the real PostHog SDK (posthog-react-native) with
// EXPO_PUBLIC_ANALYTICS_REPLAY=1. Only the native recorder (@posthog/react-native-plugin) is a
// recorder here, so the test sees exactly what the JS SDK hands to the native side: the replay
// config (masking, logs, network, touches) after the SDK merged it with the project's remote
// config, and the order of start / stop / opt-out calls. The fetch seam answers the remote config
// with the worst case (console logs, network timing and payload capture all ON in the project),
// so a local `false` must still win.
//
// The static part covers what the device check cannot prove for every future screen: every app
// route not on the reviewed allow-list renders under the mask, the SEC-23 never list is masked
// (QA's own copy of it, independent of the app's list), allowed screens do not read couple
// content, nothing draws user text outside native text views, nobody unmasks, and no build
// profile turns the flag on.
//
// What only a device shows (keyboard, system sheets, the pixels): see QA-54 in
// docs/plan/status/qa.md.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  analyticsEnabled,
  optInToAnalytics,
  optOutOfAnalytics,
  resetUser,
  setAnalyticsForTests,
  track,
} from '@/lib/analytics/client';
import {
  REPLAY_ALLOWED_ROUTES,
  replayMayShow,
  replayRouteId,
} from '@/features/analytics/replay';
import { memoryStorage } from '@/test/memoryStorage';

// ---------- the native recorder ----------

type NativeCall = { fn: string; args: unknown[] };
const mockNative: NativeCall[] = [];

jest.mock('@posthog/react-native-plugin', () => {
  const rec =
    (fn: string, result: unknown = undefined) =>
    (...args: unknown[]) => {
      mockNative.push({ fn, args });
      return Promise.resolve(result);
    };
  const api = {
    setup: rec('setup'),
    start: rec('start'),
    startSession: rec('startSession'),
    endSession: rec('endSession'),
    isEnabled: rec('isEnabled', false),
    identify: rec('identify'),
    reset: rec('reset'),
    startRecording: rec('startRecording'),
    stopRecording: rec('stopRecording'),
    setOptOut: rec('setOptOut'),
    addExceptionStep: rec('addExceptionStep'),
    captureFatalException: rec('captureFatalException'),
    markFatalExceptionHandled: rec('markFatalExceptionHandled'),
    getSessionReplayDebugProperties: rec('getSessionReplayDebugProperties', {}),
    registerPushNotificationToken: rec('registerPushNotificationToken'),
    unregisterPushNotificationToken: rec('unregisterPushNotificationToken'),
    capturePushNotificationOpened: rec('capturePushNotificationOpened'),
    setPushIdentityProvider: () => undefined,
  };
  return { __esModule: true, ...api, default: api };
});

// ---------- network: the project's remote config is the worst case ----------

type Request = { url: string; method: string };
const g = globalThis as unknown as { __qaFetch?: typeof fetch };
let requests: Request[] = [];

/** Everything a project could turn on remotely for replay (SEC-23 A1: the local `false` must win). */
const REMOTE_CONFIG = {
  sessionRecording: {
    endpoint: '/s/',
    consoleLogRecordingEnabled: true,
    recorderVersion: 'v2',
    networkPayloadCapture: { recordBody: true, recordHeaders: true },
    masking: { maskAllInputs: false, blockSelector: null },
  },
  capturePerformance: { network_timing: true, web_vitals: true },
  autocapture_opt_out: false,
};

function installNetwork() {
  requests = [];
  g.__qaFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, method: init?.method ?? 'GET' });
    const payload = /\/(config|flags|decide)/.test(url) ? JSON.stringify(REMOTE_CONFIG) : '{"status":1}';
    return Promise.resolve(
      new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }) as typeof fetch;
}

async function settle() {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
}

const calls = (fn: string) => mockNative.filter((c) => c.fn === fn);
const lastIndex = (fns: string[]) =>
  mockNative.reduce((last, c, i) => (fns.includes(c.fn) ? i : last), -1);

type ReplayConfig = Record<string, unknown>;
type PluginConfig = { sessionReplay?: { enabled: boolean; sdkReplayConfig: ReplayConfig } };

/** The replay config the JS SDK handed to the native recorder (setup() or start()). */
function nativeReplayConfigs(): ReplayConfig[] {
  const out: ReplayConfig[] = [];
  for (const c of mockNative) {
    if (c.fn === 'setup') {
      const cfg = c.args.find(
        (a): a is PluginConfig => typeof a === 'object' && a !== null && 'sessionReplay' in a,
      );
      if (cfg?.sessionReplay?.enabled) out.push(cfg.sessionReplay.sdkReplayConfig);
    }
    if (c.fn === 'start') {
      // Older plugin path: start(sessionId, sdkOptions, sdkReplayConfig, decideReplayConfig).
      const cfg = c.args[2];
      if (cfg && typeof cfg === 'object') out.push(cfg as ReplayConfig);
    }
  }
  return out;
}

/** SEC-23 A1, checked on what reaches the native recorder, not on the app's own object. */
const REQUIRED_NATIVE = {
  maskAllTextInputs: true,
  maskAllImages: true,
  maskAllSandboxedViews: true,
  captureLog: false,
  captureNetworkTelemetry: false,
  captureTouches: false,
};

const consoleSpies: jest.SpyInstance[] = [];
beforeAll(() => {
  for (const level of ['log', 'info', 'warn', 'debug'] as const) {
    consoleSpies.push(jest.spyOn(console, level).mockImplementation(() => undefined));
  }
});

afterAll(() => {
  for (const spy of consoleSpies) spy.mockRestore();
  delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  delete process.env.EXPO_PUBLIC_ANALYTICS_REPLAY;
  delete process.env.EXPO_PUBLIC_ANALYTICS_TEST_BUILD;
  delete g.__qaFetch;
  setAnalyticsForTests({ storage: memoryStorage() });
});

function env(replay: boolean) {
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_qa54_replay';
  delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
  if (replay) process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
  else delete process.env.EXPO_PUBLIC_ANALYTICS_REPLAY;
  process.env.EXPO_PUBLIC_ANALYTICS_TEST_BUILD = '1';
}

describe('QA-54 replay through the real SDK to the native recorder', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeAll(async () => {
    installNetwork();
    env(true);
    storage = memoryStorage();
    // A cached remote config with everything on, as a project that turned it on would leave it.
    storage.setItem('ph:remote_config', JSON.stringify(REMOTE_CONFIG));
    mockNative.length = 0;
    setAnalyticsForTests({ storage });
    expect(analyticsEnabled()).toBe(true);
    track('app_opened', { source: 'icon' } as never);
    await settle();
  }, 60_000);

  it('the recorder is started (positive control)', () => {
    expect(nativeReplayConfigs().length).toBeGreaterThan(0);
  });

  it('masks all text, inputs, images and sandboxed views; no logs, network or touches (remote config cannot turn them on)', () => {
    for (const cfg of nativeReplayConfigs()) {
      expect(cfg).toEqual(expect.objectContaining(REQUIRED_NATIVE));
    }
  });

  it('no sample rate or capture-mode override that could change masking', () => {
    for (const cfg of nativeReplayConfigs()) {
      expect(cfg.verifyScreenshotMaskAlignment ?? false).toBe(false);
      expect(cfg.screenshotModeBackgroundCapture ?? false).toBe(false);
    }
  });

  it('the JS SDK sends no replay snapshots itself (only the native recorder records)', () => {
    const paths = requests.map((r) => new URL(r.url).pathname);
    expect(paths.filter((p) => /^\/s\b/.test(p))).toEqual([]);
  });

  it('"Share usage data" off: the recording stops before the opt-out, and nothing restarts it', async () => {
    const startedBefore = lastIndex(['setup', 'start', 'startRecording']);
    expect(startedBefore).toBeGreaterThanOrEqual(0);
    const from = mockNative.length;
    await optOutOfAnalytics();
    await settle();
    const after = mockNative.slice(from);
    const stop = after.findIndex((c) => c.fn === 'stopRecording');
    expect(stop).toBeGreaterThanOrEqual(0);
    // Nothing that records again after the stop.
    expect(after.slice(stop).filter((c) => /^(setup|start|startRecording|startSession)$/.test(c.fn))).toEqual([]);
    // Tracking, sign-out and a new sign-in while opted out never start it either.
    const mark = mockNative.length;
    track('app_opened', { source: 'icon' } as never);
    resetUser();
    await settle();
    expect(
      mockNative.slice(mark).filter((c) => /^(setup|start|startRecording|startSession)$/.test(c.fn)),
    ).toEqual([]);
  }, 60_000);

  it('cold start with "Share usage data" off: no client, the recorder is never touched', async () => {
    const mark = mockNative.length;
    // Restart: a fresh module state on the same device storage (the choice survives).
    setAnalyticsForTests({ storage });
    expect(analyticsEnabled()).toBe(false);
    track('app_opened', { source: 'icon' } as never);
    await settle();
    expect(mockNative.slice(mark).filter((c) => /^(setup|start|startRecording)$/.test(c.fn))).toEqual([]);
  });

  it('"Share usage data" back on: recording only with the same masked config', async () => {
    const mark = mockNative.length;
    await optInToAnalytics();
    track('app_opened', { source: 'icon' } as never);
    await settle();
    const fresh = mockNative.slice(mark);
    // SEC-23 A4: a new session, never the one recorded before the opt-out.
    for (const c of fresh.filter((x) => x.fn === 'startRecording')) {
      expect({ startRecording: c.args[0] }).toEqual({ startRecording: false });
    }
    const sessions = calls('setup').map((c) => c.args[0]);
    const before = sessions[0];
    const now = fresh.filter((c) => c.fn === 'setup').map((c) => c.args[0]);
    expect(now.length + fresh.filter((c) => c.fn === 'startRecording').length).toBeGreaterThan(0);
    for (const id of now) expect(id).not.toBe(before);
    for (const cfg of nativeReplayConfigs()) expect(cfg).toEqual(expect.objectContaining(REQUIRED_NATIVE));
  });
});

describe('QA-54 the installed native recorder reads the keys the JS SDK sends', () => {
  // A renamed key would silently fall back to the native default (`true` for logs, network and
  // touches). Checked against the plugin sources in node_modules, so an SDK bump that renames one
  // fails here.
  const plugin = 'node_modules/@posthog/react-native-plugin';
  it.each([
    ['ios/PosthogReactNativePlugin.swift', ['maskAllTextInputs', 'maskAllImages', 'maskAllSandboxedViews', 'captureLog', 'captureNetworkTelemetry', 'captureTouches']],
    ['android/src/main/java/com/posthogreactnativeplugin/PosthogReactNativePluginModule.kt', ['maskAllTextInputs', 'maskAllImages', 'captureLog', 'captureTouches']],
  ] as const)('%s', (file, keys) => {
    const src = readFileSync(join(process.cwd(), plugin, file), 'utf8');
    for (const key of keys) {
      expect({ key, read: new RegExp(`["']${key}["']`).test(src) }).toEqual({ key, read: true });
    }
  });
});

describe('QA-54 without the D63 flag', () => {
  it('the native recorder is never started', async () => {
    installNetwork();
    env(false);
    mockNative.length = 0;
    setAnalyticsForTests({ storage: memoryStorage() });
    expect(analyticsEnabled()).toBe(true);
    track('app_opened', { source: 'icon' } as never);
    await settle();
    expect(nativeReplayConfigs()).toEqual([]);
    expect(calls('startRecording')).toEqual([]);
  });
});

// ---------- static checks ----------

const ROOT = process.cwd();

function files(dir: string, ext = /\.(ts|tsx)$/): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : files(p, ext);
    return ext.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

const routeOf = (f: string) =>
  replayRouteId(f.replace(/^app\//, '').replace(/\.tsx?$/, '').split('/'));
const ROUTE_FILES = files('app').filter((f) => !/\/_layout\.tsx$/.test(f) && !/\+/.test(f));

/**
 * QA's own reading of SEC-23 A2.3 (and BACKLOG MOB-87): screens that show answers, messages,
 * voice, names, dates or codes. Kept here on purpose, not imported from the app, so a change to
 * the app's never list cannot quietly unmask one of them.
 */
const SEC23_NEVER: RegExp[] = [
  /^\(tabs\)\/today(\/|$)/, // 19-22 answer, reveal, revealed, thread
  /^question(\/|$)/,
  /^\(tabs\)\/history(\/|$)/, // 23-25 incl. recap
  /^ended(\/|$)/,
  /voice/i, // 31-33
  /^\(pairing\)\/(invite|join|waiting|paired|partner-left)(\/|$)/, // 06/08/J codes, names
  /^j(\/|$)/,
  /^join(\/|$)/,
  /^auth(\/|$)/,
  /^\(tabs\)\/us$/, // 38 Us / key dates
  /^\(tabs\)\/us\/(couple|badges|delete|feedback)$/,
  /^milestone(\/|$)/,
  /^\(tabs\)\/packs\/\[packId\]/,
  /^\(onboarding\)\/quiz\/(names|dates)$/,
  /^\(onboarding\)\/plan\/(first-question|yours)$/,
];

describe('QA-54 static: which screens a recording can show', () => {
  it('routes exist (positive control)', () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(40);
  });

  it.each(SEC23_NEVER.map((re) => [re.source]))('SEC-23 never-recorded routes are masked: %s', (src) => {
    const re = new RegExp(src);
    const hits = ROUTE_FILES.map(routeOf).filter((r) => re.test(r));
    if (src !== 'voice') expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter((r) => replayMayShow(r))).toEqual([]);
  });

  it('every route not on the allow-list is masked (fails closed), and the allow-list is short', () => {
    const shown = ROUTE_FILES.map(routeOf).filter((r) => replayMayShow(r));
    expect(shown.filter((r) => !REPLAY_ALLOWED_ROUTES.includes(r))).toEqual([]);
    // A reviewed list: growing it needs SEC (SEC-23 A2) and a QA-54 re-check.
    expect(REPLAY_ALLOWED_ROUTES.length).toBeLessThanOrEqual(10);
  });

  /**
   * The route file plus the screens and components it imports from `@/` (one level: the
   * re-exported screen, `SignInView`, `OnboardingFrame`, ...). Hooks and stores are not followed:
   * reading a name is what counts, and that happens in the component.
   */
  function screenSources(f: string): { file: string; src: string }[] {
    const src = read(f);
    const out = [{ file: f, src }];
    for (const m of src.matchAll(/from ['"]@\/([^'"]+)['"]/g)) {
      const mod = m[1] as string;
      if (!/(^|\/)[A-Z][A-Za-z]*$/.test(mod)) continue;
      for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
        const file = `src/${mod}${ext}`;
        try {
          out.push({ file, src: read(file) });
          break;
        } catch {
          // next extension
        }
      }
    }
    return out;
  }

  /** Reads of couple content: names, answers, messages, codes, key dates, voice, email. */
  const CONTENT_READS =
    /\b(usePairNames|usePartner|useCouple|useProfile|useAnswer|useThread|useMessages|useKeyDates|useInvite|useVoice|partner_?name|partnerName|display_?name|displayName|first_?name|firstName|couple_?name|coupleName|answer_?text|answerText|key_?date_?title|invite_?code|inviteCode|voice_?path)\b/;

  /**
   * SEC-23 A2 / review of #439: an allowed screen may show no first name, because the name would
   * then be hidden only by the SDK's text masking, which is what QA-54 still has to validate on a
   * device. Known violations are filed as bugs and listed here until fixed (the `failing` test
   * below turns red when the list is out of date, so it cannot go stale).
   */
  // Known allow-listed routes that still read a name, with their issue. Empty since #453
  // (fixes #450/#451: story and us/notifications moved to the never list). Add a route
  // here only with an open issue; the next test fails once the entry goes stale.
  const KNOWN_NAME_ON_ALLOWED: Record<string, string> = {};

  function contentOnAllowed(): string[] {
    const found: string[] = [];
    for (const f of ROUTE_FILES) {
      const r = routeOf(f);
      if (!replayMayShow(r)) continue;
      for (const { file, src } of screenSources(f)) {
        const m = src.match(CONTENT_READS);
        if (m) found.push(`${r} (${file}): ${m[0]}`);
      }
    }
    return found;
  }

  it('allowed screens read no couple content, apart from the filed known issues', () => {
    const found = contentOnAllowed().filter((x) => !Object.keys(KNOWN_NAME_ON_ALLOWED).some((r) => x.startsWith(`${r} `)));
    expect(found).toEqual([]);
  });

  it('the known-issue list is current (each listed route still reads a name)', () => {
    const found = contentOnAllowed();
    for (const r of Object.keys(KNOWN_NAME_ON_ALLOWED)) {
      expect({ r, stillReads: found.some((x) => x.startsWith(`${r} `)) }).toEqual({ r, stillReads: true });
    }
  });

  it('nobody unmasks: no ph-no-mask in app/, src/ or plugins/', () => {
    const hits = [...files('app'), ...files('src'), ...files('plugins', /\.(ts|tsx|js)$/)].filter((f) =>
      /ph-no-mask/i.test(read(f)),
    );
    expect(hits).toEqual([]);
  });

  it('no text drawn outside native text views (SVG text, Skia, canvas) except the reviewed static store frame', () => {
    const PIXEL_TEXT = /from ['"]@shopify\/react-native-skia['"]|\bSvgText\b|<TSpan\b|<TextPath\b|react-native-canvas|expo-gl/;
    const REVIEWED = ['src/features/store/StoreScreen.tsx'];
    const hits = [...files('app'), ...files('src')].filter((f) => PIXEL_TEXT.test(read(f)));
    expect(hits.filter((f) => !REVIEWED.includes(f))).toEqual([]);
  });

  it('only the analytics client touches the SDK, and only it starts or configures a recording', () => {
    const SDK = /posthog-react-native|@posthog\/react-native-plugin/;
    const REPLAY_API = /startSessionRecording|enableSessionReplay|sessionReplayConfig/;
    const all = [...files('app'), ...files('src')];
    expect(all.filter((f) => SDK.test(read(f)) && f !== 'src/lib/analytics/client.ts')).toEqual([]);
    expect(all.filter((f) => REPLAY_API.test(read(f)) && f !== 'src/lib/analytics/client.ts')).toEqual([]);
  });
});

/**
 * Native system UI (security's QA-54 extras): an Alert, the share sheet, the in-app review sheet
 * and OS permission prompts are drawn by the OS over the current screen, so the app cannot put a
 * `ReplayMask` on them. What the app does control is the route underneath: on a never-recorded
 * route the whole screen is masked, so a sheet opened there opens over a masked surface. This
 * proves statically that every call can only happen on masked routes. Whether the native recorder
 * captures the system window itself (the iOS share sheet is a remote view controller, the
 * permission prompt a separate window) is still the device step in qa/privacy/replay/README.md.
 *
 * Reachability is per symbol, not per module (the root layout imports `device.ts` and
 * `review.ts` for other helpers): the top-level declaration that contains the call is tainted; a
 * declaration that mentions a tainted name in the same file is tainted; a file that imports or
 * re-exports a tainted export (named, default, `* as ns`, `export *`) taints its declarations
 * that mention it. A route file that imports a tainted symbol reaches the call; a `_layout.tsx`
 * that does reaches every route under its directory. Mentions count as calls, so this
 * over-approximates, which only makes the check stricter.
 */
describe('QA-54 static: native alerts, share sheets and system prompts open only over masked routes', () => {
  const SYSTEM_UI =
    /\bAlert\.(alert|prompt)\s*\(|\bShare\.share\s*\(|\bSharing\.shareAsync\s*\(|\bActionSheetIOS\.\w+\s*\(|\brequestPermissionsAsync\s*\(|\brequestRecordingPermissionsAsync\s*\(|\bPermissionsAndroid\.request\w*\s*\(|\bStoreReview\.requestReview\s*\(|\brequest\w*PermissionsAsync\s*\(/g;

  const ALL = [...files('app'), ...files('src')].filter((f) => !f.startsWith('src/test/'));
  const EXISTS = new Set(ALL);
  const SRC = new Map(ALL.map((f) => [f, read(f)]));

  function resolve(from: string, spec: string): string | undefined {
    let base: string;
    if (spec.startsWith('@/')) base = `src/${spec.slice(2)}`;
    else if (spec.startsWith('.')) {
      const parts = from.split('/').slice(0, -1);
      for (const seg of spec.split('/')) {
        if (seg === '..') parts.pop();
        else if (seg !== '.') parts.push(seg);
      }
      base = parts.join('/');
    } else return undefined;
    for (const ext of ['', '.tsx', '.ts', '/index.tsx', '/index.ts']) {
      if (EXISTS.has(base + ext)) return base + ext;
    }
    return undefined;
  }

  type Decl = { names: string[]; exported: string[]; from: number; to: number };
  /** Top-level declarations (column 0); module-level code before the first one is `<module>`. */
  function decls(src: string): Decl[] {
    const re =
      /^(export\s+)?(default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?\s+(\w+)|(?:const|let|var|class|enum|type|interface)\s+(\w+)|function\b)/gm;
    const found: Decl[] = [{ names: ['<module>'], exported: [], from: 0, to: src.length }];
    for (const m of src.matchAll(re)) {
      const name = m[3] ?? m[4];
      const names = name ? [name] : [];
      const exported = m[1] ? (m[2] ? ['default', ...names] : names) : [];
      if (!m[1] && m[2]) continue;
      found[found.length - 1]!.to = m.index ?? 0;
      found.push({ names: names.length ? names : ['default'], exported, from: m.index ?? 0, to: src.length });
    }
    // `export default Foo;` / `export { Foo, Bar as default }` at the end of a file.
    for (const m of src.matchAll(/^export\s+default\s+(\w+)\s*;?\s*$/gm)) {
      for (const d of found) if (d.names.includes(m[1] as string)) d.exported.push('default');
    }
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
      for (const part of (m[1] as string).split(',')) {
        const [local, as] = part.trim().split(/\s+as\s+/);
        for (const d of found) if (local && d.names.includes(local)) d.exported.push(as ?? local);
      }
    }
    return found;
  }

  type Import = { file: string; imported: string; local: string; reexport: boolean };
  function importsOf(f: string): Import[] {
    const src = SRC.get(f) as string;
    const out: Import[] = [];
    const add = (spec: string, imported: string, local: string, reexport = false) => {
      const file = resolve(f, spec);
      if (file) out.push({ file, imported, local, reexport });
    };
    for (const m of src.matchAll(/\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
      const clause = m[1] as string;
      const spec = m[2] as string;
      const def = clause.match(/^(\w+)/);
      if (def && def[1] !== 'type') add(spec, 'default', def[1] as string);
      const ns = clause.match(/\*\s+as\s+(\w+)/);
      if (ns) add(spec, '*', ns[1] as string);
      const named = clause.match(/\{([\s\S]*)\}/);
      for (const part of named ? (named[1] as string).split(',') : []) {
        const [imp, as] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
        if (imp) add(spec, imp, as ?? imp);
      }
    }
    for (const m of src.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
      for (const part of (m[1] as string).split(',')) {
        const [imp, as] = part.trim().split(/\s+as\s+/);
        if (imp) add(m[2] as string, imp, as ?? imp, true);
      }
    }
    for (const m of src.matchAll(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g)) add(m[1] as string, '*', '*', true);
    // Dynamic import / require: the whole module counts as used by the module.
    for (const m of src.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1] as string, '*', '<dynamic>');
    return out;
  }

  const DECLS = new Map(ALL.map((f) => [f, decls(SRC.get(f) as string)]));
  const IMPORTERS = new Map<string, { by: string; imp: Import }[]>();
  for (const f of ALL) {
    for (const imp of importsOf(f)) {
      IMPORTERS.set(imp.file, [...(IMPORTERS.get(imp.file) ?? []), { by: f, imp }]);
    }
  }
  const mentions = (src: string, name: string) => new RegExp(`(^|[^\\w.$])${name.replace(/\$/g, '\\$')}\\b`).test(src);

  /** Every file whose code can run a call site of `site`, and the decl names tainted there. */
  function taint(site: string): Map<string, Set<string>> {
    const tainted = new Map<string, Set<string>>();
    const queue: [string, string][] = [];
    const mark = (f: string, name: string) => {
      const set = tainted.get(f) ?? new Set<string>();
      if (set.has(name)) return;
      set.add(name);
      tainted.set(f, set);
      queue.push([f, name]);
    };
    const src = SRC.get(site) as string;
    for (const m of src.matchAll(SYSTEM_UI)) {
      const at = m.index ?? 0;
      const d = [...(DECLS.get(site) as Decl[])].reverse().find((x) => x.from <= at);
      mark(site, (d?.names[0] as string | undefined) ?? '<module>');
    }
    while (queue.length) {
      const [f, name] = queue.shift() as [string, string];
      const ds = DECLS.get(f) as Decl[];
      const decl = ds.find((d) => d.names.includes(name));
      // Same file: declarations that mention the tainted name.
      if (name !== '<module>' && name !== 'default') {
        for (const d of ds) {
          if (d === decl) continue;
          if (mentions((SRC.get(f) as string).slice(d.from, d.to), name)) mark(f, d.names[0] as string);
        }
      }
      // Other files: importers of a tainted export (module-level code taints every importer).
      const exportedAs = name === '<module>' ? ['*'] : (decl?.exported ?? []);
      if (!exportedAs.length) continue;
      for (const { by, imp } of IMPORTERS.get(f) ?? []) {
        if (!(exportedAs.includes('*') || imp.imported === '*' || exportedAs.includes(imp.imported))) continue;
        if (imp.reexport) {
          mark(by, '<module>');
          continue;
        }
        if (imp.local === '<dynamic>') {
          mark(by, '<module>');
          continue;
        }
        const bys = SRC.get(by) as string;
        let hit = false;
        for (const d of DECLS.get(by) as Decl[]) {
          if (d.names[0] === '<module>') continue;
          if (mentions(bys.slice(d.from, d.to), imp.local)) {
            mark(by, d.names[0] as string);
            hit = true;
          }
        }
        if (!hit) mark(by, '<module>');
      }
    }
    return tainted;
  }

  const CALL_SITES = ALL.filter((f) => new RegExp(SYSTEM_UI.source).test(SRC.get(f) as string));
  const ROUTES = ROUTE_FILES.map((f) => ({ f, r: routeOf(f) }));
  const LAYOUTS = files('app').filter((f) => /\/_layout\.tsx$/.test(f));

  /** Routes on which a call site can open its system UI. */
  function routesReaching(site: string): string[] {
    const t = taint(site);
    const out = new Set<string>();
    for (const { f, r } of ROUTES) if (t.has(f)) out.add(r);
    for (const l of LAYOUTS) {
      if (!t.has(l)) continue;
      const dir = l.replace(/_layout\.tsx$/, '');
      for (const { f, r } of ROUTES) if (f.startsWith(dir)) out.add(r);
    }
    return [...out].sort();
  }

  it('finds the known call sites (positive control: share sheets, push and microphone prompts, review)', () => {
    expect(CALL_SITES).toEqual(
      expect.arrayContaining([
        'app/(pairing)/invite.tsx',
        'src/features/badges/screens/MilestoneScreen.tsx',
        'src/features/history/exportHooks.ts',
        'src/features/push/device.ts',
        'src/features/review/review.ts',
        'src/features/voice/useVoiceRecorder.ts',
      ]),
    );
  });

  it('the symbol graph follows a wrapper to its screens (positive control: push prompt via the soft-ask)', () => {
    const t = taint('src/features/push/device.ts');
    expect([...(t.get('src/features/push/device.ts') ?? [])]).toContain('requestPermission');
    expect(t.has('src/features/push/softAsk.ts')).toBe(true);
    // getPermission (read-only) is what the root layout imports; it must not count.
    expect(t.has('app/_layout.tsx')).toBe(false);
    expect(routesReaching('app/(pairing)/invite.tsx')).toEqual(['(pairing)/invite']);
  });

  it('every call site is reached from at least one route (an unreached one would be an unknown surface)', () => {
    expect(CALL_SITES.filter((s) => routesReaching(s).length === 0)).toEqual([]);
  });

  it('no call site can open over a recorded (allow-listed) route', () => {
    const exposed = CALL_SITES.flatMap((s) =>
      routesReaching(s)
        .filter((r) => replayMayShow(r))
        .map((r) => `${s} -> ${r}`),
    );
    expect(exposed).toEqual([]);
  });
});

describe('QA-54 static: the flag stays off outside QA (SEC-23 C.9)', () => {
  it('no EAS build profile turns replay on', () => {
    const eas = JSON.parse(read('eas.json')) as { build: Record<string, { env?: Record<string, string> }> };
    const on = Object.entries(eas.build)
      .filter(([, p]) => (p.env?.EXPO_PUBLIC_ANALYTICS_REPLAY ?? '').trim() === '1')
      .map(([name]) => name);
    expect(on).toEqual([]);
  });

  it('.env.example ships it off, and no CI workflow sets it', () => {
    const example = read('.env.example').match(/^EXPO_PUBLIC_ANALYTICS_REPLAY=(.*)$/m);
    expect(example).not.toBeNull();
    expect((example?.[1] ?? '').trim()).not.toBe('1');
    const workflows = files('.github/workflows', /\.ya?ml$/).filter((f) =>
      /EXPO_PUBLIC_ANALYTICS_REPLAY\s*[:=]\s*['"]?1/.test(read(f)),
    );
    expect(workflows).toEqual([]);
  });

  it('app.config.ts does not force it on', () => {
    expect(/EXPO_PUBLIC_ANALYTICS_REPLAY\s*[:=]\s*['"]1/.test(read('app.config.ts'))).toBe(false);
  });
});
