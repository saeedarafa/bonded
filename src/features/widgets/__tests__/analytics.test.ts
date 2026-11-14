import { track, WIDGET_KINDS } from '@/lib/analytics';
import { sanitizeEvent } from '@/lib/analytics/catalogue';
import { paywallTrigger } from '@/features/premium/analytics';

import { flushWidgetActions, WIDGET_ACTION_FLUSH_MAX, widgetKindParam } from '../analytics';

/** MOB-77 (D59, ANALYTICS §3.7): widget kind and action only; nothing else leaves the queue. */

jest.mock('@/lib/analytics', () => ({
  ...jest.requireActual('@/lib/analytics'),
  track: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

it('sends each queued action with exactly its kind and action', () => {
  const queue = JSON.stringify([
    { widget_kind: 'little_things', action: 'send' },
    { widget_kind: 'todays_question', action: 'tap_open', question_text: 'SECRET', partner: 'Sam' },
    { widget_kind: 'streak', action: 'view_locked', count: 12 },
  ]);
  expect(flushWidgetActions(queue)).toBe(3);
  expect(jest.mocked(track).mock.calls).toEqual([
    ['widget_action', { widget_kind: 'little_things', action: 'send' }],
    ['widget_action', { widget_kind: 'todays_question', action: 'tap_open' }],
    ['widget_action', { widget_kind: 'streak', action: 'view_locked' }],
  ]);
});

it('drops unknown kinds, unknown actions, junk and malformed queues', () => {
  const queue = JSON.stringify([
    { widget_kind: 'countdown', action: 'send' },
    { widget_kind: 'streak', action: 'Sam sent a hug' },
    null,
    'little_things',
    { widget_kind: 'mood' },
  ]);
  expect(flushWidgetActions(queue)).toBe(0);
  expect(flushWidgetActions('{not json')).toBe(0);
  expect(flushWidgetActions('{"widget_kind":"mood","action":"send"}')).toBe(0);
  expect(flushWidgetActions(null)).toBe(0);
  expect(track).not.toHaveBeenCalled();
});

it('sends at most the flush cap', () => {
  const queue = JSON.stringify(
    Array.from({ length: 80 }, () => ({ widget_kind: 'little_things', action: 'send' })),
  );
  expect(flushWidgetActions(queue)).toBe(WIDGET_ACTION_FLUSH_MAX);
  expect(track).toHaveBeenCalledTimes(WIDGET_ACTION_FLUSH_MAX);
});

it('catalogue: widget_action takes no content, paywall_viewed takes widget_kind', () => {
  expect(sanitizeEvent('widget_action', { widget_kind: 'mood', action: 'undo' })).toEqual({
    widget_kind: 'mood',
    action: 'undo',
  });
  expect(sanitizeEvent('widget_action', { widget_kind: 'Sam', action: 'send' })).toBeNull();
  expect(
    sanitizeEvent('paywall_viewed', { paywall: '16', trigger: 'widget', widget_kind: 'streak' }),
  ).toEqual({ paywall: '16', trigger: 'widget', widget_kind: 'streak' });
  expect(
    sanitizeEvent('paywall_viewed', { paywall: '16', trigger: 'widget', widget_kind: 'big' }),
  ).toEqual({ paywall: '16', trigger: 'widget' });
});

it('16 from a locked widget: trigger widget and a known widget_kind only', () => {
  expect(paywallTrigger('widget')).toBe('widget');
  for (const kind of WIDGET_KINDS) expect(widgetKindParam(kind)).toEqual({ widget_kind: kind });
  expect(widgetKindParam('../today')).toEqual({});
  expect(widgetKindParam(undefined)).toEqual({});
});
