import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { RevealedQuestion } from '@/features/daily/api';
import {
  useAnswerReaction,
  useNudge,
  useNudgedDay,
  useNudgedToday,
  useSaveAnswer,
  withMyReaction,
} from '@/features/daily/hooks';
import { useDrafts } from '@/lib/drafts';
import { AppError } from '@/lib/errors';
import { queryKeys } from '@/lib/queryKeys';

const mockSaveAnswer = jest.fn<Promise<void>, [Record<string, unknown>]>();
const mockSetReaction = jest.fn<Promise<void>, [Record<string, unknown>]>();
const mockSendNudge = jest.fn<Promise<void>, []>();
jest.mock('@/features/daily/api', () => ({
  sendNudge: () => mockSendNudge(),
  saveAnswer: (input: Record<string, unknown>) => mockSaveAnswer(input),
  setAnswerReaction: (input: Record<string, unknown>) => mockSetReaction(input),
  removeAnswerReaction: () => Promise.resolve(),
}));

const QUESTION: RevealedQuestion = {
  id: 'cq-1',
  answerCount: 2,
  question: 'Q',
  answers: [
    { id: 'a1', userId: 'u1', body: 'mine', createdAt: '2026-11-02T20:51:00Z', reactions: [] },
    {
      id: 'a2',
      userId: 'u2',
      body: 'theirs',
      createdAt: '2026-11-02T21:04:00Z',
      reactions: [{ id: 'r9', userId: 'u1', kind: '😂' }],
    },
  ],
};

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  jest.clearAllMocks();
  useDrafts.getState().reset();
});
afterEach(() => qc.clear());

describe('useNudge (BE-10)', () => {
  beforeEach(() => useNudgedDay.setState({ day: null }));

  it('a sent nudge marks today (couple timezone) and refreshes Today', async () => {
    mockSendNudge.mockResolvedValue();
    const invalidate = jest.spyOn(qc, 'invalidateQueries');
    const { result } = await renderHook(
      () => ({ nudge: useNudge('Sam', 'UTC'), nudged: useNudgedToday('UTC') }),
      { wrapper },
    );
    expect(result.current.nudged).toBe(false);
    await act(async () => {
      await result.current.nudge.mutateAsync();
    });
    await waitFor(() => expect(result.current.nudged).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.today.all });
  });

  it('NUDGE_LIMIT (e.g. after a restart) also means "nudged today"', async () => {
    mockSendNudge.mockRejectedValue(new AppError('NUDGE_LIMIT', 'x'));
    const { result } = await renderHook(
      () => ({ nudge: useNudge('Sam', 'UTC'), nudged: useNudgedToday('UTC') }),
      { wrapper },
    );
    await act(async () => {
      await result.current.nudge.mutateAsync().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.nudged).toBe(true));
    expect(mockSendNudge).toHaveBeenCalledTimes(1);
  });

  it('PARTNER_ALREADY_ANSWERED refreshes Today and does not mark; NOT_PAIRED refreshes the couple', async () => {
    const invalidate = jest.spyOn(qc, 'invalidateQueries');
    mockSendNudge.mockRejectedValue(new AppError('PARTNER_ALREADY_ANSWERED', 'x'));
    const { result } = await renderHook(
      () => ({ nudge: useNudge('Sam', 'UTC'), nudged: useNudgedToday('UTC') }),
      { wrapper },
    );
    await act(async () => {
      await result.current.nudge.mutateAsync().catch(() => undefined);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.today.all });
    expect(result.current.nudged).toBe(false);
    mockSendNudge.mockRejectedValue(new AppError('NOT_PAIRED', 'x'));
    await act(async () => {
      await result.current.nudge.mutateAsync().catch(() => undefined);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.couple.all });
  });

  it('a nudge from another day does not count today', async () => {
    useNudgedDay.setState({ day: '2000-01-01' });
    const { result } = await renderHook(() => useNudgedToday('UTC'), { wrapper });
    expect(result.current).toBe(false);
  });
});

describe('withMyReaction', () => {
  it('replaces my reaction, keeps the others, and removes it with null', () => {
    const loved = withMyReaction(QUESTION, 'a2', 'u1', 'love');
    expect(loved.answers[1]?.reactions).toEqual([
      { id: 'optimistic-u1', userId: 'u1', kind: '❤️' },
    ]);
    expect(withMyReaction(loved, 'a2', 'u1', null).answers[1]?.reactions).toEqual([]);
    expect(loved.answers[0]).toBe(QUESTION.answers[0]);
  });
});

describe('useSaveAnswer', () => {
  it('sends client_written_at and deletes the draft once saved', async () => {
    mockSaveAnswer.mockResolvedValue(undefined);
    useDrafts.getState().setDraft('cq-1', 'Your laugh.');
    const { result } = await renderHook(() => useSaveAnswer(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ coupleQuestionId: 'cq-1', userId: 'u1', body: 'Your laugh.' }),
    );
    expect(mockSaveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ coupleQuestionId: 'cq-1', body: 'Your laugh.' }),
    );
    expect(typeof mockSaveAnswer.mock.calls[0]?.[0].clientWrittenAt).toBe('string');
    expect(useDrafts.getState().drafts).toEqual({});
  });

  it('keeps the draft when the save fails', async () => {
    mockSaveAnswer.mockRejectedValue(new AppError('NETWORK', 'offline'));
    useDrafts.getState().setDraft('cq-1', 'Your laugh.');
    const { result } = await renderHook(() => useSaveAnswer(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({ coupleQuestionId: 'cq-1', userId: 'u1', body: 'Your laugh.' })
        .catch(() => undefined);
    });
    expect(useDrafts.getState().drafts).toEqual({ 'cq-1': 'Your laugh.' });
  });
});

describe('useAnswerReaction', () => {
  it('shows the reaction at once and rolls back on failure', async () => {
    let fail: (e: Error) => void = () => undefined;
    mockSetReaction.mockReturnValue(new Promise<void>((_resolve, reject) => (fail = reject)));
    qc.setQueryData(queryKeys.questions.detail('cq-1'), QUESTION);
    const { result } = await renderHook(() => useAnswerReaction('cq-1'), { wrapper });
    await act(async () => {
      result.current.mutate({ answerId: 'a2', userId: 'u1', kind: '❤️' });
    });
    const optimistic = qc.getQueryData<RevealedQuestion>(queryKeys.questions.detail('cq-1'));
    expect(optimistic?.answers[1]?.reactions.map((r) => r.kind)).toEqual(['love']);
    await act(async () => fail(new AppError('NETWORK', 'offline')));
    await waitFor(() =>
      expect(
        qc.getQueryData<RevealedQuestion>(queryKeys.questions.detail('cq-1'))?.answers[1]
          ?.reactions,
      ).toEqual([{ id: 'r9', userId: 'u1', kind: '😂' }]),
    );
  });
});
