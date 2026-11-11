import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { ThreadMessage } from '@/features/thread/api';
import ThreadScreen from '@/features/thread/screens/ThreadScreen';
import { AppError, toAppError } from '@/lib/errors';
import { clearOutbox } from '@/lib/outbox';
import { useTyping } from '@/lib/typing';
import { renderUi } from '@/test/render';
import { useToast } from '@/ui';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

const mockGetThread = jest.fn<Promise<ThreadMessage[]>, [string]>();
const mockSend = jest.fn<Promise<void>, [{ clientId: string; body: string }]>();
const mockMarkRead = jest.fn<Promise<void>, [{ lastReadAt: string }]>();
type ReactArgs = { messageId: string; userId: string; kind?: string };
const mockSetReaction = jest.fn<Promise<void>, [ReactArgs]>();
const mockRemoveReaction = jest.fn<Promise<void>, [ReactArgs]>();
jest.mock('@/features/thread/api', () => ({
  getThread: (id: string) => mockGetThread(id),
  sendMessage: (input: { clientId: string; body: string }) => mockSend(input),
  markThreadRead: (input: { lastReadAt: string }) => mockMarkRead(input),
  setMessageReaction: (input: ReactArgs) => mockSetReaction(input),
  removeMessageReaction: (input: ReactArgs) => mockRemoveReaction(input),
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
  voice: null,
  createdAt: at,
  reactions: [],
});
const THREAD = [
  msg('m1', 'u2', 'Wait, I hum while I cook??', '2026-11-02T21:10:00Z'),
  {
    ...msg('m2', 'u1', 'Every single time.', '2026-11-02T21:11:00Z'),
    reactions: [{ id: 'r1', userId: 'u2', kind: '❤️' }],
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
    // Sam's ❤️ on my message, named for screen readers (D45).
    expect(screen.getByLabelText('Sam reacted with red heart')).toBeTruthy();
    expect(screen.getByTestId('22-reaction-partner')).toHaveTextContent(/❤️/);
    await waitFor(() =>
      expect(mockMarkRead).toHaveBeenCalledWith(
        expect.objectContaining({ lastReadAt: '2026-11-02T21:11:00Z' }),
      ),
    );
  });

  it('D45: long-press a partner message, pick an emoji, replace it, tap mine to remove it', async () => {
    let server = THREAD;
    mockGetThread.mockImplementation(() => Promise.resolve(server));
    mockSetReaction.mockImplementation(({ messageId, userId, kind }) => {
      server = server.map((m) =>
        m.id === messageId ? { ...m, reactions: [{ id: 'r9', userId, kind: kind ?? '' }] } : m,
      );
      return Promise.resolve();
    });
    mockRemoveReaction.mockImplementation(({ messageId }) => {
      server = server.map((m) => (m.id === messageId ? { ...m, reactions: [] } : m));
      return Promise.resolve();
    });
    await renderScreen();
    const theirs = await screen.findByLabelText('Sam, Wait, I hum while I cook??');
    // Screen readers: a custom "React" action with a hint; my own message has none.
    expect(theirs.props.accessibilityActions).toEqual([{ name: 'react', label: 'React' }]);
    expect(theirs.props.accessibilityHint).toBe('Touch and hold to react with an emoji');
    expect(screen.getByLabelText('You, Every single time.').props.accessibilityActions).toBe(
      undefined,
    );
    await fireEvent(theirs, 'longPress');
    expect(await screen.findByTestId('22-picker')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('React with face holding back tears'));
    await waitFor(() =>
      expect(mockSetReaction).toHaveBeenCalledWith({ messageId: 'm1', userId: 'u1', kind: '🥹' }),
    );
    expect(await screen.findByTestId('22-reaction-mine')).toHaveTextContent(/🥹/);
    // Another emoji from the full grid replaces mine (same upsert).
    await fireEvent(
      screen.getByLabelText('Sam, Wait, I hum while I cook??'),
      'accessibilityAction',
      {
        nativeEvent: { actionName: 'react' },
      },
    );
    expect(
      await screen.findByLabelText('face holding back tears, your reaction. Tap to remove'),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('22-picker-search'), 'octopus');
    await fireEvent.press(await screen.findByTestId('22-picker-1F419'));
    await waitFor(() =>
      expect(mockSetReaction).toHaveBeenLastCalledWith({
        messageId: 'm1',
        userId: 'u1',
        kind: '🐙',
      }),
    );
    // Tap my chip: removed (delete own row).
    await fireEvent.press(await screen.findByLabelText('You reacted with octopus. Remove'));
    await waitFor(() =>
      expect(mockRemoveReaction).toHaveBeenCalledWith({ messageId: 'm1', userId: 'u1' }),
    );
    await waitFor(() => expect(screen.queryByTestId('22-reaction-mine')).toBeNull());
  });

  it('D45: INVALID_REACTION rolls back and shows its copy', async () => {
    mockSetReaction.mockRejectedValue(toAppError({ code: 'P0001', message: 'INVALID_REACTION' }));
    await renderScreen();
    await fireEvent(await screen.findByLabelText('Sam, Wait, I hum while I cook??'), 'longPress');
    await fireEvent.press(await screen.findByLabelText('React with fire'));
    await waitFor(() => expect(mockSetReaction).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('22-reaction-mine')).toBeNull());
    expect(useToast.getState().toast).toMatchObject({
      message: "That reaction can't be used. Pick a single emoji instead.",
      tone: 'error',
    });
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
