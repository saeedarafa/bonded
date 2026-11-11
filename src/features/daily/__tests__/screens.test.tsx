import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';

import type { RevealedQuestion } from '@/features/daily/api';
import AnswerScreen from '@/features/daily/screens/AnswerScreen';
import RevealedScreen from '@/features/daily/screens/RevealedScreen';
import RevealScreen from '@/features/daily/screens/RevealScreen';
import { useDrafts } from '@/lib/drafts';
import { AppError } from '@/lib/errors';
import { clearOutbox, useOutbox } from '@/lib/outbox';
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

// Premium as the server sees it (D46: the answer cap is 500 free, 2000 Premium).
let mockPremium: { status: 'loading' | 'error' | 'ready'; isPremium: boolean } = {
  status: 'ready',
  isPremium: false,
};
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
      reactions: [{ id: 'r1', userId: 'u2', kind: '❤️' }],
    },
  ],
};

let qc: QueryClient;
function renderScreen(ui: ReactElement, options?: { reducedMotion?: boolean; cramped?: boolean }) {
  return renderUi(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>, options);
}

beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  mockParams = {};
  mockCtx = { mine: false, partnerAnswered: true };
  mockPremium = { status: 'ready', isPremium: false };
  useDrafts.getState().reset();
  clearOutbox();
  onlineManager.setOnline(true);
  mockGetRevealed.mockResolvedValue(REVEALED);
  mockSaveAnswer.mockResolvedValue(undefined);
  mockSetReaction.mockResolvedValue(undefined);
  mockRemoveReaction.mockResolvedValue(undefined);
});
afterEach(() => {
  onlineManager.setOnline(true);
  qc.clear();
});

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
    mockSaveAnswer.mockRejectedValue(new AppError('NOT_PAIRED', 'not paired'));
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

describe('19 answer length (D46, BE-41)', () => {
  const chars = (n: number) => 'a'.repeat(n);

  it('caps a free couple at 500, with the counter', async () => {
    await renderScreen(<AnswerScreen />);
    expect(screen.getByTestId('19-field').props.maxLength).toBe(500);
    expect(screen.getByTestId('19-field-counter')).toHaveTextContent('0 / 500');
  });

  it('caps a Premium couple at 2000, with the counter', async () => {
    mockPremium = { status: 'ready', isPremium: true };
    await renderScreen(<AnswerScreen />);
    expect(screen.getByTestId('19-field').props.maxLength).toBe(2000);
    expect(screen.getByTestId('19-field-counter')).toHaveTextContent('0 / 2000');
  });

  it('keeps the free cap while Premium is unknown (loading or error)', async () => {
    mockPremium = { status: 'loading', isPremium: false };
    await renderScreen(<AnswerScreen />);
    expect(screen.getByTestId('19-field').props.maxLength).toBe(500);
    expect(screen.queryByTestId('19d-upsell')).toBeNull();
  });

  it('19d: from 450 characters a free couple sees "N left. Premium: 2000", which opens the paywall', async () => {
    useDrafts.getState().setDraft('cq-1', chars(449));
    await renderScreen(<AnswerScreen />);
    // Plain 19 carries no offer.
    expect(screen.queryByTestId('19d-upsell')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('19-field'), chars(486));
    const hint = screen.getByTestId('19d-upsell');
    expect(hint).toHaveTextContent('14 left. Premium: 2000');
    expect(hint.props.accessibilityLabel).toBe('14 characters left. Premium allows up to 2000');
    await fireEvent.changeText(screen.getByTestId('19-field'), chars(500));
    expect(screen.getByTestId('19d-upsell')).toHaveTextContent('0 left. Premium: 2000');
    await fireEvent.press(screen.getByTestId('19d-upsell'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/paywall',
      params: { from: 'answer' },
    });
  });

  it('19d never shows for a Premium couple', async () => {
    mockPremium = { status: 'ready', isPremium: true };
    useDrafts.getState().setDraft('cq-1', chars(480));
    await renderScreen(<AnswerScreen />);
    expect(screen.queryByTestId('19d-upsell')).toBeNull();
  });

  it('a lapse between typing and sending: ANSWER_TOO_LONG shows the limit, keeps the draft, re-reads Premium', async () => {
    mockSaveAnswer.mockRejectedValue(
      new AppError('ANSWER_TOO_LONG', 'Your answer is longer than 500 characters.', 500),
    );
    mockPremium = { status: 'ready', isPremium: true };
    useDrafts.getState().setDraft('cq-1', chars(1200));
    await renderScreen(<AnswerScreen />);
    await fireEvent.press(screen.getByTestId('19-submit'));
    expect(await screen.findByTestId('19-error')).toHaveTextContent(
      'Your answer is longer than 500 characters. Shorten it a little, then lock it in again.',
    );
    expect(useDrafts.getState().drafts).toEqual({ 'cq-1': chars(1200) });
    expect(mockPremiumRefetch).toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('pack answers (MOB-49) use the same cap and error', async () => {
    mockParams = { questionId: 'cq-1' };
    mockPremium = { status: 'ready', isPremium: true };
    await renderScreen(<AnswerScreen />);
    expect(screen.getByTestId('19-field').props.maxLength).toBe(2000);
  });

  it('a queued answer the server refused as too long shows its limit', async () => {
    useOutbox.getState().queueAnswer({
      coupleQuestionId: 'cq-1',
      userId: 'u1',
      body: MY_TEXT,
      clientWrittenAt: '2026-11-02T22:58:00.000Z',
    });
    await renderScreen(<AnswerScreen />);
    await act(async () =>
      useOutbox.getState().setAnswerStatus('cq-1', 'failed', 'ANSWER_TOO_LONG', 2000),
    );
    expect(screen.getByTestId('19-error')).toHaveTextContent(/longer than 2000 characters/);
  });
});

describe('19/J7 while typing (#85)', () => {
  it.each([
    ['19', {}],
    ['J7', { first: '1' }],
  ])(
    '%s: the field, counter and privacy line scroll into view as one group',
    async (_id, params) => {
      mockParams = params;
      await renderScreen(<AnswerScreen />);
      const group = within(screen.getByTestId('19-keep-in-view'));
      expect(group.getByTestId('19-field')).toBeTruthy();
      expect(group.getByTestId('19-field-counter')).toBeTruthy();
      expect(group.getByTestId('19-private')).toBeTruthy();
      // The pinned button is not part of it.
      expect(group.queryByTestId('19-submit')).toBeNull();
    },
  );
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

  it('AX5 on a small screen (#86): the name gets its own line under avatar + chip', async () => {
    mockCtx = { mine: true, partnerAnswered: true };
    await renderScreen(<RevealScreen />, { cramped: true });
    const stacked = screen.getByTestId('20-sealed-stacked');
    const name = within(stacked).getByTestId('20-sealed-name');
    expect(name).toHaveTextContent('Sam');
    // Full width (no flex share next to the chip), and capped at 200%.
    expect(StyleSheet.flatten(name.props.style).flex).toBeUndefined();
    expect(name.props.maxFontSizeMultiplier).toBe(2);
    expect(within(stacked).getByText('Locked')).toBeTruthy();
  });

  it('otherwise the name sits between avatar and chip on one row, still capped', async () => {
    mockCtx = { mine: true, partnerAnswered: true };
    await renderScreen(<RevealScreen />, { cramped: false });
    expect(screen.queryByTestId('20-sealed-stacked')).toBeNull();
    const name = screen.getByTestId('20-sealed-name');
    expect(StyleSheet.flatten(name.props.style).flex).toBe(1);
    expect(name.props.maxFontSizeMultiplier).toBe(2);
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
          { ...theirs!, reactions: [{ id: 'r2', userId: 'u1', kind: String(kind) }] },
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
    expect(screen.getByLabelText('Sam reacted with red heart')).toBeTruthy();
    expect(await screen.findByLabelText('12-day streak, bonded today')).toBeTruthy();
    // D45 quick row in board order, then "+"; 44 × 44 pills named by the emoji's name.
    for (const [id, name] of [
      ['2764', 'red heart'],
      ['1F602', 'face with tears of joy'],
      ['1F62E', 'face with open mouth'],
      ['1F979', 'face holding back tears'],
      ['1F525', 'fire'],
    ] as const) {
      expect(screen.getByTestId(`21-react-${id}`).props.accessibilityLabel).toBe(
        `React with ${name}`,
      );
    }
    expect(screen.getByTestId('21-react-more').props.accessibilityLabel).toBe('More emoji');
    await fireEvent.press(screen.getByTestId('21-react-1F525'));
    expect(mockSetReaction).toHaveBeenCalledWith({ answerId: 'a2', userId: 'u1', kind: '🔥' });
    expect(await screen.findByLabelText('Reacted with fire, selected, 1')).toBeTruthy();
    // Another quick emoji replaces mine (one per person).
    await fireEvent.press(screen.getByTestId('21-react-1F602'));
    await waitFor(() =>
      expect(mockSetReaction).toHaveBeenLastCalledWith({
        answerId: 'a2',
        userId: 'u1',
        kind: '😂',
      }),
    );
    expect(
      await screen.findByLabelText('Reacted with face with tears of joy, selected, 1'),
    ).toBeTruthy();
    expect(screen.getByLabelText('React with fire')).toBeTruthy();
    // The same one again removes it (delete own row).
    await fireEvent.press(screen.getByTestId('21-react-1F602'));
    await waitFor(() =>
      expect(mockRemoveReaction).toHaveBeenCalledWith({ answerId: 'a2', userId: 'u1' }),
    );
    expect(await screen.findByLabelText('React with face with tears of joy')).toBeTruthy();
    // "+" opens the full picker: any emoji, saved as is, then shown with its count.
    await fireEvent.press(screen.getByTestId('21-react-more'));
    expect(await screen.findByTestId('21-react-picker')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('21-react-picker-cat-food'));
    await fireEvent.press(await screen.findByTestId('21-react-picker-1F355'));
    await waitFor(() =>
      expect(mockSetReaction).toHaveBeenLastCalledWith({
        answerId: 'a2',
        userId: 'u1',
        kind: '🍕',
      }),
    );
    expect(await screen.findByLabelText('Reacted with pizza, selected, 1')).toBeTruthy();
    expect(screen.getByTestId('21-react-1F355')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('21-talk'));
    expect(mockRouter.push).toHaveBeenCalledWith('/today/thread');
  });
});

describe('55 Offline (answers queue, streak safe)', () => {
  it('locks in offline: saved on this phone, nothing sent, the partner answer stays locked', async () => {
    onlineManager.setOnline(false);
    useDrafts.getState().setDraft('cq-1', MY_TEXT);
    await renderScreen(<AnswerScreen />);
    expect(screen.getByTestId('offline-banner')).toHaveTextContent(
      "You're offline. Your answer will send when you're back.",
    );
    await fireEvent.press(screen.getByTestId('19-submit'));
    expect(await screen.findByTestId('55-queued')).toBeTruthy();
    expect(screen.getByTestId('55-queued')).toHaveTextContent(/Waiting to send/);
    expect(screen.getByText('Saved on this phone')).toBeTruthy();
    expect(screen.getByTestId('55-streak-safe')).toHaveTextContent(
      'Your streak is safe. Answers count for the day you wrote them.',
    );
    // Reveal rule (release blocker): a queued answer opens nothing.
    expect(mockSaveAnswer).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockGetRevealed).not.toHaveBeenCalled();
    expect(screen.queryByText(PARTNER_TEXT)).toBeNull();
    // The text stays on the phone (draft and queue) until the server has it.
    expect(useDrafts.getState().drafts['cq-1']).toBe(MY_TEXT);
    expect(useOutbox.getState().answers['cq-1']?.status).toBe('queued');
  });

  it('shows a queued answer from before a restart, and the error of one the server refused', async () => {
    useOutbox.getState().queueAnswer({
      coupleQuestionId: 'cq-1',
      userId: 'u1',
      body: MY_TEXT,
      clientWrittenAt: '2026-11-02T22:58:00.000Z',
    });
    await renderScreen(<AnswerScreen />);
    expect(screen.getByTestId('55-queued')).toBeTruthy();
    expect(screen.queryByTestId('19-private')).toBeNull();
    await act(async () => useOutbox.getState().setAnswerStatus('cq-1', 'failed', 'NOT_PAIRED'));
    expect(screen.queryByTestId('55-queued')).toBeNull();
    expect(screen.getByTestId('19-error')).toBeTruthy();
  });

  it('a queued answer is not "answered" even when the server shows an older one', async () => {
    mockCtx = { mine: true, partnerAnswered: true };
    useOutbox.getState().queueAnswer({
      coupleQuestionId: 'cq-1',
      userId: 'u1',
      body: MY_TEXT,
      clientWrittenAt: '2026-11-02T22:58:00.000Z',
    });
    await renderScreen(<AnswerScreen />);
    expect(screen.getByTestId('55-queued')).toBeTruthy();
    expect(screen.queryByTestId('19-answered')).toBeNull();
  });
});
