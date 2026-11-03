import { dehydrate, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Linking, Text } from 'react-native';

import { SessionProvider, useEmailLinkError, useSession } from '@/features/auth/session';
import { AppError } from '@/lib/errors';

let emit: ((user: { userId: string } | null) => void) | undefined;
const mockStop = jest.fn();
const mockComplete = jest.fn();
jest.mock('@/features/auth/api', () => ({
  completeEmailAuthCallback: (args: unknown) => mockComplete(args),
  subscribeToSession: (listener: (user: { userId: string } | null) => void) => {
    emit = listener;
    return mockStop;
  },
}));

function Probe() {
  const { status, userId } = useSession();
  const error = useEmailLinkError();
  return (
    <>
      <Text testID="probe">{`${status}:${userId ?? '-'}`}</Text>
      <Text testID="error">{error?.message ?? ''}</Text>
    </>
  );
}

let linkListener: ((event: { url: string }) => void) | undefined;
const mockRemove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  jest.spyOn(Linking, 'addEventListener').mockImplementation((_event, listener) => {
    linkListener = listener;
    return { remove: mockRemove };
  });
});
afterEach(() => {
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

async function renderSession() {
  const qc = new QueryClient();
  const view = await render(
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

describe('SessionProvider', () => {
  it('is loading until the stored session is read, then follows sign-in and sign-out', async () => {
    const { unmount, qc } = await renderSession();
    expect(screen.getByTestId('probe').props.children).toBe('loading:-');
    await act(async () => emit?.({ userId: 'u1' }));
    expect(screen.getByTestId('probe').props.children).toBe('signedIn:u1');
    await act(async () => emit?.(null));
    expect(screen.getByTestId('probe').props.children).toBe('signedOut:-');
    await unmount();
    expect(mockStop).toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalled();
    qc.clear();
  });

  it('does not release signed-out welcome while the cold URL lookup is pending', async () => {
    let resolveURL!: (url: string | null) => void;
    jest.mocked(Linking.getInitialURL).mockReturnValue(
      new Promise((resolve) => {
        resolveURL = resolve;
      }),
    );
    const { qc } = await renderSession();
    await act(async () => emit?.(null));
    expect(screen.getByTestId('probe').props.children).toBe('loading:-');
    await act(async () => resolveURL(null));
    expect(screen.getByTestId('probe').props.children).toBe('signedOut:-');
    qc.clear();
  });

  it.each([
    ['bonded://auth/callback?code=c', { kind: 'pkce', code: 'c' }],
    [
      'bonded://auth/callback#access_token=a&refresh_token=r',
      {
        kind: 'implicit',
        access_token: 'a',
        refresh_token: 'r',
      },
    ],
  ])(
    'cold link %s waits for the Supabase session before releasing the gate',
    async (url, callback) => {
      jest.mocked(Linking.getInitialURL).mockResolvedValue(url);
      let finish!: (user: { userId: string }) => void;
      mockComplete.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const { qc } = await renderSession();
      await act(async () => emit?.(null));
      await waitFor(() => expect(mockComplete).toHaveBeenCalledWith(callback));
      expect(screen.getByTestId('probe').props.children).toBe('loading:-');
      // The client may emit SIGNED_IN before its exchange promise completes.
      await act(async () => emit?.({ userId: 'u1' }));
      expect(screen.getByTestId('probe').props.children).toBe('loading:-');
      await act(async () => finish({ userId: 'u1' }));
      await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:u1'));
      qc.clear();
    },
  );

  it('handles warm links, ignores unrelated links, and deduplicates cold/warm delivery', async () => {
    const url = 'bonded://auth/callback?code=c';
    jest.mocked(Linking.getInitialURL).mockResolvedValue(url);
    mockComplete.mockResolvedValue({ userId: 'u1' });
    const { qc } = await renderSession();
    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:u1'));
    await act(async () => {
      linkListener?.({ url });
      linkListener?.({ url: 'bonded://j/BND1234?t=invite' });
    });
    expect(mockComplete).toHaveBeenCalledTimes(1);
    await act(async () => emit?.(null));
    mockComplete.mockResolvedValue({ userId: 'u2' });
    await act(async () =>
      linkListener?.({
        url: 'bonded://auth/callback#access_token=other&refresh_token=other',
      }),
    );
    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:u2'));
    expect(mockComplete).toHaveBeenCalledTimes(2);
    qc.clear();
  });

  it('handles a warm callback arriving before the cold lookup completes, once', async () => {
    let resolveURL!: (url: string | null) => void;
    jest.mocked(Linking.getInitialURL).mockReturnValue(
      new Promise((resolve) => {
        resolveURL = resolve;
      }),
    );
    mockComplete.mockResolvedValue({ userId: 'u1' });
    const { qc } = await renderSession();
    const url = 'bonded://auth/callback?code=early-warm';
    await act(async () => {
      emit?.(null);
      linkListener?.({ url });
    });
    expect(screen.getByTestId('probe').props.children).toBe('loading:-');
    await act(async () => resolveURL(url));
    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:u1'));
    expect(mockComplete).toHaveBeenCalledTimes(1);
    qc.clear();
  });

  it('serializes overlapping callbacks and does not let an old failure override fresh success', async () => {
    let fail!: (error: AppError) => void;
    mockComplete
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
      )
      .mockResolvedValueOnce({ userId: 'u2' });
    const { qc } = await renderSession();
    await act(async () => {
      emit?.(null);
      linkListener?.({ url: 'bonded://auth/callback?code=old' });
      linkListener?.({ url: 'bonded://auth/callback?code=fresh' });
    });
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe').props.children).toBe('loading:-');
    await act(async () => fail(new AppError('UNKNOWN', 'Old link expired.')));
    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:u2'));
    expect(mockComplete).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('error').props.children).toBe('');
    qc.clear();
  });

  it('fails offline without pausing or persisting callback credentials and preserves an existing session', async () => {
    onlineManager.setOnline(false);
    mockComplete.mockRejectedValueOnce(new AppError('NETWORK', "You're offline."));
    const { qc } = await renderSession();
    await act(async () => {
      emit?.({ userId: 'existing' });
      linkListener?.({ url: 'bonded://auth/callback?code=private-credential' });
    });
    await waitFor(() => expect(screen.getByTestId('error').props.children).toBe("You're offline."));
    expect(screen.getByTestId('probe').props.children).toBe('signedIn:existing');
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(dehydrate(qc).mutations).toEqual([]);
    qc.clear();
  });

  it.each(['bonded://auth/callback?code=expired', 'bonded://auth/callback#access_token=partial'])(
    'stays signed out with an actionable error for %s and accepts a fresh warm link',
    async (url) => {
      jest.mocked(Linking.getInitialURL).mockResolvedValue(url);
      mockComplete.mockRejectedValueOnce(new AppError('UNKNOWN', 'Request a new email.'));
      const { qc } = await renderSession();
      await act(async () => emit?.(null));
      await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedOut:-'));
      expect(screen.getByTestId('error').props.children).toBe('Request a new email.');
      mockComplete.mockResolvedValueOnce({ userId: 'u1' });
      await act(async () => linkListener?.({ url: 'bonded://auth/callback?code=fresh' }));
      await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:u1'));
      expect(screen.getByTestId('error').props.children).toBe('');
      qc.clear();
    },
  );
});
