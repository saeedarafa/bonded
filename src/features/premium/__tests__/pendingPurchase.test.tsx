import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import type { SessionState } from '@/features/auth/session';
import { pendingSyncTiming, usePremium, usePurchasesIdentity } from '@/features/premium/hooks';
import { usePendingPurchase } from '@/features/premium/pendingPurchase';
import { resetPurchasesForTests } from '@/features/premium/purchases';
import { queryKeys } from '@/lib/queryKeys';
import { purchasesMock } from '@/test/purchases';

/**
 * MOB-62 (D50): a P3 purchase made signed out reaches the account only through the server:
 * `logIn(uid)` → `revenuecat-sync` → `entitlements` refetch. Premium is what the server row says.
 */
const mockOrder: string[] = [];
const mockSync = jest.fn<Promise<string>, []>();
let mockRows: { user_id: string; is_active: boolean; expires_at: string | null }[] = [];
jest.mock('@/features/premium/api', () => ({
  syncRevenueCat: () => {
    mockOrder.push('revenuecat-sync');
    return mockSync();
  },
  getEntitlements: () => {
    mockOrder.push('entitlements');
    return Promise.resolve(mockRows);
  },
  getOffer: jest.fn(),
}));
jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ status: 'signedIn', userId: 'u1' }),
}));
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: () =>
    Promise.resolve({ id: 'c1', couple_members: [{ user_id: 'u1', left_at: null }] }),
}));

const SESSION = { status: 'signedIn', userId: 'u1' } as SessionState;

let premium: ReturnType<typeof usePremium> | null = null;
function Probe({ session }: { session: SessionState }) {
  usePurchasesIdentity(session);
  const state = usePremium();
  useEffect(() => {
    premium = state;
  });
  return null;
}

let qc: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  resetPurchasesForTests();
  mockOrder.length = 0;
  mockRows = [];
  premium = null;
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  purchasesMock.logIn.mockImplementation(() => {
    mockOrder.push('logIn');
    return Promise.resolve({ customerInfo: {}, created: false });
  });
  pendingSyncTiming.intervalMs = 10;
  pendingSyncTiming.attempts = 3;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  usePendingPurchase.getState().clear();
  qc.clear();
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
});

function renderProbe() {
  return render(
    <QueryClientProvider client={qc}>
      <Probe session={SESSION} />
    </QueryClientProvider>,
  );
}

describe('P3 purchase → sign-in → premium from the server (MOB-62)', () => {
  it('logIn(uid), then revenuecat-sync, then the entitlement refetch makes the couple premium', async () => {
    usePendingPurchase.getState().mark();
    mockSync.mockImplementation(() => {
      // The server wrote the row during the sync.
      mockRows = [{ user_id: 'u1', is_active: true, expires_at: null }];
      return Promise.resolve('ok');
    });
    renderProbe();
    await waitFor(() => expect(premium?.isPremium).toBe(true));
    expect(purchasesMock.logIn).toHaveBeenCalledWith('u1');
    const syncAt = mockOrder.indexOf('revenuecat-sync');
    expect(mockOrder.indexOf('logIn')).toBeLessThan(syncAt);
    expect(mockOrder.lastIndexOf('entitlements')).toBeGreaterThan(syncAt);
    expect(usePendingPurchase.getState().pending).toBe(false);
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('rate limited (429): retried later, then premium', async () => {
    usePendingPurchase.getState().mark();
    mockSync.mockResolvedValueOnce('rateLimited').mockImplementation(() => {
      mockRows = [{ user_id: 'u1', is_active: true, expires_at: null }];
      return Promise.resolve('ok');
    });
    renderProbe();
    await waitFor(() => expect(premium?.isPremium).toBe(true));
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  it('gives up after a few tries and keeps the purchase marked for the next launch', async () => {
    usePendingPurchase.getState().mark();
    mockSync.mockResolvedValue('retry');
    renderProbe();
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSync).toHaveBeenCalledTimes(3);
    expect(usePendingPurchase.getState().pending).toBe(true);
    // The SDK never decides premium.
    expect(premium?.isPremium).toBe(false);
  });

  it('nothing bought on P3: no sync call', async () => {
    renderProbe();
    await waitFor(() => expect(purchasesMock.logIn).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(qc.getQueryState(queryKeys.entitlements())?.status).toBe('success'));
    expect(mockSync).not.toHaveBeenCalled();
  });
});
