import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { dropLockedContent, useRelockHistoryOnLapse } from '@/features/history/hooks';
import { queryKeys } from '@/lib/queryKeys';

let mockPremium = { status: 'ready', isPremium: true };
jest.mock('@/features/premium/hooks', () => ({
  usePremium: () => mockPremium,
}));
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: 'u1' }),
}));

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

const seed = () => {
  qc.setQueryData(queryKeys.questions.detail('cq-old'), { answers: ['FIXTURE-OLD'] });
  qc.setQueryData(queryKeys.thread.detail('cq-old'), [{ body: 'FIXTURE-MSG' }]);
  qc.setQueryData(queryKeys.history.lastMessage('cq-old'), { body: 'FIXTURE-LAST' });
  qc.setQueryData(queryKeys.history.list('c1'), { pages: [[]], pageParams: [0] });
};

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockPremium = { status: 'ready', isPremium: true };
});
afterEach(() => qc.clear());

describe('History lock cache rules (MOB-71, D55, CONTRACTS "History lock")', () => {
  it('dropLockedContent removes the answers, thread and last message of locked days only', async () => {
    seed();
    qc.setQueryData(queryKeys.questions.detail('cq-yday'), { answers: ['FIXTURE-YDAY'] });
    dropLockedContent(qc, ['cq-old']);
    expect(qc.getQueryData(queryKeys.questions.detail('cq-old'))).toBeUndefined();
    expect(qc.getQueryData(queryKeys.thread.detail('cq-old'))).toBeUndefined();
    expect(qc.getQueryData(queryKeys.history.lastMessage('cq-old'))).toBeUndefined();
    expect(qc.getQueryData(queryKeys.questions.detail('cq-yday'))).toBeDefined();
  });

  it('a lapse drops cached answers and threads and refetches History', async () => {
    seed();
    const { rerender } = await renderHook(() => useRelockHistoryOnLapse(), { wrapper });
    expect(qc.getQueryState(queryKeys.history.list('c1'))?.isInvalidated).toBe(false);
    mockPremium = { status: 'ready', isPremium: false };
    await rerender({});
    // Nothing on screen: gone from the cache (and from disk with the next persist).
    expect(qc.getQueryData(queryKeys.questions.detail('cq-old'))).toBeUndefined();
    expect(qc.getQueryData(queryKeys.thread.detail('cq-old'))).toBeUndefined();
    expect(qc.getQueryState(queryKeys.history.list('c1'))?.isInvalidated).toBe(true);
  });

  it('Premium starting again refetches History so older days open; nothing else is dropped', async () => {
    mockPremium = { status: 'ready', isPremium: false };
    seed();
    const { rerender } = await renderHook(() => useRelockHistoryOnLapse(), { wrapper });
    mockPremium = { status: 'ready', isPremium: true };
    await rerender({});
    expect(qc.getQueryState(queryKeys.history.list('c1'))?.isInvalidated).toBe(true);
    expect(qc.getQueryData(queryKeys.questions.detail('cq-old'))).toBeDefined();
  });

  it('the first known state and a loading state change nothing', async () => {
    mockPremium = { status: 'loading', isPremium: false };
    seed();
    const { rerender } = await renderHook(() => useRelockHistoryOnLapse(), { wrapper });
    mockPremium = { status: 'ready', isPremium: false };
    await rerender({});
    expect(qc.getQueryData(queryKeys.questions.detail('cq-old'))).toBeDefined();
    expect(qc.getQueryState(queryKeys.history.list('c1'))?.isInvalidated).toBe(false);
  });
});
