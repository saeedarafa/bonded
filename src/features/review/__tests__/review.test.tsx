import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as StoreReview from 'expo-store-review';

import {
  ASK_INTERVAL_MS,
  canAskForReview,
  maybeRequestReview,
  recordSession,
  resetReviewSessionsForTests,
  SESSION_GAP_MS,
  sessionCount,
  setReviewStorage,
  useReviewSessions,
} from '@/features/review/review';
import { memoryStorage } from '@/test/memoryStorage';

const requestReview = StoreReview.requestReview as jest.Mock;
const isAvailable = StoreReview.isAvailableAsync as jest.Mock;
const NOW = Date.UTC(2026, 10, 3, 12);

beforeEach(() => {
  jest.clearAllMocks();
  setReviewStorage(memoryStorage());
  resetReviewSessionsForTests();
});

describe('in-app review rules (MOB-17)', () => {
  it('never asks in the first session', async () => {
    expect(canAskForReview({ sessions: 0, lastAskedAt: null, now: NOW })).toBe(false);
    expect(canAskForReview({ sessions: 1, lastAskedAt: null, now: NOW })).toBe(false);
    recordSession();
    expect(await maybeRequestReview(NOW)).toBe(false);
    expect(requestReview).not.toHaveBeenCalled();
  });

  it('asks from the second session, then not again for 120 days', async () => {
    recordSession();
    recordSession();
    expect(await maybeRequestReview(NOW)).toBe(true);
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(await maybeRequestReview(NOW + ASK_INTERVAL_MS - 1)).toBe(false);
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(await maybeRequestReview(NOW + ASK_INTERVAL_MS)).toBe(true);
    expect(requestReview).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when the store review is not available, and never throws', async () => {
    recordSession();
    recordSession();
    isAvailable.mockResolvedValueOnce(false);
    expect(await maybeRequestReview(NOW)).toBe(false);
    requestReview.mockRejectedValueOnce(new Error('no store'));
    expect(await maybeRequestReview(NOW)).toBe(false);
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
    act(() => listener?.('background'));
    now.mockReturnValue(NOW + SESSION_GAP_MS - 1);
    act(() => listener?.('active'));
    expect(sessionCount()).toBe(1);
    act(() => listener?.('background'));
    now.mockReturnValue(NOW + 2 * SESSION_GAP_MS);
    act(() => listener?.('active'));
    expect(sessionCount()).toBe(2);
    now.mockRestore();
  });
});
