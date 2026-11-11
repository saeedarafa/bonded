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
  identifyUser,
  isOptedOut,
  optInToAnalytics,
  optOutOfAnalytics,
  resetUser,
  setAnalyticsForTests,
  setPersonProperties,
  setSuperProperties,
  track,
  type AnalyticsClient,
} from '@/lib/analytics/client';
import { memoryStorage } from '@/test/memoryStorage';
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
  'https://trybonded.com/j/BND4827?t=abc',
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
