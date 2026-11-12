import {
  hrefForPush,
  hrefFromUrl,
  isOnTarget,
  parsePushData,
  PUSH_TYPES,
  type PushHref,
} from '@/features/push/links';
import * as Notifications from 'expo-notifications';

import { littleThingChannels, littleThingSoundFile } from '@/features/littleThings/channels';
import { LITTLE_THING_KINDS } from '@/features/littleThings/model';
import {
  canRouteFrom,
  configureForegroundPresentation,
  openPushResponse,
  resetHandledPushes,
} from '@/features/push/routing';
import { questionTarget } from '@/features/push/screens/QuestionLinkScreen';
import { usePushRoute } from '@/features/push/store';

type Fixture = {
  case: string;
  type: string;
  title: string;
  body: string;
  channelId?: string;
  sound?: string;
  interruptionLevel?: string;
  data: { type: string; url: string; silent?: boolean; gesture?: string };
};
// QA's expected Expo messages (CONTRACTS §5): every one must route.
const payloads = require('../../../../qa/fixtures/push-payloads.json') as {
  messages: Fixture[];
  more_messages: Fixture[];
};
const fixtures = payloads.messages;
// QA-05b: the scheduled, little-thing and voice pushes (CONTRACTS §5), kept in their own list.
const moreFixtures = payloads.more_messages;

const CQ = '00000000-0000-4000-c000-000000000001';

const EXPECTED: Record<string, PushHref> = {
  'partner_answered to Maya': `/question/${CQ}`,
  'both_answered to Sam': `/question/${CQ}`,
  'thread single message': `/question/${CQ}/thread`,
  'ritual reminder default': '/today',
  'last call': '/today',
  nudge: '/today',
  'partner joined': '/today',
  'partner premium': '/packs',
};

describe('push links (CONTRACTS §5)', () => {
  it.each(fixtures.map((f) => [f.case, f] as const))('%s routes', (name, fixture) => {
    expect(hrefForPush(parsePushData(fixture.data))).toBe(EXPECTED[name]);
  });

  it('covers every fixture case', () => {
    expect(fixtures.map((f) => f.case).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('weekly recap opens 31', () => {
    expect(
      hrefForPush(parsePushData({ type: 'weekly_recap', url: 'bonded://history/recap' })),
    ).toBe('/history/recap');
  });

  it('knows all twelve push types (BE-48 trial_ending, BE-47 offer_ending, BE-45 little_thing)', () => {
    expect(PUSH_TYPES).toHaveLength(12);
  });

  it('little_thing (D48) opens Today, where 24d acts it out; extra fields are ignored', () => {
    const data = parsePushData({
      type: 'little_thing',
      url: 'bonded://today',
      gesture: 'hug',
      gestures: { kiss: 3, hug: 1 },
      silent: false,
    });
    expect(data).toEqual({ type: 'little_thing', url: 'bonded://today' });
    expect(hrefForPush(data)).toBe('/today');
    expect(hrefForPush(parsePushData({ type: 'little_thing', url: null }))).toBe('/today');
  });

  it('offer_ending (D52, 2 h before the day-3 gift ends) opens Today, where the chip reopens 15', () => {
    expect(hrefForPush(parsePushData({ type: 'offer_ending', url: 'bonded://today' }))).toBe(
      '/today',
    );
    expect(hrefForPush(parsePushData({ type: 'offer_ending', url: null }))).toBe('/today');
  });

  it('trial_ending (D50, day 5 of a P3 trial) opens Today, with or without its url', () => {
    expect(hrefForPush(parsePushData({ type: 'trial_ending', url: 'bonded://today' }))).toBe(
      '/today',
    );
    expect(hrefForPush(parsePushData({ type: 'trial_ending', url: null }))).toBe('/today');
  });

  it.each([
    ['bonded://today', '/today'],
    ['bonded:///today', '/today'],
    ['bonded://packs', '/packs'],
    ['bonded://history/recap', '/history/recap'],
    [`bonded://question/${CQ.toUpperCase()}`, `/question/${CQ}`],
    [`bonded://question/${CQ}/thread?x=1`, `/question/${CQ}/thread`],
  ])('%s -> %s', (url, href) => {
    expect(hrefFromUrl(url)).toBe(href);
  });

  it.each([
    'https://evil.example/today',
    'bonded://us/delete',
    'bonded://question/../../us/delete',
    'bonded://question/not-a-uuid',
    `bonded://question/${CQ}/answer`,
    'bonded://paywall',
    'javascript:alert(1)',
    '',
  ])('refuses %j', (url) => {
    expect(hrefFromUrl(url)).toBeNull();
  });

  it('falls back to the screen for the type when the url is unusable', () => {
    expect(hrefForPush({ type: 'partner_premium', url: 'bonded://us/delete' })).toBe('/packs');
    expect(hrefForPush({ type: 'weekly_recap', url: null })).toBe('/history/recap');
    expect(hrefForPush({ type: 'partner_answered', url: null })).toBe('/today');
  });

  it('opens Today for an unknown push and reads data defensively', () => {
    expect(parsePushData(null)).toEqual({ type: null, url: null });
    expect(parsePushData({ type: 'celebration', url: 42 })).toEqual({ type: null, url: null });
    expect(hrefForPush(parsePushData({ type: 'celebration' }))).toBe('/today');
  });

  it('knows when the person is already on the target', () => {
    expect(isOnTarget('/today/thread', `/question/${CQ}/thread`)).toBe(true);
    expect(isOnTarget('/today', `/question/${CQ}/thread`)).toBe(false);
    expect(isOnTarget('/today/answer', `/question/${CQ}`)).toBe(true);
    expect(isOnTarget('/today', `/question/${CQ}`)).toBe(false);
    expect(isOnTarget('/today', '/today')).toBe(true);
    expect(isOnTarget('/packs/p-1', '/packs')).toBe(true);
    expect(isOnTarget('/us', '/history/recap')).toBe(false);
  });

  it('waits past the front door, onboarding and sign-in before routing', () => {
    for (const path of ['/', '/welcome', '/sign-in', '/story/1', '/quiz/stage', '/join/code']) {
      expect(canRouteFrom(path)).toBe(false);
    }
    for (const path of ['/today', '/invite', '/reminders', '/us', '/today/thread']) {
      expect(canRouteFrom(path)).toBe(true);
    }
  });
});

const MORE_EXPECTED: Record<string, PushHref> = {
  'ritual reminder partner answered': '/today',
  'weekly recap': '/history/recap',
  'trial ending': '/today',
  'offer ending': '/today',
  'thread voice message': `/question/${CQ}/thread`,
  'little thing with sound': '/today',
  'little thing silent (quiet hours or sounds off)': '/today',
};

/** A tap on the fixture as expo-notifications hands it to the app. */
function tapResponse(fixture: Fixture, id: string): Notifications.NotificationResponse {
  return {
    actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
    notification: {
      date: 0,
      request: {
        identifier: id,
        content: { title: fixture.title, body: fixture.body, data: fixture.data },
        trigger: null,
      },
    },
  } as unknown as Notifications.NotificationResponse;
}

function moreFixture(predicate: (f: Fixture) => boolean): Fixture {
  const found = moreFixtures.find(predicate);
  if (!found) throw new Error('fixture missing');
  return found;
}

describe('more push fixtures (QA-05b, CONTRACTS §5)', () => {
  beforeEach(() => {
    resetHandledPushes();
    usePushRoute.setState({ pending: null, banner: null });
  });

  it('covers every more_messages case', () => {
    expect(moreFixtures.map((f) => f.case).sort()).toEqual(Object.keys(MORE_EXPECTED).sort());
  });

  it.each(moreFixtures.map((f) => [f.case, f] as const))(
    '%s routes through the tap handler',
    (name, fixture) => {
      expect(fixture.data.type).toBe(fixture.type);
      expect(hrefForPush(parsePushData(fixture.data))).toBe(MORE_EXPECTED[name]);
      openPushResponse(tapResponse(fixture, `more-${name}`));
      expect(usePushRoute.getState().pending).toBe(MORE_EXPECTED[name]);
    },
  );

  it.each(moreFixtures.map((f) => [f.case, f] as const))(
    '%s arrives on a channel the app creates',
    (_name, fixture) => {
      // device.ts ensureChannels: one channel per push type except little_thing, plus the six
      // little-thing channels. A channel the app never creates falls back to Expo's default.
      const ids: string[] = [
        ...PUSH_TYPES.filter((type) => type !== 'little_thing'),
        ...littleThingChannels().map((c) => c.id),
      ];
      expect(ids).toContain(fixture.channelId);
    },
  );

  it('a little thing with sound uses its gesture channel and a bundled sound', () => {
    const fixture = moreFixture((f) => f.case === 'little thing with sound');
    expect(fixture.data.silent).toBe(false);
    const gesture = LITTLE_THING_KINDS.find((kind) => kind === fixture.data.gesture);
    expect(gesture).toBeDefined();
    if (!gesture) return;
    const channel = littleThingChannels().find((c) => c.id === fixture.channelId);
    expect(channel).toMatchObject({ id: `little_thing_${gesture}`, quiet: false });
    expect(fixture.sound).toBe(littleThingSoundFile(gesture));
    expect(channel?.sound).toBe(fixture.sound);
  });

  it('a silent little thing lands on the quiet channel, plays nothing and still opens Today', async () => {
    const fixture = moreFixture((f) => f.data.type === 'little_thing' && f.data.silent === true);
    expect(fixture.sound).toBeUndefined();
    expect(fixture.interruptionLevel).toBe('passive');
    // The app's quiet channel: low importance, no sound, no vibration (device.ts).
    expect(littleThingChannels().find((c) => c.id === fixture.channelId)).toMatchObject({
      id: 'little_thing_quiet',
      quiet: true,
      sound: null,
    });
    // In the foreground the app never plays a push sound, silent or not.
    const setHandler = jest.mocked(Notifications.setNotificationHandler);
    setHandler.mockClear();
    configureForegroundPresentation();
    const handler = setHandler.mock.calls[0]?.[0];
    const behaviour = await handler?.handleNotification(
      tapResponse(fixture, 'silent-arrival').notification,
    );
    expect(behaviour?.shouldPlaySound).toBe(false);
    // `silent` is not part of the route (the app cannot tell quiet hours from sounds off and does
    // not need to): the tap opens Today like any little thing.
    expect(parsePushData(fixture.data)).toEqual({ type: 'little_thing', url: 'bonded://today' });
    openPushResponse(tapResponse(fixture, 'silent-little-thing'));
    expect(usePushRoute.getState().pending).toBe('/today');
  });

  it('a second delivery of the same tap does not route again', () => {
    const fixture = moreFixture((f) => f.case === 'weekly recap');
    openPushResponse(tapResponse(fixture, 'recap-once'));
    usePushRoute.getState().consume();
    openPushResponse(tapResponse(fixture, 'recap-once'));
    expect(usePushRoute.getState().pending).toBeNull();
  });
});

describe('questionTarget (bonded://question/<id>)', () => {
  const base = {
    linkId: CQ,
    thread: false,
    hasCouple: true,
    todayId: CQ,
    answered: false,
    partnerAnswered: false,
    revealedHere: false,
  };

  it.each([
    ['not answered yet: 19', {}, '/today/answer'],
    ['partner answered, I have not: 19', { partnerAnswered: true }, '/today/answer'],
    ['I answered, partner not yet: 23', { answered: true }, '/today'],
    ['both answered: 20', { answered: true, partnerAnswered: true }, '/today/reveal'],
    [
      'both answered and revealed here: 21',
      { answered: true, partnerAnswered: true, revealedHere: true },
      '/today/revealed',
    ],
    ['thread: 22', { thread: true }, '/today/thread'],
    ['an older question: 30', { todayId: 'other' }, `/history/${CQ}`],
    [
      'older question thread: 22 in history',
      { todayId: 'other', thread: true },
      `/history/${CQ}/thread`,
    ],
    ['no couple any more: front door', { hasCouple: false }, '/'],
  ])('%s', (_name, patch, expected) => {
    expect(questionTarget({ ...base, ...patch })).toBe(expected);
  });
});
