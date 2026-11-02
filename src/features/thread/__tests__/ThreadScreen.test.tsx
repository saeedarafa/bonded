import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { ThreadMessage } from '@/features/thread/api';
import ThreadScreen from '@/features/thread/screens/ThreadScreen';
import { AppError } from '@/lib/errors';
import { clearOutbox } from '@/lib/outbox';
import { useTyping } from '@/lib/typing';
import { renderUi } from '@/test/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockGetThread = jest.fn<Promise<ThreadMessage[]>, [string]>();
const mockSend = jest.fn<Promise<void>, [{ clientId: string; body: string }]>();
const mockMarkRead = jest.fn<Promise<void>, [{ lastReadAt: string }]>();
jest.mock('@/features/thread/api', () => ({
  getThread: (id: string) => mockGetThread(id),
  sendMessage: (input: { clientId: string; body: string }) => mockSend(input),
  markThreadRead: (input: { lastReadAt: string }) => mockMarkRead(input),
}));
const mockTyping = jest.fn();
jest.mock('@/lib/useCoupleRealtime', () => ({
  useCoupleRealtime: () => undefined,
  sendTypingSignal: (...args: unknown[]) => mockTyping(...args),
}));

let mockBoth = true;
jest.mock('@/features/daily/useTodayContext', () => ({
  useTodayContext: () => ({
    userId: 'u1',
    couple: { data: { id: 'couple-1' } },
    question: { data: { id: 'cq-1', answerCount: 2, question: 'Q?', answers: [] } },
    me: 'Maya',
    partner: 'Sam',
    mine: mockBoth ? { userId: 'u1', createdAt: '2026-11-02T20:51:00Z' } : null,
    partnerAnswered: true,
    error: null,
    refetch: jest.fn(),
  }),
}));

const msg = (id: string, userId: string, body: string, at: string): ThreadMessage => ({
  id,
  clientId: `c-${id}`,
  userId,
  body,
  createdAt: at,
  reactions: [],
});
const THREAD = [
  msg('m1', 'u2', 'Wait, I hum while I cook??', '2026-11-02T21:10:00Z'),
  {
    ...msg('m2', 'u1', 'Every single time.', '2026-11-02T21:11:00Z'),
    reactions: [{ id: 'r1', userId: 'u2', kind: 'love' as const }],
  },
];

let qc: QueryClient;
const renderScreen = () =>
  renderUi(
    <QueryClientProvider client={qc}>
      <ThreadScreen />
    </QueryClientProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  mockBoth = true;
  clearOutbox();
  useTyping.getState().clear('cq-1');
  mockGetThread.mockResolvedValue(THREAD);
  mockMarkRead.mockResolvedValue(undefined);
});
afterEach(() => qc.clear());

describe('22 Thread', () => {
  it('shows both sides, the partner reaction, and marks read at the newest server message', async () => {
    await renderScreen();
    expect(await screen.findByText('Every single time.')).toBeTruthy();
    expect(screen.getByText('Wait, I hum while I cook??')).toBeTruthy();
    expect(screen.getByLabelText('Love')).toBeTruthy();
    await waitFor(() =>
      expect(mockMarkRead).toHaveBeenCalledWith(
        expect.objectContaining({ lastReadAt: '2026-11-02T21:11:00Z' }),
      ),
    );
  });

  it('a failed send stays as "Not sent" and the retry reuses its client_id', async () => {
    mockSend.mockRejectedValueOnce(new AppError('NETWORK', 'offline')).mockResolvedValue();
    await renderScreen();
    await screen.findByTestId('22-composer');
    await fireEvent.changeText(screen.getByTestId('22-composer'), 'Deal.');
    await fireEvent.press(screen.getByTestId('22-composer-send'));
    expect(await screen.findByText('Not sent. Tap to retry')).toBeTruthy();
    expect(screen.getAllByText('Deal.')).toHaveLength(1);
    await fireEvent.press(screen.getByText('Not sent. Tap to retry'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    const ids = mockSend.mock.calls.map(([i]) => i.clientId);
    expect(ids[0]).toBe(ids[1]);
  });

  it('broadcasts typing (ids only) and shows the partner typing until it expires', async () => {
    await renderScreen();
    await screen.findByTestId('22-composer');
    await fireEvent.changeText(screen.getByTestId('22-composer'), 'Hm');
    expect(mockTyping).toHaveBeenCalledWith('couple-1', {
      user_id: 'u1',
      couple_question_id: 'cq-1',
    });
    expect(screen.queryByTestId('22-typing')).toBeNull();
    await act(async () => useTyping.getState().mark({ user_id: 'u2', couple_question_id: 'cq-1' }));
    expect(screen.getByTestId('22-typing')).toBeTruthy();
    await act(async () => useTyping.getState().clear('cq-1'));
    expect(screen.queryByTestId('22-typing')).toBeNull();
  });

  it('is not open before I have answered, and never asks for messages', async () => {
    mockBoth = false;
    await renderScreen();
    expect(screen.getByTestId('22-not-ready')).toBeTruthy();
    expect(screen.queryByTestId('22-composer')).toBeNull();
    expect(mockGetThread).not.toHaveBeenCalled();
  });

  it('shows an empty state with the composer', async () => {
    mockGetThread.mockResolvedValue([]);
    await renderScreen();
    expect(await screen.findByTestId('22-empty')).toBeTruthy();
    expect(screen.getByTestId('22-composer')).toBeTruthy();
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it('dark mode renders', async () => {
    await renderUi(
      <QueryClientProvider client={qc}>
        <ThreadScreen />
      </QueryClientProvider>,
      { scheme: 'dark' },
    );
    expect(await screen.findByText('Every single time.')).toBeTruthy();
  });
});
