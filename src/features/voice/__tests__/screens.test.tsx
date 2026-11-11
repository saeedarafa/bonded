import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { RevealedQuestion } from '@/features/daily/api';
import AnswerScreen from '@/features/daily/screens/AnswerScreen';
import RevealedScreen from '@/features/daily/screens/RevealedScreen';
import { useDrafts } from '@/lib/drafts';
import { AppError, messageFor } from '@/lib/errors';
import { clearOutbox } from '@/lib/outbox';
import { renderUi } from '@/test/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
}));

// D27: voice is a build switch. Off by default (production), on per test.
let mockShipVoice = true;
jest.mock('@/features/premium/features', () => {
  const actual = jest.requireActual('@/features/premium/features');
  const shipped = { ...actual.SHIPPED };
  Object.defineProperty(shipped, 'voice', { get: () => mockShipVoice, enumerable: true });
  return { ...actual, SHIPPED: shipped };
});

const mockGetRevealed = jest.fn<Promise<RevealedQuestion>, [string]>();
const mockSaveAnswer = jest.fn<Promise<void>, [Record<string, unknown>]>();
jest.mock('@/features/daily/api', () => ({
  getRevealedQuestion: (id: string) => mockGetRevealed(id),
  saveAnswer: (input: Record<string, unknown>) => mockSaveAnswer(input),
  setAnswerReaction: jest.fn(),
  removeAnswerReaction: jest.fn(),
  getStreak: () => Promise.resolve(null),
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
jest.mock('@/lib/useCoupleRealtime', () => ({ useCoupleRealtime: () => undefined }));

let mockPremium = { status: 'ready' as 'ready' | 'loading', isPremium: true };
const mockPremiumRefetch = jest.fn();
jest.mock('@/features/premium/hooks', () => ({
  ...jest.requireActual('@/features/premium/hooks'),
  usePremium: () => ({
    ...mockPremium,
    mine: mockPremium.isPremium,
    partner: false,
    viaPartner: false,
    refetch: mockPremiumRefetch,
  }),
}));

let mockMine = false;
jest.mock('@/features/daily/useTodayContext', () => ({
  useTodayContext: () => ({
    userId: 'u1',
    couple: { data: { id: 'couple-1' } },
    question: {
      data: {
        id: 'cq-1',
        answerCount: mockMine ? 2 : 1,
        question: "What's a small thing I do that makes your day better?",
        answers: mockMine ? [{ userId: 'u1', createdAt: '2026-11-02T20:51:00Z' }] : [],
      },
    },
    me: 'Maya',
    partner: 'Sam',
    mine: mockMine ? { userId: 'u1', createdAt: '2026-11-02T20:51:00Z' } : null,
    partnerAnswered: true,
    error: null,
    refetch: jest.fn(),
  }),
}));

type FakeRecorder = { durationMillis: number };
type FakePlayer = { replace: jest.Mock; play: jest.Mock };
const audio = (
  jest.requireMock('expo-audio') as {
    __audio: { permission: boolean; recorders: FakeRecorder[]; players: FakePlayer[] };
  }
).__audio;

let qc: QueryClient;
function renderScreen(ui: ReactElement) {
  return renderUi(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  mockShipVoice = true;
  mockMine = false;
  mockPremium = { status: 'ready', isPremium: true };
  audio.permission = true;
  audio.recorders.length = 0;
  audio.players.length = 0;
  useDrafts.getState().reset();
  clearOutbox();
  onlineManager.setOnline(true);
  mockSaveAnswer.mockResolvedValue(undefined);
  mockUpload.mockResolvedValue(undefined);
  mockStart.mockReset();
  mockStart.mockResolvedValue('couple-1/u1/0b5c9a52-issued.m4a');
  mockSign.mockResolvedValue('https://example.test/sign/voice/x?token=t');
});
afterEach(() => qc.clear());

async function recordTake(ms: number) {
  await fireEvent.press(screen.getByTestId('19-tab-voice'));
  await fireEvent.press(screen.getByTestId('19c-record'));
  await screen.findByTestId('19c-stop');
  audio.recorders[audio.recorders.length - 1]!.durationMillis = ms;
  await fireEvent.press(screen.getByTestId('19c-stop'));
  await screen.findByTestId('19c-preview');
}

describe('19 Write | Voice switch (D46, MOB-54)', () => {
  it('production build (voice not shipped): no switch, plain 19', async () => {
    mockShipVoice = false;
    await renderScreen(<AnswerScreen />);
    expect(screen.getByTestId('19-field')).toBeTruthy();
    expect(screen.queryByTestId('19-switch')).toBeNull();
    expect(screen.queryByTestId('19-tab-voice')).toBeNull();
  });

  it('free: the Voice tab carries the word "Premium" and opens the paywall', async () => {
    mockPremium = { status: 'ready', isPremium: false };
    await renderScreen(<AnswerScreen />);
    const tab = screen.getByTestId('19-tab-voice');
    expect(tab.props.accessibilityLabel).toBe('Voice answer, Premium');
    expect(screen.getByTestId('19-voice-premium')).toBeTruthy();
    expect(screen.getByText('Premium')).toBeTruthy();
    await fireEvent.press(tab);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/paywall',
      params: { from: 'voice' },
    });
    // Still writing: no recorder for a free couple.
    expect(screen.getByTestId('19-field')).toBeTruthy();
    expect(screen.queryByTestId('19c-card')).toBeNull();
  });

  it('Premium: plain tabs (no label), write by default, voice shows the 19c recorder', async () => {
    await renderScreen(<AnswerScreen />);
    expect(screen.queryByTestId('19-voice-premium')).toBeNull();
    expect(screen.getByTestId('19-tab-write').props.accessibilityState).toEqual({
      selected: true,
    });
    // 19b: the counter is out of 2000.
    expect(screen.getByTestId('19-field-counter')).toHaveTextContent('0 / 2000');
    await fireEvent.press(screen.getByTestId('19-tab-voice'));
    expect(screen.getByTestId('19c-card')).toBeTruthy();
    expect(screen.queryByTestId('19-field')).toBeNull();
    expect(screen.getByTestId('19-private')).toBeTruthy();
  });
});

describe('19c record a voice answer (MOB-55)', () => {
  it('record, stop, then lock in: queued as a voice answer, uploaded, then saved', async () => {
    await renderScreen(<AnswerScreen />);
    await recordTake(42_000);
    expect(screen.getByTestId('19c-preview-play').props.accessibilityLabel).toBe(
      'Play voice answer, 0:42',
    );
    expect(screen.getByTestId('19c-record-again')).toBeTruthy();
    expect(screen.getByTestId('19c-delete').props.accessibilityLabel).toBe('Delete voice answer');
    await fireEvent.press(screen.getByTestId('19-submit'));
    await waitFor(() => expect(mockSaveAnswer).toHaveBeenCalled());
    // BE-43: the name comes from start_voice_upload, never made up on the phone.
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledWith({
      path: 'couple-1/u1/0b5c9a52-issued.m4a',
      fileUri: expect.stringMatching(/\.m4a$/),
    });
    expect(mockSaveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        coupleQuestionId: 'cq-1',
        body: '',
        voice: { path: 'couple-1/u1/0b5c9a52-issued.m4a', durationMs: 42_000 },
      }),
    );
    // The partner has answered: on to 20.
    expect(mockRouter.replace).toHaveBeenCalledWith('/today/reveal');
  });

  it('text answers clear voice (text XOR voice): Write sends no voice', async () => {
    await renderScreen(<AnswerScreen />);
    await recordTake(5_000);
    await fireEvent.press(screen.getByTestId('19-tab-write'));
    await fireEvent.changeText(screen.getByTestId('19-field'), 'Your laugh.');
    await fireEvent.press(screen.getByTestId('19-submit'));
    await waitFor(() => expect(mockSaveAnswer).toHaveBeenCalled());
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSaveAnswer.mock.calls[0]?.[0]).toMatchObject({ body: 'Your laugh.', voice: null });
  });

  it('lock in without a recording asks for one', async () => {
    await renderScreen(<AnswerScreen />);
    await fireEvent.press(screen.getByTestId('19-tab-voice'));
    await fireEvent.press(screen.getByTestId('19-submit'));
    expect(screen.getByTestId('19c-missing')).toHaveTextContent(
      'Record your answer first, or switch to Write.',
    );
    expect(mockSaveAnswer).not.toHaveBeenCalled();
  });

  it('microphone refused: the explanation and a way to Settings, nothing recorded', async () => {
    audio.permission = false;
    await renderScreen(<AnswerScreen />);
    await fireEvent.press(screen.getByTestId('19-tab-voice'));
    await fireEvent.press(screen.getByTestId('19c-record'));
    expect(await screen.findByTestId('19c-mic-denied')).toBeTruthy();
    expect(screen.getByTestId('19c-open-settings')).toBeTruthy();
    expect(screen.queryByTestId('19c-stop')).toBeNull();
  });

  it('Storage refuses the upload (not Premium): the voice error shows and Premium is re-read', async () => {
    mockUpload.mockRejectedValue(new AppError('VOICE_DENIED', messageFor('VOICE_DENIED')));
    await renderScreen(<AnswerScreen />);
    await recordTake(8_000);
    await fireEvent.press(screen.getByTestId('19-submit'));
    expect(await screen.findByTestId('19-error')).toBeTruthy();
    expect(screen.getByText(messageFor('VOICE_DENIED'))).toBeTruthy();
    expect(mockPremiumRefetch).toHaveBeenCalled();
    expect(mockSaveAnswer).not.toHaveBeenCalled();
    // The take is still there to try again.
    expect(screen.getByTestId('19c-preview')).toBeTruthy();
  });

  it('VOICE_LIMIT (20 a day): a clear message before any upload, the take stays', async () => {
    mockStart.mockRejectedValue(new AppError('VOICE_LIMIT', messageFor('VOICE_LIMIT')));
    await renderScreen(<AnswerScreen />);
    await recordTake(8_000);
    await fireEvent.press(screen.getByTestId('19-submit'));
    expect(await screen.findByTestId('19-error')).toBeTruthy();
    expect(screen.getByText(messageFor('VOICE_LIMIT'))).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSaveAnswer).not.toHaveBeenCalled();
    expect(screen.getByTestId('19c-preview')).toBeTruthy();
  });

  it('VOICE_TOO_LONG from the answer write names the limit', async () => {
    mockSaveAnswer.mockRejectedValue(
      new AppError('VOICE_TOO_LONG', messageFor('VOICE_TOO_LONG', { max: 90 }), 90),
    );
    await renderScreen(<AnswerScreen />);
    await recordTake(8_000);
    await fireEvent.press(screen.getByTestId('19-submit'));
    expect(await screen.findByText(/longer than 90 seconds/)).toBeTruthy();
  });

  it('PREMIUM_REQUIRED from the answer write is mapped', async () => {
    mockSaveAnswer.mockRejectedValue(
      new AppError('PREMIUM_REQUIRED', messageFor('PREMIUM_REQUIRED')),
    );
    await renderScreen(<AnswerScreen />);
    await recordTake(8_000);
    await fireEvent.press(screen.getByTestId('19-submit'));
    expect(await screen.findByText(messageFor('PREMIUM_REQUIRED'))).toBeTruthy();
    expect(mockPremiumRefetch).toHaveBeenCalled();
  });

  it('offline: the voice answer waits on the phone (55) and nothing is uploaded', async () => {
    onlineManager.setOnline(false);
    await renderScreen(<AnswerScreen />);
    await recordTake(8_000);
    await fireEvent.press(screen.getByTestId('19-submit'));
    expect(await screen.findByTestId('55-queued')).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();
    onlineManager.setOnline(true);
  });
});

const VOICE_REVEALED: RevealedQuestion = {
  id: 'cq-1',
  answerCount: 2,
  question: 'Q',
  answers: [
    {
      id: 'a2',
      userId: 'u2',
      body: 'Voice note',
      voice: { path: 'couple-1/u2/a.m4a', durationMs: 18_000 },
      createdAt: '2026-11-02T21:04:00Z',
      reactions: [],
    },
    {
      id: 'a1',
      userId: 'u1',
      body: 'My text.',
      voice: null,
      createdAt: '2026-11-02T20:51:00Z',
      reactions: [],
    },
  ],
};

describe('21 voice playback (reveal rule)', () => {
  it("before I've answered: no answer read, no URL signed, no player", async () => {
    mockMine = false;
    mockGetRevealed.mockResolvedValue(VOICE_REVEALED);
    await renderScreen(<RevealedScreen />);
    expect(await screen.findByTestId('21-not-ready')).toBeTruthy();
    expect(mockGetRevealed).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
    expect(screen.queryByTestId('21-partner-voice')).toBeNull();
  });

  it('after reveal: plays the partner voice answer through a URL signed at the tap', async () => {
    mockMine = true;
    mockPremium = { status: 'ready', isPremium: false }; // free couples can listen
    mockGetRevealed.mockResolvedValue(VOICE_REVEALED);
    await renderScreen(<RevealedScreen />);
    const play = await screen.findByTestId('21-partner-voice-play');
    expect(play.props.accessibilityLabel).toBe('Play voice answer, 0:18');
    // My text answer still reads as text.
    expect(screen.getByText('My text.')).toBeTruthy();
    expect(mockSign).not.toHaveBeenCalled();
    await fireEvent.press(play);
    expect(mockSign).toHaveBeenCalledWith('couple-1/u2/a.m4a');
    const player = audio.players.find((p) => p.replace.mock.calls.length > 0)!;
    expect(player.replace).toHaveBeenCalledWith({
      uri: 'https://example.test/sign/voice/x?token=t',
    });
    expect(player.play).toHaveBeenCalled();
    // The URL lives nowhere else: not in the query cache.
    expect(
      JSON.stringify(
        qc
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain('token=t');
  });

  it('a playback failure shows a neutral message', async () => {
    mockMine = true;
    mockGetRevealed.mockResolvedValue(VOICE_REVEALED);
    mockSign.mockRejectedValue(new AppError('UNKNOWN', messageFor('UNKNOWN')));
    await renderScreen(<RevealedScreen />);
    await fireEvent.press(await screen.findByTestId('21-partner-voice-play'));
    expect(await screen.findByTestId('21-partner-voice-error')).toHaveTextContent(
      "That voice note didn't play. Try again.",
    );
  });
});
