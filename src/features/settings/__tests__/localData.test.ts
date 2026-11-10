import { usePendingInvite } from '@/features/auth/pendingInvite';
import { useSeenBadges } from '@/features/badges/seen';
import { useOnboarding } from '@/features/onboarding/store';
import { wipeLocalAccount } from '@/features/settings/localData';
import { useEndedSeen } from '@/features/settings/partnerLeft';

const mockOrder: string[] = [];
jest.mock('@/features/premium/purchases', () => ({
  resetPurchaser: () => {
    mockOrder.push('revenuecat');
    return Promise.resolve();
  },
}));
jest.mock('@/features/push/registration', () => ({
  unregisterPushToken: () => {
    mockOrder.push('push');
    return Promise.reject(new Error('signed out'));
  },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: (opts: unknown) => {
        mockOrder.push(`signOut:${JSON.stringify(opts)}`);
        return Promise.resolve({ error: null });
      },
    },
  },
}));

beforeEach(() => {
  mockOrder.length = 0;
});

it('logs RevenueCat out, signs out locally, then clears MMKV and the in-memory stores', async () => {
  usePendingInvite.getState().set({ code: '4827', inviterName: 'Maya' });
  useOnboarding.getState().setNames({ displayName: 'Maya' });
  useSeenBadges.setState({ seen: ['b1'] });
  useEndedSeen.setState({ seen: ['c1'] });
  const clearAll = jest.fn(() => mockOrder.push('mmkv'));

  await wipeLocalAccount(() => ({ clearAll }));

  expect(mockOrder).toEqual(['revenuecat', 'push', 'signOut:{"scope":"local"}', 'mmkv']);
  expect(usePendingInvite.getState().code).toBeNull();
  expect(useSeenBadges.getState().seen).toEqual([]);
  expect(useEndedSeen.getState().seen).toEqual([]);
  expect(useOnboarding.getState().displayName).toBe('');
});

it('never throws, even when storage is unavailable', async () => {
  await expect(
    wipeLocalAccount(() => ({
      clearAll: () => {
        throw new Error('no storage');
      },
    })),
  ).resolves.toBeUndefined();
});
