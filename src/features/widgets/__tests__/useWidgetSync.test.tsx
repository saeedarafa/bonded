import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { SessionState } from '@/features/auth/session';
import { normalizeStreak } from '@/features/daily/today';
import { queryKeys } from '@/lib/queryKeys';

import { setWidgetModuleForTests } from '../bridge';
import type { WidgetSnapshot } from '../snapshot';
import { useWidgetSync } from '../useWidgetSync';

/** MOB-30: the root hook writes a snapshot when Today changes and clears it on sign-out. */

jest.mock('@/features/daily/api', () => ({
  getTodayQuestion: jest.fn(() => new Promise(() => {})),
  getStreak: jest.fn(() => new Promise(() => {})),
}));
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: jest.fn(() => new Promise(() => {})),
}));
jest.mock('@/features/profile/api', () => ({
  getCoupleProfiles: jest.fn(() => new Promise(() => {})),
}));

const ME = 'user-me';
const PARTNER = 'user-partner';
const SECRET = 'SECRET-answer-text';

const setSnapshot = jest.fn<void, [string]>();
let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

const written = (): WidgetSnapshot[] =>
  setSnapshot.mock.calls.map(([json]) => JSON.parse(json) as WidgetSnapshot);

function seed(answerCount: number) {
  qc.setQueryData(queryKeys.couple.active(), {
    id: 'couple-1',
    timezone: 'Europe/Berlin',
    created_at: '2026-11-01T10:00:00Z',
    paired_at: '2026-11-01T12:00:00Z',
    partner_name: null,
    couple_members: [
      { user_id: ME, left_at: null },
      { user_id: PARTNER, left_at: null },
    ],
  });
  qc.setQueryData(queryKeys.profiles.couple(), [
    { id: ME, display_name: 'Maya' },
    { id: PARTNER, display_name: 'Sam Rivers' },
  ]);
  qc.setQueryData(queryKeys.streak(), normalizeStreak({ current: 4 } as never));
  qc.setQueryData(queryKeys.today.question(), {
    id: 'cq-1',
    answerCount,
    question: 'A question',
    answers: [],
    partnerAnswerBody: SECRET,
  });
}

const signedIn: SessionState = { status: 'signedIn', userId: ME };
const signedOut: SessionState = { status: 'signedOut', userId: null };

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setSnapshot.mockReset();
  setWidgetModuleForTests({ setSnapshot });
});

afterAll(() => setWidgetModuleForTests(undefined));

it('writes once Today is in the cache, again when the partner answers, never answer text', async () => {
  const { rerender } = await renderHook((s: SessionState) => useWidgetSync(s), {
    wrapper,
    initialProps: signedIn,
  });
  expect(setSnapshot).not.toHaveBeenCalled();

  await act(async () => seed(0));
  await waitFor(() =>
    expect(written().at(-1)).toMatchObject({ state: 'yourTurn', partnerName: 'Sam', streak: 4 }),
  );
  const count = setSnapshot.mock.calls.length;

  // A refetch with the same state writes nothing (no widget reload).
  await act(async () => seed(0));
  await rerender(signedIn);
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  expect(setSnapshot).toHaveBeenCalledTimes(count);

  await act(async () => seed(1));
  await waitFor(() =>
    expect(written().at(-1)).toMatchObject({ state: 'partnerAnswered', partnerAnswered: true }),
  );
  for (const [json] of setSnapshot.mock.calls) {
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain('A question');
    expect(json).not.toContain('Rivers');
  }

  // Signing out clears the widgets.
  await rerender(signedOut);
  await waitFor(() => expect(written().at(-1)).toMatchObject({ state: 'none', partnerName: null }));
});

it('does not fetch anything itself', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const daily = require('@/features/daily/api') as { getTodayQuestion: jest.Mock };
  await renderHook(() => useWidgetSync(signedIn), { wrapper });
  await act(async () => {});
  expect(daily.getTodayQuestion).not.toHaveBeenCalled();
});

it('a missing native module is a no-op', async () => {
  setWidgetModuleForTests(null);
  await renderHook(() => useWidgetSync(signedIn), { wrapper });
  await act(async () => seed(0));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  expect(setSnapshot).not.toHaveBeenCalled();
});
