import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { SessionProvider, useSession } from '@/features/auth/session';

let emit: ((user: { userId: string } | null) => void) | undefined;
const mockStop = jest.fn();
jest.mock('@/features/auth/api', () => ({
  subscribeToSession: (listener: (user: { userId: string } | null) => void) => {
    emit = listener;
    return mockStop;
  },
}));

function Probe() {
  const { status, userId } = useSession();
  return <Text testID="probe">{`${status}:${userId ?? '-'}`}</Text>;
}

describe('SessionProvider', () => {
  it('is loading until the stored session is read, then follows sign-in and sign-out', async () => {
    const { unmount } = await render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByTestId('probe').props.children).toBe('loading:-');
    await act(async () => emit?.({ userId: 'u1' }));
    expect(screen.getByTestId('probe').props.children).toBe('signedIn:u1');
    await act(async () => emit?.(null));
    expect(screen.getByTestId('probe').props.children).toBe('signedOut:-');
    await unmount();
    expect(mockStop).toHaveBeenCalled();
  });
});
