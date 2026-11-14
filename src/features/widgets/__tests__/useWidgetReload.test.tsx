import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { SessionState } from '@/features/auth/session';
import { queryKeys } from '@/lib/queryKeys';

import { requestWidgetReload } from '../reload';
import { useWidgetReload } from '../useWidgetReload';

/**
 * MOB-78c (QA-49b): after a Premium lapse the Android Little things widget kept "Send Sam a hug"
 * until tapped. The app now redraws the widgets on foreground and on a Premium / couple change.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };

jest.mock('../reload', () => ({ requestWidgetReload: jest.fn() }));
let mockSession: SessionState = { status: 'signedIn', userId: 'me' };
jest.mock('@/features/auth/session', () => ({ useSession: () => mockSession }));
jest.mock('@/features/couple/api', () => ({
  getActiveCouple: jest.fn(() => new Promise(() => {})),
}));
jest.mock('@/features/premium/api', () => ({
  getEntitlements: jest.fn(() => new Promise(() => {})),
}));

const reload = requestWidgetReload as jest.Mock;
const member = (user_id: string) => ({ user_id, left_at: null });
const pairedCouple = { id: 'c1', couple_members: [member('me'), member('sam')] };
const FUTURE = '2099-01-01T00:00:00Z';

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

let appListener: ((s: AppStateStatus) => void) | undefined;
const remove = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { status: 'signedIn', userId: 'me' };
  qc = new QueryClient();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => {
    appListener = cb as (s: AppStateStatus) => void;
    return { remove } as never;
  });
});

function premiumCouple() {
  qc.setQueryData(queryKeys.couple.active(), pairedCouple);
  qc.setQueryData(queryKeys.entitlements(), [
    { user_id: 'me', is_active: true, expires_at: FUTURE },
  ]);
}

it('reloads on every foreground, not on background', async () => {
  premiumCouple();
  await renderHook(() => useWidgetReload(mockSession), { wrapper });
  reload.mockClear();
  await act(async () => appListener?.('background'));
  await act(async () => appListener?.('inactive'));
  expect(reload).not.toHaveBeenCalled();
  await act(async () => appListener?.('active'));
  await act(async () => appListener?.('active'));
  expect(reload.mock.calls).toEqual([['foreground'], ['foreground']]);
});

it('stops listening on unmount', async () => {
  const hook = await renderHook(() => useWidgetReload(mockSession), { wrapper });
  await hook.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

it('reloads once the state is known at launch, not again while it stays the same', async () => {
  premiumCouple();
  const hook = await renderHook(() => useWidgetReload(mockSession), { wrapper });
  expect(reload.mock.calls).toEqual([['state']]);
  await hook.rerender(undefined);
  await act(async () => qc.setQueryData(queryKeys.couple.active(), { ...pairedCouple }));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
  expect(reload).toHaveBeenCalledTimes(1);
});

it('waits while the session is loading', async () => {
  await renderHook(() => useWidgetReload({ status: 'loading', userId: null }), { wrapper });
  expect(reload).not.toHaveBeenCalled();
});

it('Premium lapses: the widgets redraw (QA-49b)', async () => {
  premiumCouple();
  await renderHook(() => useWidgetReload(mockSession), { wrapper });
  reload.mockClear();
  await act(async () =>
    qc.setQueryData(queryKeys.entitlements(), [
      { user_id: 'me', is_active: false, expires_at: FUTURE },
    ]),
  );
  await waitFor(() => expect(reload.mock.calls).toEqual([['state']]));
  // ... and renewal redraws again.
  await act(async () =>
    qc.setQueryData(queryKeys.entitlements(), [
      { user_id: 'me', is_active: true, expires_at: FUTURE },
    ]),
  );
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
});

it("the partner's plan counts: their lapse redraws too", async () => {
  qc.setQueryData(queryKeys.couple.active(), pairedCouple);
  qc.setQueryData(queryKeys.entitlements(), [
    { user_id: 'sam', is_active: true, expires_at: FUTURE },
  ]);
  await renderHook(() => useWidgetReload(mockSession), { wrapper });
  reload.mockClear();
  await act(async () => qc.setQueryData(queryKeys.entitlements(), []));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
});

it('couple changes redraw: unpair, new couple', async () => {
  premiumCouple();
  await renderHook(() => useWidgetReload(mockSession), { wrapper });
  reload.mockClear();
  await act(async () => qc.setQueryData(queryKeys.couple.active(), null));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  await act(async () =>
    qc.setQueryData(queryKeys.couple.active(), { id: 'c2', couple_members: [member('me')] }),
  );
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  await act(async () =>
    qc.setQueryData(queryKeys.couple.active(), {
      id: 'c2',
      couple_members: [member('me'), member('alex')],
    }),
  );
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(3));
});

it('sign-out redraws', async () => {
  premiumCouple();
  const hook = await renderHook(({ s }: { s: SessionState }) => useWidgetReload(s), {
    wrapper,
    initialProps: { s: mockSession },
  });
  reload.mockClear();
  mockSession = { status: 'signedOut', userId: null };
  await hook.rerender({ s: mockSession });
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
});

it('the reload path carries no data and never logs', () => {
  const dir = 'src/features/widgets';
  for (const file of ['reload.ts', 'useWidgetReload.ts']) {
    const src = fs.readFileSync(`${dir}/${file}`, 'utf8');
    expect(src).not.toMatch(/console\.|Sentry|track\(|capture/);
  }
  expect(fs.readFileSync(`${dir}/reload.ts`, 'utf8')).toContain('reloadWidgetsNow()');
});
