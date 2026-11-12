import { deepLinkKind, noteOpenSource, beginOpen, takeOpenSource, widgetOfLink } from '../appOpen';
import { onboardingStep, routeName, screenView } from '../screens';
import { wholeDays } from '../useAnalytics';
import { FEEDBACK_TAGS } from '@/features/feedback/model';
import { LITTLE_THING_KINDS } from '@/features/littleThings/model';
import { ONBOARDING_STEPS } from '@/features/onboarding/flow';
import { GOALS, LAST_LEARNED, STAGES } from '@/features/onboarding/store';
import { PUSH_TYPES } from '@/features/push/links';
import { RITUAL_TIMES } from '@/features/push/ritual';
import { PUSH_TOGGLES } from '@/features/settings/api';
import {
  FEEDBACK_TAG_IDS,
  GESTURE_KINDS,
  GOAL_IDS,
  LAST_LEARNED_IDS,
  ONBOARDING_STEP_IDS,
  PUSH_TOGGLE_IDS,
  PUSH_TYPE_IDS,
  RITUAL_TIME_IDS,
  STAGE_IDS,
  sanitizeEvent,
} from '@/lib/analytics/catalogue';
import { sourceFiles } from '@/test/sourceFiles';

describe('catalogue lists match the app (MOB-24)', () => {
  it('uses the same option ids as the features', () => {
    expect(STAGE_IDS).toEqual(STAGES);
    expect(GOAL_IDS).toEqual(GOALS);
    expect(LAST_LEARNED_IDS).toEqual(LAST_LEARNED);
    expect(PUSH_TYPE_IDS).toEqual(PUSH_TYPES);
    expect(PUSH_TOGGLE_IDS).toEqual(PUSH_TOGGLES);
    expect(GESTURE_KINDS).toEqual(LITTLE_THING_KINDS);
    expect(FEEDBACK_TAG_IDS).toEqual(FEEDBACK_TAGS.map((t) => t.id));
    expect(RITUAL_TIME_IDS).toEqual([...RITUAL_TIMES.map((r) => r.time), 'other']);
    expect(ONBOARDING_STEP_IDS).toHaveLength(ONBOARDING_STEPS.length);
  });
});

/** Every route file under app/, as expo-router segments (`(tabs)/today/answer`). */
function routeFiles(): string[][] {
  return sourceFiles('app', /\.tsx$/)
    .map((p) =>
      p
        .replace(/^app\//, '')
        .replace(/\.tsx$/, '')
        .split('/'),
    )
    .filter((segments) => !segments.some((s) => s.startsWith('_')))
    .map((segments) => segments.filter((s) => s !== 'index'));
}

describe('screen views', () => {
  const routes = routeFiles();

  it('every route name passes the catalogue check (no parameter values)', () => {
    expect(routes.length).toBeGreaterThan(40);
    for (const segments of routes) {
      const view = screenView(segments, '/somewhere');
      expect(sanitizeEvent('screen_viewed', view)).toEqual(view);
    }
  });

  it('names the route and its board, never the parameter', () => {
    expect(screenView(['(tabs)', 'today', 'answer'], '/today/answer')).toEqual({
      screen: 'app/(tabs)/today/answer',
      screen_id: '19',
    });
    expect(
      screenView(
        ['(tabs)', 'history', '[questionId]'],
        '/history/7d0f6a3e-0000-4000-a000-000000000001',
      ),
    ).toEqual({ screen: 'app/(tabs)/history/[questionId]', screen_id: '30' });
    expect(screenView(['j', '[code]'], '/j/BND4827')).toEqual({ screen: 'app/j/[code]' });
    expect(screenView(['(onboarding)', 'story', '[step]'], '/story/2')).toEqual({
      screen: 'app/(onboarding)/story/[step]',
      screen_id: '03',
    });
    expect(routeName([])).toBe('app');
  });

  it('finds the onboarding step in the D50 order', () => {
    expect(onboardingStep('/welcome')).toEqual({ step: '01', step_index: 0 });
    expect(onboardingStep('/quiz/names')).toEqual({ step: '07', step_index: 2 });
    expect(onboardingStep('/plan/trial')).toEqual({ step: 'P3', step_index: 11 });
    expect(onboardingStep('/today')).toBeNull();
  });
});

describe('app_opened source and deep links', () => {
  it('a push wins over a link; nothing noted means the icon', () => {
    beginOpen();
    noteOpenSource({ source: 'link' });
    noteOpenSource({ source: 'push', push_type: 'nudge' });
    noteOpenSource({ source: 'link' });
    expect(takeOpenSource()).toEqual({ source: 'push', push_type: 'nudge' });
    beginOpen();
    expect(takeOpenSource()).toEqual({ source: 'icon' });
    // Outside an open window a link is not an app open.
    noteOpenSource({ source: 'link' });
    beginOpen();
    expect(takeOpenSource()).toEqual({ source: 'icon' });
  });

  it('classifies links without keeping them', () => {
    expect(deepLinkKind('bonded://j/BND4827?t=abc')).toEqual({ kind: 'invite', valid: true });
    expect(deepLinkKind('https://trybonded.com/j/BND4827?t=abc')).toEqual({
      kind: 'invite',
      valid: true,
    });
    expect(deepLinkKind('bonded://auth/callback#access_token=x')).toEqual({
      kind: 'auth',
      valid: true,
    });
    expect(deepLinkKind('bonded://today')).toEqual({ kind: 'other', valid: false });
    expect(deepLinkKind('not a url')).toEqual({ kind: 'other', valid: false });
  });

  it('MOB-30: a widget tap is a widget link and names the layout, nothing else', () => {
    expect(deepLinkKind('bonded://today?widget=countdown')).toEqual({
      kind: 'widget',
      valid: true,
    });
    expect(widgetOfLink('bonded://today?widget=today')).toBe('today');
    expect(widgetOfLink('bonded://today?widget=countdown')).toBe('countdown');
    expect(widgetOfLink('bonded://today?widget=partner_answered')).toBe('partner_answered');
    expect(widgetOfLink('bonded://today?widget=other')).toBeNull();
    expect(widgetOfLink('bonded://today')).toBeNull();
    expect(widgetOfLink('https://trybonded.com/today?widget=today')).toBeNull();
    expect(deepLinkKind('bonded://today?widget=nope')).toEqual({ kind: 'other', valid: false });
  });

  it('counts whole days', () => {
    const now = Date.parse('2026-11-11T12:00:00Z');
    expect(wholeDays('2026-11-08T13:00:00Z', now)).toBe(2);
    expect(wholeDays('2026-11-12T13:00:00Z', now)).toBe(0);
    expect(wholeDays(null, now)).toBeUndefined();
  });
});
