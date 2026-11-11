import { onlineManager, QueryClient } from '@tanstack/react-query';

import { flushAnswerQueue } from '@/features/daily/answerQueue';
import { AppError, messageFor } from '@/lib/errors';
import { clearOutbox, useOutbox } from '@/lib/outbox';

const mockSaveAnswer = jest.fn<Promise<void>, [Record<string, unknown>]>();
jest.mock('@/features/daily/api', () => ({
  saveAnswer: (input: Record<string, unknown>) => mockSaveAnswer(input),
}));
const mockUpload = jest.fn<Promise<void>, [Record<string, unknown>]>();
const mockDeleteLocal = jest.fn<void, [string]>();
jest.mock('@/features/voice/api', () => ({
  uploadVoice: (input: Record<string, unknown>) => mockUpload(input),
  deleteLocalTake: (uri: string) => mockDeleteLocal(uri),
}));

const TAKE = { path: 'c1/u1/take-1.m4a', durationMs: 42_000, fileUri: 'file:///doc/take-1.m4a' };
const WRITTEN = '2026-11-11T20:00:00.000Z';
const fail = (kind: 'NETWORK' | 'PREMIUM_REQUIRED' | 'VOICE_DENIED' | 'VOICE_LIMIT') =>
  new AppError(kind, messageFor(kind));

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient();
  jest.clearAllMocks();
  mockUpload.mockResolvedValue(undefined);
  mockSaveAnswer.mockResolvedValue(undefined);
  clearOutbox();
  onlineManager.setOnline(true);
});
afterEach(() => qc.clear());

const queueVoice = () =>
  useOutbox.getState().queueAnswer({
    coupleQuestionId: 'cq-1',
    userId: 'u1',
    body: '',
    voice: { ...TAKE },
    clientWrittenAt: WRITTEN,
  });

it('uploads the take first, then writes the voice answer, then deletes the copy on the phone', async () => {
  queueVoice();
  await flushAnswerQueue(qc, 'u1');
  expect(mockUpload).toHaveBeenCalledWith({ path: TAKE.path, fileUri: TAKE.fileUri });
  expect(mockSaveAnswer).toHaveBeenCalledWith({
    coupleQuestionId: 'cq-1',
    userId: 'u1',
    body: '',
    voice: { path: TAKE.path, durationMs: 42_000 },
    clientWrittenAt: WRITTEN,
  });
  expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(
    mockSaveAnswer.mock.invocationCallOrder[0]!,
  );
  expect(useOutbox.getState().answers).toEqual({});
  expect(mockDeleteLocal).toHaveBeenCalledWith(TAKE.fileUri);
});

it('no connection during the upload: stays queued with the take, retried later (upload retry)', async () => {
  queueVoice();
  mockUpload.mockRejectedValueOnce(fail('NETWORK'));
  await flushAnswerQueue(qc, 'u1');
  expect(mockSaveAnswer).not.toHaveBeenCalled();
  expect(useOutbox.getState().answers['cq-1']).toMatchObject({ status: 'queued', voice: TAKE });
  expect(mockDeleteLocal).not.toHaveBeenCalled();
  await flushAnswerQueue(qc, 'u1');
  expect(mockUpload).toHaveBeenCalledTimes(2);
  expect(mockSaveAnswer).toHaveBeenCalledTimes(1);
  expect(useOutbox.getState().answers).toEqual({});
});

it('uploaded but the row write dropped: the retry only writes the row', async () => {
  queueVoice();
  mockSaveAnswer.mockRejectedValueOnce(fail('NETWORK'));
  await flushAnswerQueue(qc, 'u1');
  expect(useOutbox.getState().answers['cq-1']?.voice?.uploaded).toBe(true);
  await flushAnswerQueue(qc, 'u1');
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockSaveAnswer).toHaveBeenCalledTimes(2);
  expect(useOutbox.getState().answers).toEqual({});
});

it.each(['VOICE_DENIED', 'PREMIUM_REQUIRED', 'VOICE_LIMIT'] as const)(
  '%s is definite: failed with the kind, the take stays on the phone',
  async (kind) => {
    queueVoice();
    if (kind === 'VOICE_DENIED') mockUpload.mockRejectedValueOnce(fail(kind));
    else mockSaveAnswer.mockRejectedValueOnce(fail(kind));
    await flushAnswerQueue(qc, 'u1');
    expect(useOutbox.getState().answers['cq-1']).toMatchObject({
      status: 'failed',
      errorKind: kind,
    });
    expect(mockDeleteLocal).not.toHaveBeenCalled();
  },
);

it('offline: nothing is tried', async () => {
  queueVoice();
  onlineManager.setOnline(false);
  await flushAnswerQueue(qc, 'u1');
  expect(mockUpload).not.toHaveBeenCalled();
  onlineManager.setOnline(true);
});
