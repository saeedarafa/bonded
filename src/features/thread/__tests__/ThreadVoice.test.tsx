import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { ThreadMessage } from '@/features/thread/api';
import ThreadScreen from '@/features/thread/screens/ThreadScreen';
import { VOICE_MESSAGE_MAX_BYTES } from '@/features/voice/encoding';
import { AppError, messageFor } from '@/lib/errors';
import { clearOutbox, useOutbox } from '@/lib/outbox';
import { renderUi } from '@/test/render';
import { useToast } from '@/ui';

/** MOB-56: 22 / 22b thread voice messages (D46). */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

// D27: voice is a build switch. Off by default (production), on per test.
let mockShipVoice = true;
jest.mock('@/features/premium/features', () => {
  const actual = jest.requireActual('@/features/premium/features');
  const shipped = { ...actual.SHIPPED };
  Object.defineProperty(shipped, 'voice', { get: () => mockShipVoice, enumerable: true });
  return { ...actual, SHIPPED: shipped };
});

let mockPremium = { status: 'ready' as 'ready' | 'loading', isPremium: true };
jest.mock('@/features/premium/hooks', () => ({
  usePremium: () => ({
    ...mockPremium,
    mine: mockPremium.isPremium,
    partner: false,
    viaPartner: false,
    refetch: jest.fn(),
  }),
}));

type SendInput = {
  clientId: string;
  body: string;
  voice?: { path: string; durationMs: number } | null;
};
const mockGetThread = jest.fn<Promise<ThreadMessage[]>, [string]>();
const mockSend = jest.fn<Promise<void>, [SendInput]>();
jest.mock('@/features/thread/api', () => ({
  getThread: (id: string) => mockGetThread(id),
  sendMessage: (input: SendInput) => mockSend(input),
  markThreadRead: () => Promise.resolve(),
  setMessageReaction: jest.fn(),
  removeMessageReaction: jest.fn(),
}));

const mockUpload = jest.fn<Promise<void>, [Record<string, unknown>]>();
const mockSign = jest.fn<Promise<string>, [string]>();
const mockStart = jest.fn<Promise<string>, []>();
jest.mock('@/features/voice/api', () => ({
  ...jest.requireActual('@/features/voice/api'),
  startVoiceUpload: () => mockStart(),
  uploadVoice: (input: Record<string, unknown>) => mockUpload(input),
  voicePlaybackUrl: (path: string) => mockSign(path),
}));
jest.mock('@/lib/useCoupleRealtime', () => ({
  useCoupleRealtime: () => undefined,
  sendTypingSignal: jest.fn(),
}));
jest.mock('@/features/daily/useTodayContext', () => ({
  useTodayContext: () => ({
    userId: 'u1',
    couple: { data: { id: 'couple-1' } },
    question: { data: { id: 'cq-1', answerCount: 2, question: 'Q?', answers: [] } },
    me: 'Maya',
    partner: 'Sam',
    mine: { userId: 'u1', createdAt: '2026-11-02T20:51:00Z' },
    partnerAnswered: true,
    error: null,
    refetch: jest.fn(),
  }),
}));

type FakeRecorder = { durationMillis: number; record: jest.Mock; uri: string | null };
type FakePlayer = { replace: jest.Mock; play: jest.Mock };
const audio = (
  jest.requireMock('expo-audio') as {
    __audio: { permission: boolean; recorders: FakeRecorder[]; players: FakePlayer[] };
  }
).__audio;
const lastRecorder = () => audio.recorders[audio.recorders.length - 1]!;

const text = (id: string, userId: string, body: string, at: string): ThreadMessage => ({
  id,
  clientId: `c-${id}`,
  userId,
  body,
  voice: null,
  createdAt: at,
  reactions: [],
});
const voice = (id: string, userId: string, ms: number, at: string): ThreadMessage => ({
  ...text(id, userId, 'Voice note', at),
  voice: { path: `couple-1/${userId}/${id}.m4a`, durationMs: ms },
});
// The 22b board: text, my voice (0:18), text, Sam's voice (0:07).
const MIXED = [
  text('m1', 'u2', 'Wait, I hum while I cook??', '2026-11-02T21:10:00Z'),
  voice('m2', 'u1', 18_000, '2026-11-02T21:11:00Z'),
  text('m3', 'u2', 'Okay, tomorrow the coffee is on me.', '2026-11-02T21:12:00Z'),
  voice('m4', 'u2', 7_400, '2026-11-02T21:13:00Z'),
];

let qc: QueryClient;
const renderScreen = (options: { reducedMotion?: boolean } = {}) =>
  renderUi(
    <QueryClientProvider client={qc}>
      <ThreadScreen />
    </QueryClientProvider>,
    options,
  );

beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  mockShipVoice = true;
  mockPremium = { status: 'ready', isPremium: true };
  audio.permission = true;
  audio.recorders.length = 0;
  audio.players.length = 0;
  clearOutbox();
  useToast.getState().hide();
  mockGetThread.mockResolvedValue([]);
  mockSend.mockResolvedValue(undefined);
  mockUpload.mockResolvedValue(undefined);
  mockStart.mockReset();
  mockStart.mockResolvedValue('couple-1/u1/issued-1.m4a');
  mockSign.mockResolvedValue('https://example.test/sign/voice/x?token=t');
});
afterEach(() => qc.clear());

/** Hold the mic (finger at x=300), wait for the recording pill. */
async function holdMic() {
  await fireEvent(screen.getByTestId('22b-mic'), 'pressIn', { nativeEvent: { pageX: 300 } });
  await screen.findByTestId('22b-timer');
  await waitFor(() => expect(lastRecorder().record).toHaveBeenCalled());
}

describe('22 thread voice: build switch and mixed order', () => {
  it('production build (voice not shipped): plain composer, no mic, no note', async () => {
    mockShipVoice = false;
    await renderScreen();
    expect(await screen.findByTestId('22-composer')).toBeTruthy();
    expect(screen.queryByTestId('22b-mic')).toBeNull();
    expect(screen.queryByTestId('22b-mic-premium')).toBeNull();
    expect(screen.queryByTestId('22b-free-note')).toBeNull();
  });

  it('text and voice messages mix in server order; voice plays through a URL signed at the tap', async () => {
    mockGetThread.mockResolvedValue(MIXED);
    await renderScreen();
    await screen.findByText('Wait, I hum while I cook??');
    const order = screen
      .getAllByTestId(/^22-message-sent$/)
      .map((el) =>
        el.props.accessibilityLabel
          ? String(el.props.accessibilityLabel)
          : `voice:${String(
              screen
                .getAllByRole('button')
                .find(
                  (b) =>
                    /^Play voice message/.test(String(b.props.accessibilityLabel)) &&
                    b.props.testID?.startsWith(`22b-voice-`) &&
                    isInside(b, el),
                )?.props.accessibilityLabel,
            )}`,
      );
    expect(order).toEqual([
      'Sam, Wait, I hum while I cook??',
      'voice:Play voice message, 0:18',
      'Sam, Okay, tomorrow the coffee is on me.',
      'voice:Play voice message, 0:07',
    ]);
    // Who sent it, for screen readers.
    expect(screen.getByTestId('22b-voice-c-m2-play').props.accessibilityHint).toBe(
      'Your voice message',
    );
    const theirs = screen.getByTestId('22b-voice-c-m4-play');
    expect(theirs.props.accessibilityHint).toBe('From Sam');
    // The partner's voice message can be reacted to (D45 custom action on the play button).
    expect(theirs.props.accessibilityActions).toEqual([{ name: 'react', label: 'React' }]);
    expect(mockSign).not.toHaveBeenCalled();
    await fireEvent.press(theirs);
    expect(mockSign).toHaveBeenCalledWith('couple-1/u2/m4.m4a');
    const player = audio.players.find((p) => p.replace.mock.calls.length > 0)!;
    expect(player.play).toHaveBeenCalled();
    // The signed URL is kept nowhere (not in the query cache).
    const cached = qc
      .getQueryCache()
      .getAll()
      .map((q) => q.state.data);
    expect(JSON.stringify(cached)).not.toContain('token=t');
    expect(JSON.stringify(useOutbox.getState().items)).not.toContain('token=t');
  });
});

/** True if `child` is `parent` or below it in the rendered tree. */
function isInside(child: { parent: unknown }, parent: unknown): boolean {
  let node: { parent: unknown } | null = child;
  while (node) {
    if (node === parent) return true;
    node = node.parent as { parent: unknown } | null;
  }
  return false;
}

describe('22b free couple: listen only', () => {
  it('says voice is Premium, the mic opens the paywall, and voice messages still play', async () => {
    mockPremium = { status: 'ready', isPremium: false };
    mockGetThread.mockResolvedValue(MIXED);
    await renderScreen();
    expect(await screen.findByTestId('22b-free-note')).toHaveTextContent(
      'Voice messages are for Premium couples. Anyone can listen.',
    );
    // #356: the note stops at 200% so the messages keep room at AX5.
    expect(screen.getByTestId('22b-free-note').props.maxFontSizeMultiplier).toBe(2);
    const mic = screen.getByTestId('22b-mic-premium');
    expect(mic.props.accessibilityLabel).toBe('Record voice message, Premium');
    expect(screen.queryByTestId('22b-mic')).toBeNull();
    await fireEvent.press(mic);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/paywall',
      params: { from: 'voice' },
    });
    expect(audio.recorders.some((r) => r.record.mock.calls.length > 0)).toBe(false);
    // Listening is free.
    await fireEvent.press(screen.getByTestId('22b-voice-c-m4-play'));
    expect(mockSign).toHaveBeenCalledWith('couple-1/u2/m4.m4a');
  });

  it('while Premium is loading: text only, no mic and no note', async () => {
    mockPremium = { status: 'loading', isPremium: false };
    await renderScreen();
    expect(await screen.findByTestId('22-composer')).toBeTruthy();
    expect(screen.queryByTestId('22b-mic')).toBeNull();
    expect(screen.queryByTestId('22b-free-note')).toBeNull();
  });
});

describe('22b hold to record (Premium)', () => {
  it('hold, let go: records up to 60 s, shows it at once, uploads to the issued name, sends', async () => {
    let resolveSend: () => void = () => undefined;
    mockSend.mockImplementation(() => new Promise<void>((r) => (resolveSend = r)));
    await renderScreen();
    await screen.findByTestId('22-empty');
    const mic = screen.getByTestId('22b-mic');
    expect(mic.props.accessibilityLabel).toBe('Record voice message');
    await holdMic();
    // 60 s cap (D46): the native limit is a 1 s backstop over the app's own stop.
    expect(lastRecorder().record).toHaveBeenCalledWith({ forDuration: 61 });
    expect(screen.getByTestId('22b-slide-to-cancel')).toHaveTextContent('Slide to cancel');
    expect(screen.getByTestId('22b-mic').props.accessibilityLabel).toBe('Send voice message');
    lastRecorder().durationMillis = 18_000;
    await fireEvent(screen.getByTestId('22b-mic'), 'pressOut');

    // Optimistic: my voice bubble at once, as sending.
    const play = await screen.findByLabelText('Play voice message, 0:18');
    expect(play.props.accessibilityHint).toBe('Your voice message, Sending');
    expect(screen.getByTestId('22-message-sending')).toBeTruthy();
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledWith({
      path: 'couple-1/u1/issued-1.m4a',
      fileUri: lastRecorder().uri,
      maxBytes: VOICE_MESSAGE_MAX_BYTES,
    });
    const sent = mockSend.mock.calls[0]![0];
    expect(sent.voice).toEqual({ path: 'couple-1/u1/issued-1.m4a', durationMs: 18_000 });
    expect(sent.clientId).toEqual(expect.any(String));
    // The recorder is back to the mic, the text composer is there again.
    expect(screen.queryByTestId('22b-timer')).toBeNull();
    expect(screen.getByTestId('22-composer')).toBeTruthy();

    mockGetThread.mockResolvedValue([
      { ...voice('m9', 'u1', 18_000, '2026-11-02T21:20:00Z'), clientId: sent.clientId },
    ]);
    await act(async () => resolveSend());
    await waitFor(() => expect(useOutbox.getState().items).toEqual({}));
    expect(screen.getByTestId('22-message-sent')).toBeTruthy();
    expect(screen.getAllByLabelText('Play voice message, 0:18')).toHaveLength(1);
  });

  it('slide left to cancel: nothing is recorded, uploaded or sent', async () => {
    await renderScreen();
    await screen.findByTestId('22-empty');
    await holdMic();
    lastRecorder().durationMillis = 4_000;
    // A small wobble keeps recording; a slide of 80 pt to the left cancels.
    await fireEvent(screen.getByTestId('22b-mic'), 'touchMove', { nativeEvent: { pageX: 260 } });
    expect(screen.getByTestId('22b-timer')).toBeTruthy();
    await fireEvent(screen.getByTestId('22b-mic'), 'touchMove', { nativeEvent: { pageX: 200 } });
    await waitFor(() => expect(screen.queryByTestId('22b-timer')).toBeNull());
    await fireEvent(screen.getByTestId('22b-mic'), 'pressOut');
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(useOutbox.getState().items).toEqual({});
    expect(screen.queryByTestId('22-message-sending')).toBeNull();
  });

  it('a quick tap is not a recording: it says to hold', async () => {
    await renderScreen();
    await screen.findByTestId('22-empty');
    await holdMic();
    lastRecorder().durationMillis = 200;
    await fireEvent(screen.getByTestId('22b-mic'), 'pressOut');
    expect(await screen.findByTestId('22b-hold-hint')).toHaveTextContent(
      'Hold to record. Let go to send.',
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('microphone refused: says how to turn it on, records nothing', async () => {
    audio.permission = false;
    await renderScreen();
    await screen.findByTestId('22-empty');
    await fireEvent(screen.getByTestId('22b-mic'), 'pressIn', { nativeEvent: { pageX: 300 } });
    expect(await screen.findByTestId('22b-mic-denied')).toBeTruthy();
    await fireEvent(screen.getByTestId('22b-mic'), 'pressOut');
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.queryByTestId('22b-hold-hint')).toBeNull();
  });

  it('reduced motion / screen reader: tap to record, Cancel, then tap Send', async () => {
    await renderScreen({ reducedMotion: true });
    await screen.findByTestId('22-empty');
    expect(screen.getByTestId('22b-mic').props.accessibilityHint).toBe(
      'Record voice message, up to 60 seconds',
    );
    await fireEvent.press(screen.getByTestId('22b-mic'));
    await screen.findByTestId('22b-cancel');
    expect(screen.queryByTestId('22b-slide-to-cancel')).toBeNull();
    await fireEvent.press(screen.getByTestId('22b-cancel'));
    await waitFor(() => expect(screen.queryByTestId('22b-timer')).toBeNull());

    await fireEvent.press(screen.getByTestId('22b-mic'));
    await screen.findByTestId('22b-cancel');
    lastRecorder().durationMillis = 7_000;
    expect(screen.getByTestId('22b-mic').props.accessibilityLabel).toBe('Send voice message');
    await fireEvent.press(screen.getByTestId('22b-mic'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend.mock.calls[0]![0].voice).toEqual({
      path: 'couple-1/u1/issued-1.m4a',
      durationMs: 7_000,
    });
  });

  it('typed text survives a voice message', async () => {
    await renderScreen();
    await screen.findByTestId('22-empty');
    await fireEvent.changeText(screen.getByTestId('22-composer'), 'Deal.');
    await holdMic();
    lastRecorder().durationMillis = 3_000;
    await fireEvent(screen.getByTestId('22b-mic'), 'pressOut');
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('22-composer').props.value).toBe('Deal.');
  });
});

describe('22b failures and retry (same client_id, as MOB-12)', () => {
  it('a dropped row write keeps the upload: retry sends the same client_id without a new name', async () => {
    mockSend.mockRejectedValueOnce(new AppError('NETWORK', messageFor('NETWORK')));
    await renderScreen();
    await screen.findByTestId('22-empty');
    await holdMic();
    lastRecorder().durationMillis = 9_000;
    await fireEvent(screen.getByTestId('22b-mic'), 'pressOut');
    await screen.findByTestId('22-message-failed');
    // A network drop needs no toast (the bubble says "Not sent").
    expect(useToast.getState().toast).toBeNull();
    const firstId = mockSend.mock.calls[0]![0].clientId;
    await fireEvent.press(screen.getByLabelText('Not sent. Tap to retry'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    expect(mockSend.mock.calls[1]![0].clientId).toBe(firstId);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it("the couple's daily limit: not sent, and the reason is shown", async () => {
    mockStart.mockRejectedValue(new AppError('VOICE_LIMIT', messageFor('VOICE_LIMIT')));
    await renderScreen();
    await screen.findByTestId('22-empty');
    await holdMic();
    lastRecorder().durationMillis = 5_000;
    await fireEvent(screen.getByTestId('22b-mic'), 'pressOut');
    await screen.findByTestId('22-message-failed');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    await waitFor(() => expect(useToast.getState().toast?.message).toBe(messageFor('VOICE_LIMIT')));
  });

  it('INVALID_VOICE: the retry asks for a fresh name and uploads again', async () => {
    mockSend.mockRejectedValueOnce(new AppError('INVALID_VOICE', messageFor('INVALID_VOICE')));
    mockStart
      .mockResolvedValueOnce('couple-1/u1/issued-1.m4a')
      .mockResolvedValueOnce('couple-1/u1/issued-2.m4a');
    await renderScreen();
    await screen.findByTestId('22-empty');
    await holdMic();
    lastRecorder().durationMillis = 5_000;
    await fireEvent(screen.getByTestId('22b-mic'), 'pressOut');
    await screen.findByTestId('22-message-failed');
    await fireEvent.press(screen.getByLabelText('Not sent. Tap to retry'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1]![0].voice?.path).toBe('couple-1/u1/issued-2.m4a');
  });
});
