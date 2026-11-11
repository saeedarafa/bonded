import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { ThreadMessage } from '@/features/thread/api';
import {
  mergeThread,
  useMessageReaction,
  useSendMessage,
  useThreadItems,
  withMyMessageReaction,
} from '@/features/thread/hooks';
import { AppError } from '@/lib/errors';
import { clearOutbox, useOutbox, type OutboxItem } from '@/lib/outbox';
import { queryKeys } from '@/lib/queryKeys';

const mockSend = jest.fn<Promise<void>, [{ clientId: string; body: string }]>();
const mockSetReaction = jest.fn<Promise<void>, [unknown]>();
const mockRemoveReaction = jest.fn<Promise<void>, [unknown]>();
jest.mock('@/features/thread/api', () => ({
  sendMessage: (input: { clientId: string; body: string }) => mockSend(input),
  setMessageReaction: (input: unknown) => mockSetReaction(input),
  removeMessageReaction: (input: unknown) => mockRemoveReaction(input),
}));

const server = (clientId: string, id = `m-${clientId}`): ThreadMessage => ({
  id,
  clientId,
  userId: 'u1',
  body: 'b',
  voice: null,
  createdAt: '2026-11-02T21:00:00Z',
  reactions: [],
});

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  jest.clearAllMocks();
  clearOutbox();
});
afterEach(() => qc.clear());

describe('mergeThread', () => {
  const pending = (clientId: string, status: OutboxItem['status']): OutboxItem => ({
    clientId,
    coupleQuestionId: 'cq-1',
    body: 'p',
    createdAt: '2026-11-02T21:05:00Z',
    status,
  });

  it('appends my pending messages and drops one the server already has', () => {
    const merged = mergeThread(
      [server('a')],
      [
        pending('a', 'sent'),
        pending('b', 'failed'),
        { ...pending('c', 'sending'), coupleQuestionId: 'x' },
      ],
      'cq-1',
      'u1',
    );
    expect(merged.map((m) => [m.clientId, m.status])).toEqual([
      ['a', 'sent'],
      ['b', 'failed'],
    ]);
  });
});

describe('useSendMessage', () => {
  it('a retry reuses the same client_id, so a duplicate send is impossible', async () => {
    mockSend.mockRejectedValueOnce(new AppError('NETWORK', 'offline'));
    const { result } = await renderHook(
      () => {
        const items = useThreadItems(
          'cq-1',
          'u1',
          qc.getQueryData(queryKeys.thread.detail('cq-1')),
        );
        return { ...useSendMessage('cq-1', 'u1'), items };
      },
      { wrapper },
    );

    await act(async () => result.current.send('Deal.'));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('failed'));
    const clientId = result.current.items[0]?.clientId ?? '';
    expect(clientId).not.toBe('');

    // The server got the first insert after all, then the retry hits the unique client_id.
    let resolveRetry: () => void = () => undefined;
    mockSend.mockImplementationOnce(() => new Promise<void>((r) => (resolveRetry = r)));
    await act(async () => result.current.retry(clientId));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.status).toBe('sending');
    // A second tap while it is still sending does nothing.
    await act(async () => result.current.retry(clientId));
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls.map(([i]) => i.clientId)).toEqual([clientId, clientId]);

    qc.setQueryData(queryKeys.thread.detail('cq-1'), [server(clientId)]);
    await act(async () => resolveRetry());
    await waitFor(() => expect(useOutbox.getState().items).toEqual({}));
  });

  it('gives every new message its own client_id', async () => {
    mockSend.mockResolvedValue(undefined);
    const { result } = await renderHook(() => useSendMessage('cq-1', 'u1'), { wrapper });
    await act(async () => {
      result.current.send('one');
      result.current.send('two');
    });
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    const [a, b] = mockSend.mock.calls.map(([i]) => i.clientId);
    expect(a).not.toBe(b);
  });
});

describe('message reactions (D45)', () => {
  const withHeart: ThreadMessage = {
    ...server('a', 'm1'),
    reactions: [
      { id: 'r1', userId: 'u2', kind: '❤️' },
      { id: 'r2', userId: 'u1', kind: '😂' },
    ],
  };

  it('withMyMessageReaction replaces or removes only mine on that message', () => {
    const other = server('b', 'm2');
    const replaced = withMyMessageReaction([withHeart, other], 'm1', 'u1', '🔥');
    expect(replaced[0]!.reactions).toEqual([
      { id: 'r1', userId: 'u2', kind: '❤️' },
      { id: 'optimistic-u1', userId: 'u1', kind: '🔥' },
    ]);
    expect(replaced[1]).toBe(other);
    expect(withMyMessageReaction([withHeart], 'm1', 'u1', null)[0]!.reactions).toEqual([
      { id: 'r1', userId: 'u2', kind: '❤️' },
    ]);
  });

  it('is optimistic and rolls back on an error (e.g. INVALID_REACTION)', async () => {
    const key = queryKeys.thread.detail('cq-1');
    qc.setQueryData(key, [withHeart]);
    let reject: (e: AppError) => void = () => undefined;
    mockSetReaction.mockReturnValue(new Promise((_, r) => (reject = r)));
    const { result } = await renderHook(() => useMessageReaction('cq-1'), { wrapper });
    await act(async () => {
      result.current.mutate({ messageId: 'm1', userId: 'u1', kind: '🥹' });
    });
    await waitFor(() =>
      expect(qc.getQueryData<ThreadMessage[]>(key)![0]!.reactions.map((r) => r.kind)).toEqual([
        '❤️',
        '🥹',
      ]),
    );
    await act(async () => reject(new AppError('INVALID_REACTION', 'x')));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<ThreadMessage[]>(key)![0]!.reactions).toEqual(withHeart.reactions);
    expect(mockRemoveReaction).not.toHaveBeenCalled();
  });

  it('null removes my reaction (delete own row)', async () => {
    mockRemoveReaction.mockResolvedValue();
    const { result } = await renderHook(() => useMessageReaction('cq-1'), { wrapper });
    await act(async () => {
      result.current.mutate({ messageId: 'm1', userId: 'u1', kind: null });
    });
    await waitFor(() =>
      expect(mockRemoveReaction).toHaveBeenCalledWith({ messageId: 'm1', userId: 'u1' }),
    );
    expect(mockSetReaction).not.toHaveBeenCalled();
  });
});
