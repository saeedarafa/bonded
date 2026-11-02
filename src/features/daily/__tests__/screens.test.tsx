import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import type { ReactElement } from 'react';

import type { RevealedQuestion } from '@/features/daily/api';
import AnswerScreen from '@/features/daily/screens/AnswerScreen';
import RevealedScreen from '@/features/daily/screens/RevealedScreen';
import RevealScreen from '@/features/daily/screens/RevealScreen';
import { useDrafts } from '@/lib/drafts';
import { queryKeys } from '@/lib/queryKeys';
import { renderUi } from '@/test/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const mockGetRevealed = jest.fn<Promise<RevealedQuestion>, [string]>();
const mockSaveAnswer = jest.fn<Promise<void>, [Record<string, unknown>]>();
const mockSetReaction = jest.fn<Promise<void>, [Record<string, unknown>]>();
const mockRemoveReaction = jest.fn<Promise<void>, [Record<string, unknown>]>();
jest.mock('@/features/daily/api', () => ({
  getRevealedQuestion: (id: string) => mockGetRevealed(id),
  saveAnswer: (input: Record<string, unknown>) => mockSaveAnswer(input),
  setAnswerReaction: (input: Record<string, unknown>) => mockSetReaction(input),
  removeAnswerReaction: (input: Record<string, unknown>) => mockRemoveReaction(input),
  getStreak: () =>
    Promise.resolve({
      current: 12,
      longest: 12,
      last_completed_on: '2026-11-02',
      completed_today: true,
      at_risk: false,
      saver_available: false,
    }),
}));
jest.mock('@/lib/useCoupleRealtime', () => ({ useCoupleRealtime: () => undefined }));

// Who has answered comes from ids and `answer_count` only (no text): controlled here.
type Ctx = { mine: boolean; partnerAnswered: boolean };
let mockCtx: Ctx = { mine: false, partnerAnswered: true };
jest.mock('@/features/daily/useTodayContext', () => ({
  useTodayContext: () => ({
    userId: 'u1',
    couple: { data: { id: 'couple-1' } },
    question: {
      data: {
        id: 'cq-1',
        answerCount: (mockCtx.mine ? 1 : 0) + (mockCtx.partnerAnswered ? 1 : 0),
        question: "What's a small thing I do that makes your day better?",
        answers: mockCtx.mine ? [{ userId: 'u1', createdAt: '2026-11-02T20:51:00Z' }] : [],
      },
    },
    me: 'Maya',
    partner: 'Sam',
    mine: mockCtx.mine ? { userId: 'u1', createdAt: '2026-11-02T20:51:00Z' } : null,
    partnerAnswered: mockCtx.partnerAnswered,
    error: null,
    refetch: jest.fn(),
  }),
}));

const PARTNER_TEXT = 'When you hum while cooking.';
const MY_TEXT = 'When you leave the coffee ready.';
const REVEALED: RevealedQuestion = {
  id: 'cq-1',
  answerCount: 2,
  question: "What's a small thing I do that makes your day better?",
  answers: [
    {
      id: 'a2',
      userId: 'u2',
      body: PARTNER_TEXT,
      createdAt: '2026-11-02T21:04:00Z',
      reactions: [],
    },
    {
      id: 'a1',
      userId: 'u1',
      body: MY_TEXT,
      createdAt: '2026-11-02T20:51:00Z',
      reactions: [{ id: 'r1', userId: 'u2', kind: 'love' }],
    },
  ],
};

let qc: QueryClient;
function renderScreen(ui: ReactElement, options?: { reducedMotion?: boolean }) {
  return renderUi(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>, options);
}

beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  mockParams = {};
  mockCtx = { mine: false, partnerAnswered: true };
  useDrafts.getState().reset();
  mockGetRevealed.mockResolvedValue(REVEALED);
  mockSaveAnswer.mockResolvedValue(undefined);
  mockSetReaction.mockResolvedValue(undefined);
  mockRemoveReaction.mockResolvedValue(undefined);
});
afterEach(() => qc.clear());

describe('the reveal rule, end to end in the app (release blocker)', () => {
  it("21 never asks for answer text before I've answered", async () => {
    await renderScreen(<RevealedScreen />);
    expect(await screen.findByTestId('21-not-ready')).toBeTruthy();
    expect(mockGetRevealed).not.toHaveBeenCalled();
    expect(screen.queryByText(PARTNER_TEXT)).toBeNull();
    // Nothing cached either: the detail query never ran.
    expect(qc.getQueryData(queryKeys.questions.detail('cq-1'))).toBeUndefined();
    expect(qc.getQueryState(queryKeys.questions.detail('cq-1'))?.fetchStatus).toBe('idle');
  });

  it('20 never reads answer text, even once both have answered', async () => {
    mockCtx = { mine: true, partnerAnswered: true };
    await renderScreen(<RevealScreen />);
    expect(screen.getByTestId('20-sealed')).toBeTruthy();
    expect(screen.getByLabelText("Sam's answer, closed until you reveal it")).toBeTruthy();
    expect(mockGetRevealed).not.toHaveBeenCalled();
    expect(screen.queryByText(PARTNER_TEXT)).toBeNull();
  });

  it('19 (writing my answer) never asks for answer text', async () => {
    await renderScreen(<AnswerScreen />);
    expect(screen.getByTestId('19-screen')).toBeTruthy();
    expect(mockGetRevealed).not.toHaveBeenCalled();
  });

  it('21 fetches both answers only once mine exists, and shows what RLS returned', async () => {
    mockCtx = { mine: true, partnerAnswered: true };
    await renderScreen(<RevealedScreen />);
    expect(await screen.findByText(PARTNER_TEXT)).toBeTruthy();
    expect(screen.getByText(MY_TEXT)).toBeTruthy();
    expect(mockGetRevealed).toHaveBeenCalledWith('cq-1');
  });

  it("21 with my answer but the partner's row absent (RLS) shows nothing to reveal", async () => {
    mockCtx = { mine: true, partnerAnswered: true };
    mockGetRevealed.mockResolvedValue({ ...REVEALED, answers: [REVEALED.answers[1]!] });
    await renderScreen(<RevealedScreen />);
    expect(await screen.findByTestId('21-not-ready')).toBeTruthy();
    expect(screen.queryByText(PARTNER_TEXT)).toBeNull();
  });
});

describe('19 Write your answer', () => {
  it('keeps the draft, says what is missing, and always shows the privacy line', async () => {
    await renderScreen(<AnswerScreen />);
    expect(screen.getByText('Private until you both answer')).toBeTruthy();
    expect(
      screen.getByText("Sam has answered. You'll see theirs the moment you lock yours in."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('19-submit'));
    expect(screen.getByTestId('19-field-error')).toHaveTextContent(
      'Write a few words first. Your answer can be short.',
    );
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
    expect(mockSaveAnswer).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('19-field'), 'Your laugh.');
    expect(useDrafts.getState().drafts).toEqual({ 'cq-1': 'Your laugh.' });
    expect(screen.queryByTestId('19-field-error')).toBeNull();
  });

  it('locks in, deletes the draft and goes to hold to reveal when the partner answered', async () => {
    useDrafts.getState().setDraft('cq-1', '  Your laugh.  ');
    await renderScreen(<AnswerScreen />);
    await fireEvent.press(screen.getByTestId('19-submit'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today/reveal'));
    expect(mockSaveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ coupleQuestionId: 'cq-1', userId: 'u1', body: 'Your laugh.' }),
    );
    expect(useDrafts.getState().drafts).toEqual({});
  });

  it('goes back to Today (waiting) when the partner has not answered', async () => {
    mockCtx = { mine: false, partnerAnswered: false };
    useDrafts.getState().setDraft('cq-1', 'Your laugh.');
    await renderScreen(<AnswerScreen />);
    expect(screen.queryByTestId('19-partner-answered')).toBeNull();
    await fireEvent.press(screen.getByTestId('19-submit'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('keeps the draft and shows the mapped error when the save fails', async () => {
    mockSaveAnswer.mockRejectedValue(
      Object.assign(new Error("You're offline."), { name: 'AppError', kind: 'NETWORK' }),
    );
    useDrafts.getState().setDraft('cq-1', 'Your laugh.');
    await renderScreen(<AnswerScreen />);
    await fireEvent.press(screen.getByTestId('19-submit'));
    expect(await screen.findByTestId('19-error')).toBeTruthy();
    expect(useDrafts.getState().drafts).toEqual({ 'cq-1': 'Your laugh.' });
  });

  it("J7: the joiner's first question reveals the partner's answer at once", async () => {
    mockParams = { first: '1' };
    useDrafts.getState().setDraft('cq-1', 'Your laugh.');
    await renderScreen(<AnswerScreen />);
    expect(screen.getByTestId('J7-screen')).toBeTruthy();
    expect(
      screen.getByText("Sam's answer is waiting. Answer and you'll see theirs right away."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText("Lock in and reveal Sam's"));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today/revealed'));
    expect(useDrafts.getState().revealed).toEqual(['cq-1']);
  });
});

describe('20 Hold to reveal', () => {
  it('ticks while holding, then success, remembers the reveal and opens 21', async () => {
    jest.useFakeTimers();
    try {
      mockCtx = { mine: true, partnerAnswered: true };
      await renderScreen(<RevealScreen />);
      await fireEvent(screen.getByTestId('20-hold'), 'pressIn');
      await act(() => jest.advanceTimersByTime(1200));
      expect(Haptics.selectionAsync).toHaveBeenCalledTimes(3);
      expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
      expect(useDrafts.getState().revealed).toEqual(['cq-1']);
      expect(mockRouter.replace).toHaveBeenCalledWith('/today/revealed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reduced motion: tap, then a confirming tap', async () => {
    mockCtx = { mine: true, partnerAnswered: true };
    await renderScreen(<RevealScreen />, { reducedMotion: true });
    await fireEvent.press(screen.getByLabelText('Tap to reveal'));
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Tap again to reveal'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/today/revealed');
  });

  it("asks me to answer first when I haven't", async () => {
    await renderScreen(<RevealScreen />);
    await fireEvent.press(screen.getByTestId('20-not-ready-cta'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/today/answer');
  });
});

describe('21 Revealed + reactions', () => {
  it("shows the partner's reaction on mine and toggles my reaction on theirs", async () => {
    mockCtx = { mine: true, partnerAnswered: true };
    // A tiny server: reactions persist between refetches.
    let server = REVEALED;
    mockGetRevealed.mockImplementation(() => Promise.resolve(server));
    mockSetReaction.mockImplementation(({ kind }) => {
      const [theirs, mine] = REVEALED.answers;
      server = {
        ...REVEALED,
        answers: [
          { ...theirs!, reactions: [{ id: 'r2', userId: 'u1', kind: kind as 'spark' }] },
          mine!,
        ],
      };
      return Promise.resolve();
    });
    mockRemoveReaction.mockImplementation(() => {
      server = REVEALED;
      return Promise.resolve();
    });
    await renderScreen(<RevealedScreen />);
    expect(await screen.findByText('Sam loved this')).toBeTruthy();
    expect(await screen.findByLabelText('12-day streak, bonded today')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('21-react-spark'));
    expect(mockSetReaction).toHaveBeenCalledWith({ answerId: 'a2', userId: 'u1', kind: 'spark' });
    expect(await screen.findByLabelText('Spark, 1, selected')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('21-react-spark'));
    await waitFor(() =>
      expect(mockRemoveReaction).toHaveBeenCalledWith({ answerId: 'a2', userId: 'u1' }),
    );
    expect(await screen.findByLabelText('Spark')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('21-talk'));
    expect(mockRouter.push).toHaveBeenCalledWith('/today/thread');
  });
});
