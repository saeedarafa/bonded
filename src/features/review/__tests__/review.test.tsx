import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as StoreReview from 'expo-store-review';

import {
  ASK_INTERVAL_MS,
  canAskForReview,
  localDay,
  markReviewErrorDay,
  REVIEW_DELAY_MS,
  ReviewErrorDayMark,
  suppressionForRoute,
  suppressReviewThisSession,
  useReviewOnClose,
  usedOnTwoDays,
  markSignedOutSession,
  maybeRequestReview,
  recordSession,
  resetReviewSessionsForTests,
  SESSION_GAP_MS,
  sessionCount,
  setReviewStorage,
  useReviewSessions,
} from '@/features/review/review';
import { memoryStorage } from '@/test/memoryStorage';
import { readSource, sourceFiles } from '@/test/sourceFiles';

const requestReview = StoreReview.requestReview as jest.Mock;
const isAvailable = StoreReview.isAvailableAsync as jest.Mock;
const NOW = Date.UTC(2026, 10, 3, 12);
const DAY = 24 * 60 * 60 * 1000;
/** D62: the first session on an earlier local day, so later sessions are "day 2". */
const YESTERDAY = NOW - DAY;

beforeEach(() => {
  jest.clearAllMocks();
  setReviewStorage(memoryStorage());
  resetReviewSessionsForTests();
});
// The cold-start test spies on AppState and Date.now: put them back for the tests after it.
afterEach(() => jest.restoreAllMocks());

describe('in-app review rules (MOB-17)', () => {
  it('never asks in the first session', async () => {
    expect(canAskForReview({ sessions: 0, lastAskedAt: null, now: NOW })).toBe(false);
    expect(canAskForReview({ sessions: 1, lastAskedAt: null, now: NOW })).toBe(false);
    recordSession();
    expect(await maybeRequestReview('milestone', NOW)).toBe(false);
    expect(requestReview).not.toHaveBeenCalled();
  });

  it('asks from the second session, then not again for 120 days', async () => {
    recordSession(YESTERDAY);
    recordSession(NOW);
    expect(await maybeRequestReview('milestone', NOW)).toBe(true);
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(await maybeRequestReview('milestone', NOW + ASK_INTERVAL_MS - 1)).toBe(false);
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(await maybeRequestReview('milestone', NOW + ASK_INTERVAL_MS)).toBe(true);
    expect(requestReview).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when the store review is not available, and never throws', async () => {
    recordSession(YESTERDAY);
    recordSession(NOW);
    isAvailable.mockResolvedValueOnce(false);
    expect(await maybeRequestReview('milestone', NOW)).toBe(false);
    requestReview.mockRejectedValueOnce(new Error('no store'));
    expect(await maybeRequestReview('milestone', NOW)).toBe(false);
  });

  it('counts the cold start once, and a return after 30 minutes in the background', async () => {
    let listener: ((s: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
      listener = fn as (s: AppStateStatus) => void;
      return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
    });
    function Probe() {
      useReviewSessions();
      return null;
    }
    const first = await render(<Probe />);
    await first.unmount();
    await render(<Probe />);
    expect(sessionCount()).toBe(1);

    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(NOW);
    await act(async () => listener?.('background'));
    now.mockReturnValue(NOW + SESSION_GAP_MS - 1);
    await act(async () => listener?.('active'));
    expect(sessionCount()).toBe(1);
    await act(async () => listener?.('background'));
    now.mockReturnValue(NOW + 2 * SESSION_GAP_MS);
    await act(async () => listener?.('active'));
    expect(sessionCount()).toBe(2);
    now.mockRestore();
  });

  describe('#68: never in a session that began with sign-in or onboarding', () => {
    it('pure rule: blocked up to and including the signed-out session', () => {
      const base = { lastAskedAt: null, now: NOW };
      expect(canAskForReview({ ...base, sessions: 3, signedOutSession: 3 })).toBe(false);
      expect(canAskForReview({ ...base, sessions: 4, signedOutSession: 3 })).toBe(true);
      expect(canAskForReview({ ...base, sessions: 4, signedOutSession: null })).toBe(true);
    });

    it('fresh install: signed out, signs in, milestone in the same session -> no prompt; next app open -> prompt', async () => {
      function Probe({ status }: { status: 'loading' | 'signedIn' | 'signedOut' }) {
        useReviewSessions(status);
        return null;
      }
      // Session 1 (cold start): onboarding and sign-in, then a milestone closes.
      const app = await render(<Probe status="loading" />);
      await app.rerender(<Probe status="signedOut" />);
      await app.rerender(<Probe status="signedIn" />);
      expect(sessionCount()).toBe(1);
      expect(await maybeRequestReview('milestone', NOW)).toBe(false);
      // A later app open (cold start, or back after 30 minutes): now it may ask.
      recordSession(NOW);
      expect(await maybeRequestReview('milestone', NOW)).toBe(true);
      expect(requestReview).toHaveBeenCalledTimes(1);
    });

    it('an install with older sessions that signs in again waits for the next session (the #68 repro)', async () => {
      for (let i = 0; i < 5; i++) recordSession(YESTERDAY);
      resetReviewSessionsForTests();
      // This cold start (session 6) begins signed out: sign-in, then the 7-day milestone.
      markSignedOutSession();
      expect(sessionCount()).toBe(6);
      expect(await maybeRequestReview('milestone', NOW)).toBe(false);
      expect(requestReview).not.toHaveBeenCalled();
      recordSession(NOW);
      expect(await maybeRequestReview('milestone', NOW)).toBe(true);
    });

    it('a session that starts signed in and stays signed in may ask (from session 2)', async () => {
      function Probe() {
        useReviewSessions('signedIn');
        return null;
      }
      recordSession(YESTERDAY);
      resetReviewSessionsForTests();
      await render(<Probe />);
      expect(sessionCount()).toBe(2);
      expect(await maybeRequestReview('milestone', NOW)).toBe(true);
    });
  });
});

describe('D62 (MOB-85): day 2+, happy moments, never after a paywall, offer, cancel or error', () => {
  it('never on the first local day, however many sessions', async () => {
    for (let i = 0; i < 4; i++) recordSession(NOW);
    expect(usedOnTwoDays()).toBe(false);
    expect(await maybeRequestReview('reveal', NOW + 60_000)).toBe(false);
    expect(requestReview).not.toHaveBeenCalled();
  });

  it('a session that began yesterday and runs past midnight counts today as day 2', async () => {
    const lateEvening = new Date(2026, 10, 3, 23, 50).getTime();
    recordSession(lateEvening - DAY);
    recordSession(lateEvening);
    expect(await maybeRequestReview('reveal', lateEvening)).toBe(true);
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it('local days are calendar days on the device', () => {
    expect(localDay(new Date(2026, 0, 5, 0, 1).getTime())).toBe('2026-01-05');
    expect(localDay(new Date(2026, 11, 31, 23, 59).getTime())).toBe('2026-12-31');
  });

  it('pure rule: day 2, suppression and error days block', () => {
    const base = { sessions: 3, lastAskedAt: null, now: NOW };
    expect(canAskForReview({ ...base, usedOnTwoDays: true })).toBe(true);
    expect(canAskForReview({ ...base, usedOnTwoDays: false })).toBe(false);
    expect(canAskForReview({ ...base, usedOnTwoDays: true, suppressedThisSession: true })).toBe(
      false,
    );
    expect(canAskForReview({ ...base, usedOnTwoDays: true, errorToday: true })).toBe(false);
  });

  it.each(['paywall', 'offer', 'cancel'] as const)(
    'no prompt for the rest of a session that showed %s; the next session may ask',
    async (reason) => {
      recordSession(YESTERDAY);
      recordSession(NOW);
      suppressReviewThisSession(reason);
      expect(await maybeRequestReview('reveal', NOW)).toBe(false);
      expect(await maybeRequestReview('milestone', NOW)).toBe(false);
      recordSession(NOW + SESSION_GAP_MS);
      expect(await maybeRequestReview('reveal', NOW + SESSION_GAP_MS)).toBe(true);
    },
  );

  it('no prompt on a local day with an error screen; the next day may ask', async () => {
    recordSession(YESTERDAY);
    recordSession(NOW);
    markReviewErrorDay(NOW);
    expect(await maybeRequestReview('reveal', NOW)).toBe(false);
    recordSession(NOW + DAY);
    expect(await maybeRequestReview('reveal', NOW + DAY)).toBe(true);
  });

  it('an error screen marks the day when it renders', async () => {
    recordSession(YESTERDAY);
    recordSession(Date.now());
    await render(<ReviewErrorDayMark />);
    expect(await maybeRequestReview('reveal')).toBe(false);
  });

  it('paywall and offer routes: (offer) group and P3', () => {
    expect(suppressionForRoute(['(offer)', 'paywall'])).toBe('paywall');
    expect(suppressionForRoute(['(offer)', 'gift'])).toBe('offer');
    expect(suppressionForRoute(['(offer)', 'gift', 'opened'])).toBe('offer');
    expect(suppressionForRoute(['(offer)', 'success'])).toBe('offer');
    expect(suppressionForRoute(['(onboarding)', 'plan', 'trial'])).toBe('paywall');
    expect(suppressionForRoute(['(onboarding)', 'plan', 'yours'])).toBeNull();
    expect(suppressionForRoute(['(tabs)', 'today', 'revealed'])).toBeNull();
    expect(suppressionForRoute([])).toBeNull();
  });

  it('two triggers at once ask the OS once', async () => {
    recordSession(YESTERDAY);
    recordSession(NOW);
    const [a, b] = await Promise.all([
      maybeRequestReview('reveal', NOW),
      maybeRequestReview('milestone', NOW),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  describe('useReviewOnClose', () => {
    function Screen({ shown }: { shown: boolean }) {
      useReviewOnClose('reveal', shown);
      return null;
    }

    it('asks after a screen that showed its moment closes', async () => {
      jest.useFakeTimers();
      try {
        recordSession(Date.now() - DAY);
        recordSession(Date.now());
        const screen = await render(<Screen shown />);
        await screen.rerender(<Screen shown={false} />);
        await screen.unmount();
        expect(requestReview).not.toHaveBeenCalled();
        await act(async () => {
          jest.advanceTimersByTime(REVIEW_DELAY_MS);
        });
        expect(requestReview).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('never after a screen that never showed it (loading, error)', async () => {
      jest.useFakeTimers();
      try {
        recordSession(Date.now() - DAY);
        recordSession(Date.now());
        const screen = await render(<Screen shown={false} />);
        await screen.unmount();
        await act(async () => {
          jest.advanceTimersByTime(REVIEW_DELAY_MS);
        });
        expect(requestReview).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

describe('D62: no own rating UI, no review gating', () => {
  const RATING_UI =
    /rate us|rate bonded|leave a review|write a review|\bstars?\b|do you (like|love|enjoy) bonded/i;

  it('no copy in the app asks for a rating', () => {
    expect(readSource('src/i18n/locales/en.json')).not.toMatch(RATING_UI);
  });

  it('only review.ts calls the OS review API', () => {
    const callers = [...sourceFiles('app'), ...sourceFiles('src')].filter((f) =>
      /expo-store-review/.test(readSource(f)),
    );
    expect(callers).toEqual(['src/features/review/review.ts']);
  });
});
