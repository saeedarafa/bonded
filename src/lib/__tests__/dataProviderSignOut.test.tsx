import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { DataProvider } from '@/lib/DataProvider';

/** MOB-89 (#479): every sign-out (button, expiry, delete account) empties the OS HTTP cache. */

type Listener = (event: string) => void;
const mockListeners: Listener[] = [];
const mockClearHttpCache = jest.fn();

jest.mock('@/lib/httpCache', () => ({ clearHttpCache: () => mockClearHttpCache() }));
jest.mock('@/lib/supabase', () => ({
  startAuthAutoRefresh: () => () => undefined,
  supabase: {
    auth: {
      signOut: () => Promise.resolve({ error: null }),
      onAuthStateChange: (cb: Listener) => {
        mockListeners.push(cb);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  },
}));
jest.mock('@/lib/queryClient', () => ({
  ...jest.requireActual<object>('@/lib/queryClient'),
  setupQueryManagers: () => () => undefined,
}));

it('clears the OS HTTP cache on SIGNED_OUT only', async () => {
  const view = await render(
    <DataProvider>
      <Text>child</Text>
    </DataProvider>,
  );
  const emit = (event: string) =>
    act(async () => {
      mockListeners.forEach((cb) => cb(event));
    });
  expect(mockListeners.length).toBeGreaterThan(0);
  await emit('TOKEN_REFRESHED');
  await emit('SIGNED_IN');
  expect(mockClearHttpCache).not.toHaveBeenCalled();
  await emit('SIGNED_OUT');
  expect(mockClearHttpCache).toHaveBeenCalledTimes(1);
  await view.unmount();
});
