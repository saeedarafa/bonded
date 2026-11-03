import {
  hrefForPush,
  hrefFromUrl,
  isOnTarget,
  parsePushData,
  PUSH_TYPES,
  type PushHref,
} from '@/features/push/links';
import { canRouteFrom } from '@/features/push/routing';
import { questionTarget } from '@/features/push/screens/QuestionLinkScreen';

type Fixture = { case: string; type: string; data: { type: string; url: string } };
// QA's expected Expo messages (CONTRACTS §5): every one must route.
const fixtures = (require('../../../../qa/fixtures/push-payloads.json') as { messages: Fixture[] })
  .messages;

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

  it('knows all nine push types', () => {
    expect(PUSH_TYPES).toHaveLength(9);
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
