// QA-08 (D54, RC PRIV-01): no answer or message text, names, emails, invite codes, key-date
// titles, feedback, push tokens or voice paths in analytics payloads, Sentry events or logs.
//
// One layer below the device: the app's real analytics wrapper (src/lib/analytics) drives the
// real PostHog SDK (posthog-react-native) with the app's real options, and the fetch seam
// captures every HTTP request the SDK makes. Every fixture string from
// qa/fixtures/privacy-strings.json is pushed through every catalogue event, the super and person
// properties and identify; then the captured request bodies and URLs are grepped for them.
// Also: no autocapture / replay / lifecycle / exception events, no advertising id or device
// name, requests only to the EU host, and after the 40 "Share usage data" opt-out not one more
// request (also after a restart). Logs: console output during all of it, plus a source check of
// every console call in the app and every log call in the Edge Functions.
import { gunzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EVENT_NAMES, EVENTS, type EventName, type Spec } from '@/lib/analytics/catalogue';
import {
  analyticsEnabled,
  identifyUser,
  optOutOfAnalytics,
  resetUser,
  setAnalyticsForTests,
  setPersonProperties,
  setSuperProperties,
  track,
  trackScreen,
} from '@/lib/analytics/client';
import { memoryStorage } from '@/test/memoryStorage';

import personas from '../fixtures/personas.json';
import strings from '../fixtures/privacy-strings.json';

const MAYA = personas.personas.maya.id;
const COUPLE = personas.couples.maya_sam.id;

const { _meta, ...groups } = strings;
void _meta;
/** Every string that must never leave the phone, with the group it belongs to. */
const CONTENT: { group: string; text: string }[] = Object.entries(groups).flatMap(([group, list]) =>
  (list as string[]).map((text) => ({ group, text })),
);

/** Events the SDK sends for identify(); everything else must be a catalogue event. */
const SDK_EVENTS = new Set(['$identify', '$set']);
const EU_HOSTS = new Set(['eu.i.posthog.com', 'eu-assets.i.posthog.com']);

type Request = { url: string; method: string; body: string };

const g = globalThis as unknown as { __qaFetch?: typeof fetch };
let requests: Request[] = [];
let pending: Promise<void>[] = [];
let logs: string[] = [];

async function bodyText(body: unknown): Promise<string> {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  let bytes: Buffer;
  if (body instanceof Blob) bytes = Buffer.from(await body.arrayBuffer());
  else if (body instanceof ArrayBuffer) bytes = Buffer.from(body);
  else if (ArrayBuffer.isView(body)) bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  else return String(body);
  // gzip magic: the SDK may compress batches.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return bytes.toString('utf8');
}

function installNetwork() {
  requests = [];
  pending = [];
  g.__qaFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    pending.push(
      bodyText(init?.body).then((body) => {
        requests.push({ url, method: init?.method ?? 'GET', body });
      }),
    );
    const payload = url.includes('/config') ? '{}' : '{"status":1}';
    return Promise.resolve(
      new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  }) as typeof fetch;
}

/** Let the SDK's queued flushes and our body decoding finish (no wall-clock waits). */
async function settle() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.all(pending);
  }
}

/** The events inside every captured batch body. */
function sentEvents(): { event: string; properties: Record<string, unknown> }[] {
  return requests
    .filter((r) => r.body.startsWith('{') || r.body.startsWith('['))
    .flatMap((r) => {
      const parsed = JSON.parse(r.body) as { batch?: unknown[] } | unknown[];
      const batch = Array.isArray(parsed) ? parsed : (parsed.batch ?? []);
      return batch as { event: string; properties: Record<string, unknown> }[];
    });
}

function leaks(haystack: string): string[] {
  return CONTENT.filter(({ text }) => haystack.includes(text)).map((c) => `${c.group}: ${c.text}`);
}

// ---------- payloads ----------

function sample(spec: Spec): unknown {
  switch (spec.kind) {
    case 'bool':
      return true;
    case 'count':
      return 1;
    case 'int':
      return -2;
    case 'enum':
      return spec.values[0];
    case 'enumList':
      return [spec.values[0]];
    case 'uuid':
      return COUPLE;
    case 'slug':
      return 'streak_7';
    case 'emoji':
      return '❤️';
    case 'route':
      return 'app/(tabs)/history/[questionId]';
    case 'version':
      return '1.0.0';
    case 'date':
      return '2026-11-09';
    case 'datetime':
      return '2026-11-09T08:30:00.000Z';
  }
}

const specsOf = (name: EventName): Record<string, Spec> => EVENTS[name];

function validPayload(name: EventName): Record<string, unknown> {
  return Object.fromEntries(Object.entries(specsOf(name)).map(([k, s]) => [k, sample(s)]));
}

/** Extra keys a careless call site might add (only possible through a cast). */
function sneaky(i: number): Record<string, unknown> {
  const pick = (n: number) => CONTENT[(i + n) % CONTENT.length]!.text;
  return {
    text: pick(0),
    answer: pick(1),
    message: pick(2),
    partner_name: pick(3),
    email: pick(4),
    code: pick(5),
    title: pick(6),
    $set: { name: pick(7), email: pick(4) },
    $current_url: `https://hellobonded.com/${pick(8)}`,
    $screen_name: pick(9),
    nested: { body: pick(10), list: [pick(11)] },
  };
}

const anyTrack = track as (event: string, props?: Record<string, unknown>) => void;

/** Every catalogue event: once valid (+ sneaky keys), then each string field replaced by content. */
function driveAllEvents() {
  let i = 0;
  for (const name of EVENT_NAMES) {
    anyTrack(name, { ...validPayload(name), ...sneaky(i++) });
    for (const [key, spec] of Object.entries(specsOf(name))) {
      if (spec.kind === 'bool' || spec.kind === 'count' || spec.kind === 'int') continue;
      for (const { text } of CONTENT) {
        anyTrack(name, { ...validPayload(name), [key]: text });
        anyTrack(name, { ...validPayload(name), [key]: [text] });
      }
    }
  }
  // Screen views from a path with values in it, instead of the route name.
  for (const { text } of CONTENT) {
    trackScreen(`/history/${text}`);
    trackScreen(`app/j/${text}`);
    trackScreen(text);
  }
}

function driveIdentity() {
  const anySuper = setSuperProperties as (p: Record<string, unknown>) => void;
  const anyPerson = setPersonProperties as (p: Record<string, unknown>) => void;
  const anyIdentify = identifyUser as (id: string, p?: Record<string, unknown>) => void;
  anySuper({
    signed_in: true,
    couple_state: 'paired',
    couple_id: COUPLE,
    is_test_account: true,
    streak: 3,
  });
  anyIdentify(MAYA, {
    signup_method: 'email',
    stage: 'long_distance',
    email: 'maya@bonded.test',
    name: 'Maya',
    $email: 'maya@bonded.test',
  });
  for (const [i, { text }] of CONTENT.entries()) {
    anySuper({ couple_state: text, couple_id: text, app_version: text, partner_name: text });
    anyPerson({ stage: text, goals: [text], ritual_time: text, plan: text, display_name: text });
    anyPerson({ role: i % 2 ? 'starter' : 'joiner', email: text });
  }
}

// Console output of the whole file is collected (and kept off the test output).
const consoleSpies: jest.SpyInstance[] = [];
beforeAll(() => {
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    consoleSpies.push(
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }),
    );
  }
});

afterAll(() => {
  for (const spy of consoleSpies) spy.mockRestore();
  delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  delete g.__qaFetch;
  setAnalyticsForTests({ storage: memoryStorage() });
});

describe('QA-08 PostHog payloads on the wire (real SDK, app options)', () => {
  let storage: ReturnType<typeof memoryStorage>;
  let wire: string;
  let sent: number;

  beforeAll(async () => {
    installNetwork();
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_qa08_privacy';
    delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
    storage = memoryStorage();
    // Real SDK: only the storage is swapped (the default factory loads posthog-react-native).
    setAnalyticsForTests({ storage });
    expect(analyticsEnabled()).toBe(true);
    driveIdentity();
    driveAllEvents();
    resetUser();
    driveIdentity();
    // The opt-out flushes the queue: everything captured so far goes out now.
    await optOutOfAnalytics();
    await settle();
    wire = requests.map((r) => `${r.method} ${r.url}\n${r.body}`).join('\n');
    sent = requests.length;
  }, 120_000);

  it('the SDK really sent the catalogue events (positive control)', () => {
    const names = new Set(sentEvents().map((e) => e.event));
    for (const name of EVENT_NAMES) expect({ name, sent: names.has(name) }).toEqual({ name, sent: true });
    expect(names.has('$identify')).toBe(true);
  });

  it('no fixture content in any request body or URL', () => {
    expect(wire.length).toBeGreaterThan(10_000);
    expect(leaks(wire)).toEqual([]);
  });

  it('only catalogue events and identify: no autocapture, replay, lifecycle, exceptions, flags', () => {
    const extra = sentEvents()
      .map((e) => e.event)
      .filter((e) => !SDK_EVENTS.has(e) && !(EVENT_NAMES as readonly string[]).includes(e));
    expect([...new Set(extra)]).toEqual([]);
  });

  it('no advertising id, device name, IP, URL or screen text property', () => {
    const bad = /advertis|idfa|gaid|adid|\$device_name|\$ip$|\$current_url|\$screen_name|\$elements/i;
    const found = new Set<string>();
    for (const { properties } of sentEvents()) {
      for (const [key, value] of Object.entries(properties ?? {})) {
        if (bad.test(key) && value != null) found.add(key);
      }
    }
    expect([...found]).toEqual([]);
  });

  it('person properties are §2 ids only (no email or name)', () => {
    const personKeys = new Set<string>();
    for (const { properties } of sentEvents()) {
      for (const k of ['$set', '$set_once']) {
        for (const key of Object.keys((properties?.[k] as object) ?? {})) personKeys.add(key);
      }
    }
    const allowed = [
      'signup_method',
      'signed_up_at',
      'stage',
      'goals',
      'ritual_time',
      'push_enabled',
      'paired_at',
      'is_premium',
      'plan',
      'role',
    ];
    expect([...personKeys].filter((k) => !allowed.includes(k))).toEqual([]);
  });

  it('requests go to the EU host only, never to replay, flags or surveys endpoints', () => {
    const urls = requests.map((r) => new URL(r.url));
    expect(urls.length).toBeGreaterThan(0);
    expect([...new Set(urls.map((u) => u.hostname))].filter((h) => !EU_HOSTS.has(h))).toEqual([]);
    const paths = urls.map((u) => u.pathname);
    expect(paths.filter((p) => /^\/(s|decide|flags|surveys|api\/surveys)\b/.test(p))).toEqual([]);
  });

  it('after the opt-out: no request at all, also after a restart', async () => {
    const before = sent;
    expect(requests.length).toBe(before);
    driveIdentity();
    driveAllEvents();
    await settle();
    expect(requests.slice(before)).toEqual([]);

    // Restart: a fresh module state on the same device storage (the choice survives).
    setAnalyticsForTests({ storage });
    expect(analyticsEnabled()).toBe(false);
    driveIdentity();
    driveAllEvents();
    await settle();
    expect(requests.slice(before)).toEqual([]);
  }, 60_000);

  it('no fixture content in console output', () => {
    expect(leaks(logs.join('\n'))).toEqual([]);
  });
});

// ---------- logs: source checks ----------

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      return ['__tests__', 'node_modules', 'test'].includes(e.name) ? [] : files(p, ext);
    }
    return ext.test(e.name) && !/(_test|\.test|\.d)\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('QA-08 logs: every log call site', () => {
  it('app (src/, app/): console calls only inside a __DEV__ guard (release builds log nothing)', () => {
    const unguarded: string[] = [];
    for (const file of [...files('src', /\.tsx?$/), ...files('app', /\.tsx?$/)]) {
      if (file.startsWith(join('src', 'test'))) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/\bconsole\.(log|info|warn|error|debug|trace)\(/.test(line)) return;
        const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
        if (!/__DEV__/.test(context)) unguarded.push(`${file}:${i + 1}`);
      });
    }
    expect(unguarded).toEqual([]);
  });

  it('Edge Functions: console only in _shared/log.ts; log() metadata keys hold no content', () => {
    const contentKey =
      /answer|body|message|text|preview|name|email|title|code|token|url|link|path|content|note|feedback|reply/i;
    const stray: string[] = [];
    const badKeys: string[] = [];
    for (const file of files(join('supabase', 'functions'), /\.ts$/)) {
      const src = readFileSync(file, 'utf8');
      if (!file.endsWith(join('_shared', 'log.ts')) && /\bconsole\.\w+\(/.test(src)) {
        stray.push(file);
      }
      for (const m of src.matchAll(/\blog\(\s*(['"`][^'"`]+['"`])\s*(?:,\s*\{([^}]*)\})?/g)) {
        const keys = (m[2] ?? '')
          .split(',')
          .map((part) => part.split(':')[0]!.trim())
          .filter(Boolean);
        for (const key of keys) if (contentKey.test(key)) badKeys.push(`${file} ${m[1]}: ${key}`);
      }
    }
    expect(stray).toEqual([]);
    expect(badKeys).toEqual([]);
  });

  it('Edge Functions: the shared logger redacts the text keys', () => {
    const src = readFileSync(join('supabase', 'functions', '_shared', 'log.ts'), 'utf8');
    for (const key of ['answer', 'body', 'message', 'preview', 'text']) {
      expect(src).toContain(`'${key}'`);
    }
  });
});

// ---------- Sentry ----------

// QA-08 Sentry: qa/app/sentry-privacy.test.ts (the app's real beforeSend / beforeBreadcrumb with
// every fixture string in every event field and breadcrumb category).
