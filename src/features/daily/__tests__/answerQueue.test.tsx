import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { flushAnswerQueue, useAnswerQueueSync } from '@/features/daily/answerQueue';
import { useSaveAnswer } from '@/features/daily/hooks';
import { useDrafts } from '@/lib/drafts';
import { AppError } from '@/lib/errors';
import { clearOutbox, useOutbox } from '@/lib/outbox';
import { queryKeys } from '@/lib/queryKeys';

const mockSaveAnswer = jest.fn<Promise<void>, [Record<string, unknown>]>();
jest.mock('@/features/daily/api', () => ({
  saveAnswer: (input: Record<string, unknown>) => mockSaveAnswer(input),
}));

const BODY = 'When you leave the coffee ready.';
const WRITTEN = '2026-11-02T22:58:00.000Z';

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  jest.clearAllMocks();
  mockSaveAnswer.mockResolvedValue(undefined);
  clearOutbox();
  useDrafts.getState().reset();
  onlineManager.setOnline(true);
});
afterEach(() => {
  onlineManager.setOnline(true);
  qc.clear();
});

const queue = (coupleQuestionId = 'cq-1', userId = 'u1') =>
  useOutbox
    .getState()
    .queueAnswer({ coupleQuestionId, userId, body: BODY, clientWrittenAt: WRITTEN });

describe('useSaveAnswer offline (55)', () => {
  it('in airplane mode the answer is queued with the time it was written, nothing is sent', async () => {
    onlineManager.setOnline(false);
    useDrafts.getState().setDraft('cq-1', BODY);
    const before = Date.now();
    const { result } = await renderHook(() => useSaveAnswer(), { wrapper });
    let saved: { queued: boolean } | undefined;
    await act(async () => {
      saved = await result.current.mutateAsync({
        coupleQuestionId: 'cq-1',
        userId: 'u1',
        body: BODY,
      });
    });
    expect(saved).toEqual({ queued: true });
    expect(mockSaveAnswer).not.toHaveBeenCalled();
    const queued = useOutbox.getState().answers['cq-1'];
    expect(queued?.status).toBe('queued');
    expect(Date.parse(queued?.clientWrittenAt ?? '')).toBeGreaterThanOrEqual(before);
    // The draft stays until the server has the answer.
    expect(useDrafts.getState().drafts['cq-1']).toBe(BODY);
  });

  it('a dropped connection mid-send keeps it queued', async () => {
    mockSaveAnswer.mockRejectedValue(new AppError('NETWORK', 'offline'));
    const { result } = await renderHook(() => useSaveAnswer(), { wrapper });
    let saved: { queued: boolean } | undefined;
    await act(async () => {
      saved = await result.current.mutateAsync({
        coupleQuestionId: 'cq-1',
        userId: 'u1',
        body: BODY,
      });
    });
    expect(saved).toEqual({ queued: true });
    expect(useOutbox.getState().answers['cq-1']?.status).toBe('queued');
  });

  it('a definite error fails the lock-in and leaves the queue (the draft keeps the text)', async () => {
    mockSaveAnswer.mockRejectedValue(new AppError('NOT_PAIRED', 'ended'));
    useDrafts.getState().setDraft('cq-1', BODY);
    const { result } = await renderHook(() => useSaveAnswer(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({ coupleQuestionId: 'cq-1', userId: 'u1', body: BODY })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error?.kind).toBe('NOT_PAIRED'));
    expect(useOutbox.getState().answers).toEqual({});
    expect(useDrafts.getState().drafts['cq-1']).toBe(BODY);
  });
});

describe('flushAnswerQueue', () => {
  it('sends with the original client_written_at, then clears the queue and the draft', async () => {
    queue();
    useDrafts.getState().setDraft('cq-1', BODY);
    const spy = jest.spyOn(qc, 'invalidateQueries');
    await flushAnswerQueue(qc, 'u1');
    expect(mockSaveAnswer).toHaveBeenCalledTimes(1);
    expect(mockSaveAnswer).toHaveBeenCalledWith({
      coupleQuestionId: 'cq-1',
      userId: 'u1',
      body: BODY,
      clientWrittenAt: WRITTEN,
    });
    expect(useOutbox.getState().answers).toEqual({});
    expect(useDrafts.getState().drafts).toEqual({});
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.today.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.streak() });
  });

  it('never sends the same answer twice when flushes overlap', async () => {
    let finish: () => void = () => undefined;
    mockSaveAnswer.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    queue();
    const first = flushAnswerQueue(qc, 'u1');
    const second = flushAnswerQueue(qc, 'u1');
    finish();
    await Promise.all([first, second]);
    expect(mockSaveAnswer).toHaveBeenCalledTimes(1);
    expect(useOutbox.getState().answers).toEqual({});
  });

  it('a newer lock-in while one is in flight is sent after it', async () => {
    let finish: () => void = () => undefined;
    mockSaveAnswer.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    queue();
    const first = flushAnswerQueue(qc, 'u1');
    useOutbox.getState().queueAnswer({
      coupleQuestionId: 'cq-1',
      userId: 'u1',
      body: 'Edited.',
      clientWrittenAt: '2026-11-02T22:59:00.000Z',
    });
    const second = flushAnswerQueue(qc, 'u1');
    finish();
    await Promise.all([first, second]);
    expect(mockSaveAnswer).toHaveBeenCalledTimes(2);
    expect(mockSaveAnswer.mock.calls[1]?.[0]).toMatchObject({ body: 'Edited.' });
    expect(useOutbox.getState().answers).toEqual({});
  });

  it("only sends the signed-in user's answers, and nothing while offline", async () => {
    queue('cq-1', 'someone-else');
    await flushAnswerQueue(qc, 'u1');
    expect(mockSaveAnswer).not.toHaveBeenCalled();
    queue('cq-2', 'u1');
    onlineManager.setOnline(false);
    await flushAnswerQueue(qc, 'u1');
    expect(mockSaveAnswer).not.toHaveBeenCalled();
    expect(useOutbox.getState().answers['cq-2']?.status).toBe('queued');
  });

  it('keeps a definite failure on the phone with its kind, never the server text', async () => {
    mockSaveAnswer.mockRejectedValue(new AppError('NOT_PAIRED', 'server said no'));
    queue();
    await flushAnswerQueue(qc, 'u1');
    expect(useOutbox.getState().answers['cq-1']).toMatchObject({
      status: 'failed',
      errorKind: 'NOT_PAIRED',
    });
    expect(JSON.stringify(useOutbox.getState().answers)).not.toContain('server said no');
  });
});

describe('useAnswerQueueSync', () => {
  it('sends the queued answer when the connection returns', async () => {
    onlineManager.setOnline(false);
    queue();
    await renderHook(() => useAnswerQueueSync('u1'), { wrapper });
    expect(mockSaveAnswer).not.toHaveBeenCalled();
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(useOutbox.getState().answers).toEqual({}));
    expect(mockSaveAnswer).toHaveBeenCalledTimes(1);
    expect(mockSaveAnswer.mock.calls[0]?.[0]).toMatchObject({ clientWrittenAt: WRITTEN });
  });

  it('does nothing while signed out', async () => {
    queue();
    await renderHook(() => useAnswerQueueSync(null), { wrapper });
    expect(mockSaveAnswer).not.toHaveBeenCalled();
  });
});
