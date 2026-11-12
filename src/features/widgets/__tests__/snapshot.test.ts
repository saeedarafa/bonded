import type { ActiveCouple } from '@/features/couple/api';
import type { TodayQuestion } from '@/features/daily/api';
import { normalizeStreak, type Streak } from '@/features/daily/today';

import {
  buildWidgetSnapshot,
  emptyWidgetSnapshot,
  firstName,
  sameForWidgets,
  WIDGET_SNAPSHOT_VERSION,
  type WidgetSources,
} from '../snapshot';

/**
 * MOB-30 / MOB-57 (D26, D47): what the widgets may know. Reveal rule (FUN-04): booleans, the
 * deadline, counts and the partner's first name only; never answer, message or question text.
 */

const ME = 'user-me';
const PARTNER = 'user-partner';
// Strings that must never reach the home or lock screen.
const PARTNER_ANSWER = 'SECRET-partner-answer-text';
const MY_ANSWER = 'SECRET-my-answer-text';
const MESSAGE = 'SECRET-thread-message';
const QUESTION = "What's a small thing I do that makes your day better?";

const NOW = new Date('2026-11-12T19:40:00Z'); // 20:40 in Europe/Berlin

function couple(over: Partial<ActiveCouple> = {}, members = [ME, PARTNER]): ActiveCouple {
  return {
    id: 'couple-1',
    timezone: 'Europe/Berlin',
    created_at: '2026-11-01T10:00:00Z',
    paired_at: '2026-11-01T12:00:00Z',
    partner_name: null,
    couple_members: members.map((user_id) => ({ user_id, left_at: null })),
    ...over,
  } as ActiveCouple;
}

/**
 * Today's question as the cache holds it, plus fields a careless builder could leak: answer
 * bodies, a message, the question text. The builder must copy none of them.
 */
function question(answeredBy: string[], answerCount = answeredBy.length): TodayQuestion {
  return {
    id: 'cq-1',
    questionId: 'q-1',
    source: 'daily',
    answerCount,
    question: QUESTION,
    answers: answeredBy.map((userId) => ({
      userId,
      createdAt: '2026-11-12T18:00:00Z',
      body: userId === ME ? MY_ANSWER : PARTNER_ANSWER,
      text: userId === ME ? MY_ANSWER : PARTNER_ANSWER,
    })),
    lastMessage: MESSAGE,
  } as unknown as TodayQuestion;
}

const streak = (over: Partial<Streak> = {}): Streak => ({
  ...normalizeStreak(null),
  current: 12,
  longest: 12,
  lastCompletedOn: '2026-11-11',
  ...over,
});

function sources(over: Partial<WidgetSources> = {}): WidgetSources {
  return {
    userId: ME,
    couple: couple(),
    question: question([]),
    questionFetchedAt: NOW.getTime(),
    streak: streak(),
    partnerDisplayName: 'Sam Rivers',
    now: NOW,
    ...over,
  };
}

function build(over: Partial<WidgetSources> = {}) {
  const snap = buildWidgetSnapshot(sources(over));
  if (!snap) throw new Error('expected a snapshot');
  return snap;
}

function expectNoPrivateText(value: unknown) {
  const json = JSON.stringify(value);
  for (const secret of [PARTNER_ANSWER, MY_ANSWER, MESSAGE, QUESTION, 'Rivers'])
    expect(json).not.toContain(secret);
}

const ALLOWED_KEYS = [
  'answeredByMe',
  'day',
  'dayEndsAt',
  'mood',
  'partnerAnswered',
  'partnerJoined',
  'partnerName',
  'state',
  'streak',
  'text',
  'updatedAt',
  'v',
];

describe('widget snapshot: reveal rule (FUN-04)', () => {
  it.each([
    ['nobody answered', [], 0],
    ['partner answered, I have not (their row is hidden, the count shows it)', [], 1],
    ['partner answered and the row leaked into the cache anyway', [PARTNER], 1],
    ['I answered, partner has not', [ME], 1],
    ['both answered', [ME, PARTNER], 2],
  ] as const)('%s: no answer, message or question text', (_, answeredBy, count) => {
    const snap = build({ question: question([...answeredBy], count) });
    expectNoPrivateText(snap);
    expect(Object.keys(snap).sort()).toEqual(ALLOWED_KEYS);
    expect(snap.v).toBe(WIDGET_SNAPSHOT_VERSION);
  });

  it('partner answered, I have not: 38b "Partner answered", their answer stays locked', () => {
    const snap = build({ question: question([], 1) });
    expect(snap).toMatchObject({
      state: 'partnerAnswered',
      mood: 'waiting',
      answeredByMe: false,
      partnerAnswered: true,
      partnerName: 'Sam',
    });
    expect(snap.text.title).toBe('Sam answered');
    expect(snap.text.sub).toBe('Reply to see theirs.');
    expect(snap.text.line).toBe('Sam answered · your turn');
    expect(snap.text.cta).toBe('Answer now');
    expectNoPrivateText(snap);
  });

  it('nobody answered: 38b Countdown to the end of the couple-local day', () => {
    const snap = build();
    expect(snap).toMatchObject({ state: 'yourTurn', answeredByMe: false, partnerAnswered: false });
    expect(snap.text).toMatchObject({
      turn: 'Your turn',
      keep: 'to keep your streak',
      timer: 'Left today',
      day: 'Day 12',
      streak: '12-day streak',
    });
    // 20:40 in Berlin: the day ends at local midnight, 3 h 20 min later.
    expect(snap.dayEndsAt).toBe(Date.parse('2026-11-12T23:00:00Z'));
  });

  it('I answered first: waiting on the partner', () => {
    const snap = build({ question: question([ME], 1) });
    expect(snap).toMatchObject({ state: 'waiting', answeredByMe: true, partnerAnswered: false });
    expect(snap.text.line).toBe('Waiting for Sam');
  });

  it('both answered: bonded, the countdown is to the next question', () => {
    const snap = build({ question: question([ME, PARTNER], 2) });
    expect(snap).toMatchObject({ state: 'bonded', mood: 'celebrating', partnerAnswered: true });
    expect(snap.text.timer).toBe('Next question in');
  });

  it('a missed day: napping (28)', () => {
    const snap = build({ streak: streak({ current: 0 }) });
    expect(snap).toMatchObject({ state: 'napping', mood: 'napping', streak: 0 });
    expect(snap.text.streak).toBe('');
    expect(snap.text.keep).toBe('to start a streak');
  });

  it('solo: the partner has not joined (the onboarding name, never a profile)', () => {
    const snap = build({
      couple: couple({ partner_name: 'Alex' }, [ME]),
      partnerDisplayName: 'Alex',
      question: question([ME], 1),
    });
    expect(snap).toMatchObject({ state: 'solo', mood: 'saving-a-seat', partnerJoined: false });
    expect(snap.text.line).toBe('Waiting for Alex to join');
  });

  it('no partner name: "Your partner"', () => {
    const snap = build({ question: question([], 1), partnerDisplayName: '  ' });
    expect(snap.partnerName).toBeNull();
    expect(snap.text.title).toBe('Your partner answered');
  });
});

describe('widget snapshot: when it is written', () => {
  it('signed out or no couple: the empty snapshot, nothing personal', () => {
    for (const snap of [
      buildWidgetSnapshot(sources({ userId: null })),
      buildWidgetSnapshot(sources({ couple: null })),
    ]) {
      expect(snap).toMatchObject({
        state: 'none',
        partnerName: null,
        streak: 0,
        day: null,
        dayEndsAt: null,
      });
      expectNoPrivateText(snap);
      expect(JSON.stringify(snap)).not.toContain('Sam');
    }
    expect(emptyWidgetSnapshot(NOW).state).toBe('none');
  });

  it('nothing while Today is loading (the widgets keep the last snapshot)', () => {
    expect(buildWidgetSnapshot(sources({ couple: undefined }))).toBeNull();
    expect(buildWidgetSnapshot(sources({ question: undefined }))).toBeNull();
    expect(buildWidgetSnapshot(sources({ streak: undefined }))).toBeNull();
  });

  it("a question restored from yesterday's cache ends yesterday (the widget shows a new day)", () => {
    const yesterday = Date.parse('2026-11-11T20:00:00Z');
    const snap = build({ questionFetchedAt: yesterday });
    expect(snap.dayEndsAt).toBe(Date.parse('2026-11-11T23:00:00Z'));
    expect(snap.dayEndsAt!).toBeLessThan(NOW.getTime());
  });

  it('every fetch on the same day gives the same midnight', () => {
    const at = (ms: number) => build({ questionFetchedAt: NOW.getTime() + ms }).dayEndsAt;
    expect(at(1)).toBe(at(0));
    expect(at(999)).toBe(at(0));
    expect(at(60_123)).toBe(at(0));
  });

  it('ignores updatedAt when comparing', () => {
    const a = build();
    const b = build({ now: new Date(NOW.getTime() + 1000) });
    expect(sameForWidgets(a, b)).toBe(true);
    expect(sameForWidgets(a, build({ question: question([ME], 1) }))).toBe(false);
    expect(sameForWidgets(null, null)).toBe(true);
    expect(sameForWidgets(a, null)).toBe(false);
  });
});

describe('firstName', () => {
  it.each([
    ['Sam Rivers', 'Sam'],
    ['  Sam  ', 'Sam'],
    ['', null],
    [null, null],
    [undefined, null],
    ['Maximiliana-Alexandrina-Konstanze', 'Maximiliana-Alexandr'],
  ])('%p -> %p', (input, expected) => {
    expect(firstName(input)).toBe(expected);
  });
});
