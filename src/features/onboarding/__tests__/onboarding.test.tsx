import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useSetupBond } from '../hooks';
import { useOnboarding } from '../store';

const calls: string[] = [];
const mockCreateCouple = jest.fn();
const mockUpdateProfile = jest.fn();
jest.mock('@/features/couple/api', () => ({
  createCouple: (...args: unknown[]) => mockCreateCouple(...args),
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
    expect(calls).toEqual(['profile', 'couple']);
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
});
