import {
  EVENTS,
  EVENT_NAMES,
  durationBucket,
  lengthBucket,
  sanitizeEvent,
  type EventName,
  type Spec,
} from '@/lib/analytics/catalogue';
import {
  analyticsEnabled,
  beforeSend,
  clientOptions,
  identifyUser,
  REPLAY_CONFIG,
  isOptedOut,
  optInToAnalytics,
  optOutOfAnalytics,
  pauseForAccountDeletion,
  resetUser,
  resumeAfterAccountDeletion,
  setAnalyticsForTests,
  setPersonProperties,
  setSuperProperties,
  track,
  type AnalyticsClient,
} from '@/lib/analytics/client';
import { memoryStorage } from '@/test/memoryStorage';
import { readSource, sourceFiles } from '@/test/sourceFiles';
import type { PostHogOptions } from 'posthog-react-native';

/**
 * MOB-24 (D54): every catalogue event fires once with only its allowed keys, and the typed API
 * plus the runtime checks make content (answers, messages, names, emails, invite codes, key-date
 * titles) impossible to send. QA-08 checks the same on captured device payloads.
 */

// Jest runs in Node, but the app tsconfig has no Node types (see src/test/sourceFiles.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };

type Captured = { event: string; props: Record<string, unknown> };

function recorder() {
  const captured: Captured[] = [];
  const identified: { id: string; props: Record<string, unknown> }[] = [];
  const registered: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const people: Record<string, unknown>[] = [];
  const client: AnalyticsClient = {
    capture: jest.fn((event: string, props?: Record<string, unknown>) => {
      captured.push({ event, props: props ?? {} });
    }) as never,
    identify: jest.fn((id?: string, props?: Record<string, unknown>) => {
      identified.push({ id: id ?? '', props: props ?? {} });
    }) as never,
    setPersonProperties: jest.fn((props?: Record<string, unknown>) => {
      people.push(props ?? {});
    }) as never,
    reset: jest.fn(() => calls.push('reset')) as never,
    register: jest.fn((props: Record<string, unknown>) => {
      registered.push(props);
      return Promise.resolve();
    }) as never,
    optOut: jest.fn(() => {
      calls.push('optOut');
      return Promise.resolve();
    }) as never,
    optIn: jest.fn(() => {
      calls.push('optIn');
      return Promise.resolve();
    }) as never,
    flush: jest.fn(() => {
      calls.push('flush');
      return Promise.resolve();
    }) as never,
    setPersistedProperty: jest.fn((key: string, value: unknown) => {
      calls.push(`set:${key}=${JSON.stringify(value)}`);
    }) as never,
    startSessionRecording: jest.fn((resume?: boolean) => {
      calls.push(`startReplay:${String(resume)}`);
      return Promise.resolve();
    }) as never,
    stopSessionRecording: jest.fn(() => {
      calls.push('stopReplay');
      return Promise.resolve();
    }) as never,
  };
  return { client, captured, identified, registered, calls, people };
}

const UUID = '00000000-0000-4000-a000-00000000a001';

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
      return UUID;
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

function samplePayload(name: EventName): Record<string, unknown> {
  const specs: Record<string, Spec> = EVENTS[name];
  return Object.fromEntries(Object.entries(specs).map(([k, s]) => [k, sample(s)]));
}

/** Content that must never reach PostHog (qa/privacy uses the FIXTURE- prefix too). */
const CONTENT = [
  'FIXTURE-ANSWER I felt closest to you on the beach last summer',
  'FIXTURE-MESSAGE haha yes, same',
  'Maya',
  'maya@bonded.test',
  'BND4827',
  'https://hellobonded.com/j/BND4827?t=abc',
  'Our anniversary',
  'anniversary dinner at Luigi’s',
  'deep talks',
  'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  'file:///data/voice/answer.m4a',
  '',
];

let rec: ReturnType<typeof recorder>;
let factory: jest.Mock;

beforeEach(() => {
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
  rec = recorder();
  factory = jest.fn(() => rec.client);
  setAnalyticsForTests({ factory, storage: memoryStorage() });
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
  delete process.env.EXPO_PUBLIC_ANALYTICS_REPLAY;
  delete process.env.EXPO_PUBLIC_ANALYTICS_TEST_BUILD;
});

describe('catalogue (ANALYTICS.md §3)', () => {
  it('lists exactly the events of ANALYTICS.md §3', () => {
    const doc = fs.readFileSync('docs/ANALYTICS.md', 'utf8');
    const section = doc.slice(doc.indexOf('## 3. Events'), doc.indexOf('## 4.'));
    const documented = new Set<string>();
    for (const line of section.split('\n')) {
      const first = /^\| ([^|]+)\|/.exec(line)?.[1];
      if (!first) continue;
      for (const m of first.matchAll(/`([a-z_]+)`/g)) documented.add(m[1]!);
    }
    expect([...documented].sort()).toEqual([...EVENT_NAMES].sort());
  });

  it.each(EVENT_NAMES)('%s fires once with only its allowed keys', (name) => {
    const payload = samplePayload(name);
    (track as (e: string, p?: Record<string, unknown>) => void)(name, {
      ...payload,
      // Extra keys a caller might sneak in (only possible through a cast): never sent.
      text: 'FIXTURE-ANSWER secret',
      partner_name: 'Maya',
    });
    expect(rec.captured).toHaveLength(1);
    const sent = rec.captured[0]!;
    expect(sent.event).toBe(name);
    expect(Object.keys(sent.props).sort()).toEqual(Object.keys(payload).sort());
    const allowed = Object.keys(EVENTS[name]);
    for (const key of Object.keys(sent.props)) expect(allowed).toContain(key);
    // And the last gate lets it through unchanged.
    const gated = beforeSend({ event: name, properties: sent.props as never });
    expect(gated?.properties).toEqual(sent.props);
  });

  it('no string property accepts content: answers, names, emails, codes, titles, tokens', () => {
    for (const name of EVENT_NAMES) {
      const specs: Record<string, Spec> = EVENTS[name];
      for (const [key, spec] of Object.entries(specs)) {
        if (spec.kind === 'bool' || spec.kind === 'count' || spec.kind === 'int') continue;
        for (const text of CONTENT) {
          const out = sanitizeEvent(name, { ...samplePayload(name), [key]: text });
          if (spec.optional) expect(out).not.toHaveProperty(key);
          else expect(out).toBeNull();
          const list = sanitizeEvent(name, { ...samplePayload(name), [key]: [text] });
          if (list) expect(list).not.toHaveProperty(key, [text]);
        }
      }
    }
  });

  it('rejects malformed values and unknown events', () => {
    expect(sanitizeEvent('answer_text_sent', { text: 'hi' })).toBeNull();
    expect(sanitizeEvent('reaction_added', { emoji: 'love it', target: 'answer' })).toBeNull();
    expect(sanitizeEvent('reaction_added', { emoji: '❤️', target: 'answer' })).toEqual({
      emoji: '❤️',
      target: 'answer',
    });
    expect(sanitizeEvent('reaction_added', { emoji: '👍🏽', target: 'message' })).not.toBeNull();
    expect(sanitizeEvent('screen_viewed', { screen: 'app/(tabs)/history/0000-1111' })).toBeNull();
    expect(sanitizeEvent('screen_viewed', { screen: 'app/j/BND4827' })).toBeNull();
    expect(sanitizeEvent('milestone_viewed', { n: 2.5 })).toBeNull();
    expect(sanitizeEvent('milestone_viewed', { n: -1 })).toBeNull();
    expect(sanitizeEvent('badge_earned', { badge_id: 'Our Anniversary' })).toBeNull();
    expect(sanitizeEvent('little_thing_sent', { kind: 'hug', amount: 1 })).toEqual({
      kind: 'hug',
      amount: 1,
    });
  });

  it('types: no free-text field and no unknown event compiles', () => {
    const typeOnly = () => {
      // @ts-expect-error not a catalogue event
      track('answer_text_sent', { text: 'hi' });
      track('answer_submitted', {
        question_id: UUID,
        pack_id: null,
        kind: 'text',
        partner_answered: false,
        edited: false,
        offline_queued: false,
        // @ts-expect-error no text property on answer_submitted
        text: 'my answer',
      });
      // @ts-expect-error kind is a fixed list
      track('little_thing_sent', { kind: 'a long hug from Maya', amount: 1 });
      // @ts-expect-error required properties
      track('sign_in_started');
      track('signed_out');
      track('feedback_sent', {});
    };
    expect(typeof typeOnly).toBe('function');
  });

  it('buckets lengths and durations, never the text', () => {
    expect([0, 49, 50, 150, 151].map(lengthBucket)).toEqual([
      '<50',
      '<50',
      '50-150',
      '50-150',
      '150+',
    ]);
    expect([0, 14_999, 15_000, 45_000, 45_001].map(durationBucket)).toEqual([
      '<15s',
      '<15s',
      '15-45s',
      '15-45s',
      '45s+',
    ]);
  });
});

describe('client', () => {
  it('is a no-op without a key: the SDK is never created', () => {
    delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
    setAnalyticsForTests({ factory, storage: memoryStorage() });
    track('signed_out');
    identifyUser(UUID);
    setSuperProperties({ streak: 3 });
    resetUser();
    expect(analyticsEnabled()).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it('turns off autocapture, replay, surveys, flags, lifecycle and push-token capture (EU host)', () => {
    track('signed_out');
    expect(factory).toHaveBeenCalledTimes(1);
    const [key, options] = factory.mock.calls[0] as [string, PostHogOptions];
    expect(key).toBe('phc_test');
    expect(options).toMatchObject({
      host: 'https://eu.i.posthog.com',
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
      disableSurveys: true,
      preloadFeatureFlags: false,
      disableRemoteFeatureFlags: true,
      personProfiles: 'identified_only',
      errorTracking: { autocapture: false },
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
    });
    const app = (options.customAppProperties as (p: object) => Record<string, unknown>)({
      $device_name: "Maya's iPhone",
      $os_name: 'iOS',
    });
    expect(app.$device_name).toBeNull();
    expect(app.$os_name).toBe('iOS');
  });

  it('ignores a non-https host', () => {
    process.env.EXPO_PUBLIC_POSTHOG_HOST = 'http://evil.example';
    track('signed_out');
    expect((factory.mock.calls[0] as [string, { host: string }])[1].host).toBe(
      'https://eu.i.posthog.com',
    );
  });

  it('before_send drops autocapture, screens, exceptions and anything not in the catalogue', () => {
    for (const event of [
      '$autocapture',
      '$screen',
      '$exception',
      '$rageclick',
      'Application Opened',
    ]) {
      expect(beforeSend({ event, properties: {} })).toBeNull();
    }
  });

  it('before_send keeps §2 and SDK properties, strips unknown ones and filters $set', () => {
    const out = beforeSend({
      event: 'streak_extended',
      properties: {
        streak: 4,
        couple_state: 'paired',
        couple_id: UUID,
        is_premium: false,
        partner_name: 'Maya',
        answer: 'FIXTURE-ANSWER',
        $lib: 'posthog-react-native',
        $session_id: 'abc',
        $device_name: "Maya's iPhone",
        $screen_name: 'Today',
        $set: { email: 'maya@bonded.test', name: 'Maya', stage: 'dating' },
      } as never,
      $set: { email: 'maya@bonded.test', plan: 'yearly' } as never,
    });
    expect(out?.properties).toEqual({
      streak: 4,
      couple_state: 'paired',
      couple_id: UUID,
      is_premium: false,
      $lib: 'posthog-react-native',
      $session_id: 'abc',
      $set: { stage: 'dating' },
    });
    expect(out?.$set).toEqual({ plan: 'yearly' });
    expect(
      beforeSend({
        event: '$identify',
        properties: { $set: { name: 'Maya', role: 'joiner' } } as never,
      })?.properties,
    ).toEqual({ $set: { role: 'joiner' } });
  });

  it('identify uses the user uuid and §2 person properties only; reset forgets the person', () => {
    identifyUser(UUID, {
      signup_method: 'email',
      ...({ email: 'maya@bonded.test', name: 'Maya' } as object),
    });
    expect(rec.identified).toEqual([{ id: UUID, props: { $set: { signup_method: 'email' } } }]);
    setPersonProperties({ stage: 'dating', ...({ partner_name: 'Sam' } as object) });
    setPersonProperties({ stage: 'dating' });
    setPersonProperties({ ...({ email: 'maya@bonded.test' } as object) });
    expect(rec.people).toEqual([{ stage: 'dating' }]);
    setSuperProperties({ platform: 'ios', couple_state: 'paired', couple_id: UUID, streak: 2 });
    expect(rec.registered.at(-1)).toEqual({
      platform: 'ios',
      couple_state: 'paired',
      couple_id: UUID,
      streak: 2,
    });
    resetUser();
    expect(rec.calls).toContain('reset');
    // A later register carries the install's properties, not the old couple's.
    setSuperProperties({ signed_in: false });
    expect(rec.registered.at(-1)).toEqual({ platform: 'ios', signed_in: false });
  });

  it('super properties drop malformed values', () => {
    setSuperProperties({
      streak: 2,
      ...({ couple_id: 'Maya & Sam', partner_name: 'Sam' } as object),
    });
    track('signed_out');
    expect(rec.registered.at(-1)).toEqual({ streak: 2 });
  });

  it('opt-out: analytics_opted_out is the last event, then optOut; stored; survives a restart', async () => {
    const storage = memoryStorage();
    setAnalyticsForTests({ factory, storage });
    track('signed_out');
    await optOutOfAnalytics();
    expect(rec.captured.map((c) => c.event)).toEqual(['signed_out', 'analytics_opted_out']);
    expect(rec.calls).toEqual(['flush', 'optOut']);
    expect(isOptedOut()).toBe(true);
    track('signed_out');
    expect(rec.captured).toHaveLength(2);

    // Restart: same device storage, a fresh module state. The SDK is not even created.
    factory.mockClear();
    setAnalyticsForTests({ factory, storage });
    track('app_opened', { source: 'icon' });
    expect(analyticsEnabled()).toBe(false);
    expect(factory).not.toHaveBeenCalled();

    await optInToAnalytics();
    expect(isOptedOut()).toBe(false);
    track('app_opened', { source: 'icon' });
    expect(rec.captured.at(-1)?.event).toBe('app_opened');
  });

  it('account deletion (SEC-16 Info 6): pause stops capture and drops the queue; deleted resets first', async () => {
    identifyUser(UUID);
    await pauseForAccountDeletion();
    expect(rec.calls).toEqual(['optOut', 'set:queue=null']);
    track('signed_out');
    setPersonProperties({ push_enabled: true });
    identifyUser('00000000-0000-4000-a000-00000000a002');
    expect(rec.captured).toEqual([]);
    expect(rec.people).toEqual([]);
    expect(rec.identified).toHaveLength(1);
    await resumeAfterAccountDeletion({ deleted: true });
    expect(rec.calls).toEqual(['optOut', 'set:queue=null', 'reset', 'optIn']);
    track('account_deleted');
    expect(rec.captured).toEqual([{ event: 'account_deleted', props: {} }]);
    // Anonymous now: person properties need a new identify.
    setPersonProperties({ push_enabled: true });
    expect(rec.people).toEqual([]);
  });

  it('account deletion that failed: capture resumes under the same person', async () => {
    identifyUser(UUID);
    await pauseForAccountDeletion();
    await resumeAfterAccountDeletion({ deleted: false });
    expect(rec.calls).toEqual(['optOut', 'set:queue=null', 'optIn']);
    setPersonProperties({ push_enabled: true });
    expect(rec.people).toEqual([{ push_enabled: true }]);
    // Resuming without a pause does nothing.
    await resumeAfterAccountDeletion({ deleted: true });
    expect(rec.calls).not.toContain('reset');
  });

  it('never sends an advertising id or device name', () => {
    track('app_opened', { source: 'icon' });
    const out = beforeSend({
      event: 'app_opened',
      properties: {
        source: 'icon',
        $advertising_id: 'x',
        $device_name: 'Sam',
        $ip: '1.2.3.4',
      } as never,
    });
    expect(out?.properties).toEqual({ source: 'icon' });
  });
});

/**
 * ANALYTICS §1 rule 3 (MOB-24, PO 2026-11-13): the shared PostHog project has web autocapture,
 * heatmaps, web vitals and exception autocapture ON for the website, so the app must switch every
 * capture feature off in its own init, explicitly, and never rely on project or SDK defaults.
 */
describe('PostHog init: autocapture, session replay and surveys off explicitly (§1 rule 3)', () => {
  const options = clientOptions('https://eu.i.posthog.com');

  it.each([
    // Session replay (SDK default false, but a project setting must never be able to turn it on).
    ['enableSessionReplay', false],
    // Surveys (the project may have surveys running for the website).
    ['disableSurveys', true],
    // Lifecycle autocapture (SDK default true).
    ['captureAppLifecycleEvents', false],
    // Feature flags and their auto events.
    ['preloadFeatureFlags', false],
    ['disableRemoteFeatureFlags', true],
    ['sendFeatureFlagEvent', false],
    // Device/person properties PostHog would set by itself.
    ['setDefaultPersonProperties', false],
    // Push autocapture.
    ['capturePushNotificationSubscriptions', false],
    ['capturePushNotificationOpened', false],
  ] as const)('%s is set to %p in the app (not left to a default)', (key, value) => {
    expect(options).toHaveProperty(key);
    expect(options[key as keyof PostHogOptions]).toBe(value);
  });

  it('exception autocapture is off explicitly', () => {
    expect(options.errorTracking).toEqual({ autocapture: false });
  });

  it('no session replay config at all without the D63 flag (MOB-87)', () => {
    expect(options).not.toHaveProperty('sessionReplayConfig');
  });

  it('every capture is checked again before it leaves the phone', () => {
    expect(options.before_send).toBe(beforeSend);
    expect(beforeSend({ event: '$autocapture', properties: {} })).toBeNull();
    expect(beforeSend({ event: '$heatmap', properties: {} })).toBeNull();
    expect(beforeSend({ event: '$web_vitals', properties: {} })).toBeNull();
    expect(beforeSend({ event: 'survey shown', properties: {} })).toBeNull();
    expect(beforeSend({ event: '$snapshot', properties: {} })).toBeNull();
  });

  it('touch and screen autocapture cannot run: no PostHogProvider, the SDK is loaded only in client.ts', () => {
    // `posthog-react-native` touch autocapture (`autocapture` prop), `captureScreens` and the
    // survey UI live on PostHogProvider / PostHogSurveyProvider. The app never renders them.
    const files = [...sourceFiles('app'), ...sourceFiles('src')];
    const users = files.filter((f) => /posthog-react-native/.test(readSource(f)));
    expect(users).toEqual(['src/lib/analytics/client.ts']);
    for (const f of files) {
      expect(readSource(f)).not.toMatch(/PostHogProvider|PostHogSurveyProvider|usePostHog\b/);
    }
  });
});

/**
 * D63 / SEC-23 A1, A4 (MOB-87): masked session replay only with EXPO_PUBLIC_ANALYTICS_REPLAY=1,
 * every replay switch set literally, never while "Share usage data" is off, stopped before the
 * opt-out, sign-out and account deletion.
 */
describe('session replay (D63, MOB-87)', () => {
  function optionsOfFirstClient(): PostHogOptions {
    track('signed_out');
    return (factory.mock.calls[0] as [string, PostHogOptions])[1];
  }

  it('is off unless the flag is exactly 1', () => {
    for (const value of [undefined, '', '0', 'true', 'yes']) {
      factory.mockClear();
      setAnalyticsForTests({ factory, storage: memoryStorage() });
      if (value === undefined) delete process.env.EXPO_PUBLIC_ANALYTICS_REPLAY;
      else process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = value;
      const o = optionsOfFirstClient();
      expect(o.enableSessionReplay).toBe(false);
      expect(o).not.toHaveProperty('sessionReplayConfig');
    }
  });

  it('with the flag: on, and every masking switch set literally (SEC-23 A1)', () => {
    process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
    const o = optionsOfFirstClient();
    expect(o.enableSessionReplay).toBe(true);
    expect(o.sessionReplayConfig).toEqual({
      maskAllTextInputs: true,
      maskAllImages: true,
      maskAllSandboxedViews: true,
      captureLog: false,
      captureNetworkTelemetry: false,
      captureTouches: false,
    });
    expect(o.sessionReplayConfig).not.toHaveProperty('sampleRate');
    expect(clientOptions('https://eu.i.posthog.com', true).sessionReplayConfig).toEqual(
      REPLAY_CONFIG,
    );
    // The rest of the D54 init stays off with replay on.
    expect(o).toMatchObject({
      disableSurveys: true,
      captureAppLifecycleEvents: false,
      errorTracking: { autocapture: false },
    });
  });

  it('a device that opted out never creates a client, so replay never starts', async () => {
    process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
    await optOutOfAnalytics();
    factory.mockClear();
    setAnalyticsForTests({ factory });
    track('signed_out');
    expect(factory).not.toHaveBeenCalled();
  });

  it('"Share usage data" off: replay stops first, then the opt-out', async () => {
    process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
    track('signed_out');
    rec.calls.length = 0;
    await optOutOfAnalytics();
    expect(rec.calls[0]).toBe('stopReplay');
    expect(rec.calls.indexOf('stopReplay')).toBeLessThan(rec.calls.indexOf('optOut'));
  });

  it('back on: a new client with replay on (a new session, not the old one)', async () => {
    process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
    await optOutOfAnalytics();
    factory.mockClear();
    await optInToAnalytics();
    expect(factory).toHaveBeenCalledTimes(1);
    expect((factory.mock.calls[0] as [string, PostHogOptions])[1].enableSessionReplay).toBe(true);
  });

  it('sign-out: stop, reset, then a new recording', async () => {
    process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
    identifyUser(UUID);
    rec.calls.length = 0;
    resetUser();
    await Promise.resolve();
    await Promise.resolve();
    expect(rec.calls).toEqual(['stopReplay', 'reset', 'startReplay:false']);
  });

  it('sign-out without the flag never touches the recorder', () => {
    identifyUser(UUID);
    rec.calls.length = 0;
    resetUser();
    expect(rec.calls).toEqual(['reset']);
  });

  it('account deletion: stopped before the opt-out, a new recording after', async () => {
    process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
    identifyUser(UUID);
    rec.calls.length = 0;
    await pauseForAccountDeletion();
    expect(rec.calls.slice(0, 2)).toEqual(['stopReplay', 'optOut']);
    rec.calls.length = 0;
    await resumeAfterAccountDeletion({ deleted: true });
    expect(rec.calls).toEqual(['stopReplay', 'reset', 'optIn', 'startReplay:false']);
  });

  it('a test build registers is_test_account before anything is recorded', () => {
    process.env.EXPO_PUBLIC_ANALYTICS_REPLAY = '1';
    process.env.EXPO_PUBLIC_ANALYTICS_TEST_BUILD = '1';
    track('signed_out');
    expect(rec.registered[0]).toMatchObject({ is_test_account: true });
  });
});
