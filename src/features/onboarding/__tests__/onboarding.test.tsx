import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppError } from '@/lib/errors';

import { queryKeys } from '@/lib/queryKeys';

import { isKeyDatesWriteError, useSetupBond } from '../hooks';
import { useOnboarding } from '../store';

const calls: string[] = [];
const mockCreateCouple = jest.fn();
const mockUpdateProfile = jest.fn();
const mockGetActiveCouple = jest.fn();
jest.mock('@/features/couple/api', () => ({
  createCouple: (...args: unknown[]) => mockCreateCouple(...args),
  getActiveCouple: () => mockGetActiveCouple(),
}));
const mockUpsertKeyDates = jest.fn();
jest.mock('@/features/keyDates/api', () => ({
  upsertKeyDates: (...args: unknown[]) => mockUpsertKeyDates(...args),
}));
jest.mock('@/features/profile/api', () => ({
  updateMyProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  deviceTimezone: () => 'Europe/Berlin',
}));

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('onboarding store', () => {
  beforeEach(() => useOnboarding.getState().reset());

  it('toggles goals and keeps the answers until reset', () => {
    const s = useOnboarding.getState();
    s.setStage('dating');
    s.toggleGoal('romance');
    s.toggleGoal('future');
    s.toggleGoal('romance');
    expect(useOnboarding.getState().goals).toEqual(['future']);
    expect(useOnboarding.getState().stage).toBe('dating');
    useOnboarding.getState().reset();
    expect(useOnboarding.getState().stage).toBeNull();
    expect(useOnboarding.getState().goals).toEqual([]);
  });
});

describe('useSetupBond', () => {
  beforeEach(() => {
    calls.length = 0;
    mockGetActiveCouple.mockReset();
    mockGetActiveCouple.mockResolvedValue(null);
    mockCreateCouple.mockReset();
    mockUpdateProfile.mockReset();
    mockUpdateProfile.mockImplementation(() => {
      calls.push('profile');
      return Promise.resolve();
    });
    mockCreateCouple.mockImplementation(() => {
      calls.push('couple');
      return Promise.resolve('c1');
    });
    mockUpsertKeyDates.mockReset();
    mockUpsertKeyDates.mockImplementation(() => {
      calls.push('dates');
      return Promise.resolve();
    });
    const s = useOnboarding.getState();
    s.reset();
    s.setStage('living_together');
    s.toggleGoal('laughing');
    s.setNames({ displayName: '  Alex ', partnerName: ' Sam ' });
  });

  it('writes the profile first, then create_couple with the trimmed answers, then clears them', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
    const { result } = await renderHook(() => useSetupBond(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      await result.current.mutateAsync({ userId: 'u1' });
    });
    expect(calls).toEqual(['profile', 'couple', 'dates']);
    // Nothing typed on 47 (skipped): no rows.
    expect(mockUpsertKeyDates).toHaveBeenCalledWith([]);
    expect(mockUpdateProfile).toHaveBeenCalledWith('u1', {
      displayName: 'Alex',
      timezone: expect.any(String),
    });
    expect(mockCreateCouple).toHaveBeenCalledWith({
      stage: 'living_together',
      goals: ['laughing'],
      partnerName: 'Sam',
    });
    expect(useOnboarding.getState().stage).toBeNull();
    qc.clear();
  });

  it('#93: the new couple is in the cache before the answers are cleared', async () => {
    const couple = { id: 'c1', couple_members: [{ user_id: 'u1', left_at: null }] };
    mockGetActiveCouple.mockImplementation(() => {
      calls.push('read couple');
      // Still answered while the couple is read: the reset comes after.
      expect(useOnboarding.getState().stage).toBe('living_together');
      return Promise.resolve(couple);
    });
    const qc = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
    const { result } = await renderHook(() => useSetupBond(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      await result.current.mutateAsync({ userId: 'u1' });
    });
    expect(calls).toEqual(['profile', 'couple', 'dates', 'read couple']);
    expect(qc.getQueryData(queryKeys.couple.active())).toEqual(couple);
    expect(useOnboarding.getState().stage).toBeNull();
    qc.clear();
  });

  it('#93: a failed couple read does not fail the setup (the couple exists)', async () => {
    mockGetActiveCouple.mockRejectedValue(new Error('offline'));
    const qc = new QueryClient({
      defaultOptions: { mutations: { gcTime: 0 }, queries: { retry: false } },
    });
    const { result } = await renderHook(() => useSetupBond(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      await result.current.mutateAsync({ userId: 'u1' });
    });
    expect(result.current.isSuccess).toBe(true);
    qc.clear();
  });

  it('keeps the answers when create_couple fails, so Try again can repeat it', async () => {
    mockCreateCouple.mockRejectedValueOnce(new Error('boom'));
    const qc = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
    const { result } = await renderHook(() => useSetupBond(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      result.current.mutate({ userId: 'u1' });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(useOnboarding.getState().stage).toBe('living_together');
    qc.clear();
  });

  describe('key dates (47, MOB-28)', () => {
    beforeEach(() => {
      useOnboarding
        .getState()
        .setKeyDates({ together_since: '2023-03-14', birthday: '1990-05-09' }, false);
    });

    async function run(input: { userId: string; skipKeyDates?: boolean }) {
      const qc = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
      const hook = await renderHook(() => useSetupBond(), { wrapper: wrapperFor(qc) });
      await act(async () => {
        hook.result.current.mutate(input);
      });
      await waitFor(() => expect(hook.result.current.isIdle).toBe(false));
      await waitFor(() => expect(hook.result.current.isPending).toBe(false));
      return { ...hook, qc };
    }

    it('upserts the dates into the new couple after create_couple, my birthday with my id', async () => {
      const { result, qc } = await run({ userId: 'u1' });
      expect(result.current.isSuccess).toBe(true);
      expect(calls).toEqual(['profile', 'couple', 'dates']);
      expect(mockUpsertKeyDates).toHaveBeenCalledWith([
        {
          couple_id: 'c1',
          kind: 'together_since',
          user_id: null,
          date: '2023-03-14',
          remind_week_before: false,
        },
        {
          couple_id: 'c1',
          kind: 'birthday',
          user_id: 'u1',
          date: '1990-05-09',
          remind_week_before: false,
        },
      ]);
      expect(useOnboarding.getState().keyDates).toEqual({});
      qc.clear();
    });

    it('a refused dates write keeps every answer and is marked so setup can go on without them', async () => {
      mockUpsertKeyDates.mockRejectedValueOnce(
        new AppError('UNKNOWN', 'Something went wrong. Please try again.'),
      );
      const { result, qc } = await run({ userId: 'u1' });
      expect(result.current.isError).toBe(true);
      expect(isKeyDatesWriteError(result.current.error)).toBe(true);
      expect(result.current.error?.kind).toBe('UNKNOWN');
      expect(useOnboarding.getState()).toMatchObject({
        stage: 'living_together',
        keyDates: { together_since: '2023-03-14', birthday: '1990-05-09' },
      });
      qc.clear();
    });

    it('a dead session is passed through as a sign-out, not as a dates problem', async () => {
      mockUpsertKeyDates.mockRejectedValueOnce(new AppError('SIGNED_OUT', 'Signed out'));
      const { result, qc } = await run({ userId: 'u1' });
      expect(result.current.error?.signedOut).toBe(true);
      expect(isKeyDatesWriteError(result.current.error)).toBe(false);
      qc.clear();
    });

    it('a create_couple failure is not a dates problem', async () => {
      mockCreateCouple.mockRejectedValueOnce(new AppError('NETWORK', 'Offline'));
      const { result, qc } = await run({ userId: 'u1' });
      expect(isKeyDatesWriteError(result.current.error)).toBe(false);
      expect(mockUpsertKeyDates).not.toHaveBeenCalled();
      qc.clear();
    });

    it('skipKeyDates drops the dates and finishes without writing any', async () => {
      const { result, qc } = await run({ userId: 'u1', skipKeyDates: true });
      expect(result.current.isSuccess).toBe(true);
      expect(mockUpsertKeyDates).toHaveBeenCalledWith([]);
      qc.clear();
    });
  });
});
