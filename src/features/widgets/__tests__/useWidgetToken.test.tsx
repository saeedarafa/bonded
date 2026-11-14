import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { SessionState } from '@/features/auth/session';
import { queryKeys } from '@/lib/queryKeys';

import { registerWidgetRefresh, unregisterWidgetRefresh } from '../backgroundTask';
import { canHoldWidgetToken, forgetWidgetToken, refreshWidgetToken } from '../tokens';
import { useWidgetToken } from '../useWidgetToken';

/** MOB-77: the root hook mints while paired and deletes the token otherwise. */

jest.mock('../tokens', () => ({
  canHoldWidgetToken: jest.fn(() => true),
  forgetWidgetToken: jest.fn(() => Promise.resolve()),
  refreshWidgetToken: jest.fn(() => Promise.resolve('kept')),
}));
jest.mock('../backgroundTask', () => ({
  registerWidgetRefresh: jest.fn(() => Promise.resolve(true)),
  unregisterWidgetRefresh: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: jest.fn(() => new Promise(() => {})),
}));

const member = (user_id: string) => ({ user_id, left_at: null });
const signedIn: SessionState = { status: 'signedIn', userId: 'me' };

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

let appListener: ((s: AppStateStatus) => void) | undefined;
beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => {
    appListener = cb as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

it('waits while the session or the couple is still loading', async () => {
  await renderHook(() => useWidgetToken({ status: 'loading', userId: null }), { wrapper });
  await renderHook(() => useWidgetToken(signedIn), { wrapper });
  expect(refreshWidgetToken).not.toHaveBeenCalled();
  expect(forgetWidgetToken).not.toHaveBeenCalled();
});

it('paired: mints now and again on every foreground', async () => {
  qc.setQueryData(queryKeys.couple.active(), {
    couple_members: [member('me'), member('sam')],
  });
  await renderHook(() => useWidgetToken(signedIn), { wrapper });
  expect(refreshWidgetToken).toHaveBeenCalledTimes(1);
  await act(async () => appListener?.('active'));
  await act(async () => appListener?.('background'));
  expect(refreshWidgetToken).toHaveBeenCalledTimes(2);
});

it.each([
  ['signed out', { status: 'signedOut', userId: null } as SessionState, undefined],
  ['no couple / ended couple', signedIn, null],
  ['solo couple', signedIn, { couple_members: [member('me')] }],
])('%s: deletes the token on this phone', async (_name, session, couple) => {
  if (couple !== undefined) qc.setQueryData(queryKeys.couple.active(), couple);
  await renderHook(() => useWidgetToken(session), { wrapper });
  expect(forgetWidgetToken).toHaveBeenCalledTimes(1);
  expect(refreshWidgetToken).not.toHaveBeenCalled();
  // forgetWidgetToken itself unregisters the background refresh (tokens.test.ts).
  expect(registerWidgetRefresh).not.toHaveBeenCalled();
});

it('unpair while open: the token goes', async () => {
  qc.setQueryData(queryKeys.couple.active(), {
    couple_members: [member('me'), member('sam')],
  });
  await renderHook(() => useWidgetToken(signedIn), { wrapper });
  await act(async () => qc.setQueryData(queryKeys.couple.active(), null));
  await waitFor(() => expect(forgetWidgetToken).toHaveBeenCalledTimes(1));
});

describe('background refresh registration (MOB-78b)', () => {
  const paired = () =>
    qc.setQueryData(queryKeys.couple.active(), {
      couple_members: [member('me'), member('sam')],
    });

  it('paired in a build with a token reader: registers once (not again on foreground)', async () => {
    paired();
    await renderHook(() => useWidgetToken(signedIn), { wrapper });
    await act(async () => appListener?.('active'));
    expect(registerWidgetRefresh).toHaveBeenCalledTimes(1);
    expect(unregisterWidgetRefresh).not.toHaveBeenCalled();
  });

  it('paired but no token reader (free widgets, Expo Go): never registers, unregisters', async () => {
    jest.mocked(canHoldWidgetToken).mockReturnValueOnce(false);
    paired();
    await renderHook(() => useWidgetToken(signedIn), { wrapper });
    expect(registerWidgetRefresh).not.toHaveBeenCalled();
    expect(unregisterWidgetRefresh).toHaveBeenCalledTimes(1);
  });

  it('still loading: neither registers nor unregisters', async () => {
    await renderHook(() => useWidgetToken({ status: 'loading', userId: null }), { wrapper });
    expect(registerWidgetRefresh).not.toHaveBeenCalled();
    expect(unregisterWidgetRefresh).not.toHaveBeenCalled();
  });
});
