import { onlineManager, QueryClient } from '@tanstack/react-query';

import { flushAnswerQueue, voiceUploadStep } from '@/features/daily/answerQueue';
import { AppError, messageFor } from '@/lib/errors';
import { clearOutbox, useOutbox } from '@/lib/outbox';

const mockSaveAnswer = jest.fn<Promise<void>, [Record<string, unknown>]>();
jest.mock('@/features/daily/api', () => ({
  saveAnswer: (input: Record<string, unknown>) => mockSaveAnswer(input),
}));
const mockUpload = jest.fn<Promise<void>, [Record<string, unknown>]>();
const mockDeleteLocal = jest.fn<void, [string]>();
const mockStart = jest.fn<Promise<string>, []>();
jest.mock('@/features/voice/api', () => ({
  startVoiceUpload: () => mockStart(),
  uploadVoice: (input: Record<string, unknown>) => mockUpload(input),
  deleteLocalTake: (uri: string) => mockDeleteLocal(uri),
}));

const NAME = 'c1/u1/issued-1.m4a';
const NAME_2 = 'c1/u1/issued-2.m4a';
const TAKE = { durationMs: 42_000, fileUri: 'file:///doc/take-1.m4a' };
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const WRITTEN = '2026-11-11T20:00:00.000Z';
type Kind =
  | 'NETWORK'
  | 'PREMIUM_REQUIRED'
  | 'VOICE_DENIED'
  | 'VOICE_LIMIT'
  | 'VOICE_TOO_LONG'
  | 'INVALID_VOICE';
const fail = (kind: Kind) => new AppError(kind, messageFor(kind));

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient();
  jest.clearAllMocks();
  mockUpload.mockResolvedValue(undefined);
  mockStart.mockReset();
  mockStart.mockResolvedValueOnce(NAME).mockResolvedValueOnce(NAME_2);
  mockSaveAnswer.mockResolvedValue(undefined);
  clearOutbox();
  onlineManager.setOnline(true);
});
afterEach(() => qc.clear());

const queueVoice = (voice: Record<string, unknown> = {}) =>
  useOutbox.getState().queueAnswer({
    coupleQuestionId: 'cq-1',
    userId: 'u1',
    body: '',
    voice: { ...TAKE, ...voice },
    clientWrittenAt: WRITTEN,
  });
const queuedVoice = () => useOutbox.getState().answers['cq-1']?.voice;

it('gets an issued name, uploads the take to it, writes the voice answer, deletes the copy on the phone', async () => {
  queueVoice();
  await flushAnswerQueue(qc, 'u1');
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(mockUpload).toHaveBeenCalledWith({ path: NAME, fileUri: TAKE.fileUri });
  expect(mockSaveAnswer).toHaveBeenCalledWith({
    coupleQuestionId: 'cq-1',
    userId: 'u1',
    body: '',
    voice: { path: NAME, durationMs: 42_000 },
    clientWrittenAt: WRITTEN,
  });
  expect(mockStart.mock.invocationCallOrder[0]).toBeLessThan(
    mockUpload.mock.invocationCallOrder[0]!,
  );
  expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(
    mockSaveAnswer.mock.invocationCallOrder[0]!,
  );
  expect(useOutbox.getState().answers).toEqual({});
  expect(mockDeleteLocal).toHaveBeenCalledWith(TAKE.fileUri);
});

it('no connection during the upload: stays queued, the retry uploads to the SAME name (no new slot)', async () => {
  queueVoice();
  mockUpload.mockRejectedValueOnce(fail('NETWORK'));
  await flushAnswerQueue(qc, 'u1');
  expect(mockSaveAnswer).not.toHaveBeenCalled();
  expect(useOutbox.getState().answers['cq-1']).toMatchObject({
    status: 'queued',
    voice: { ...TAKE, path: NAME },
  });
  expect(queuedVoice()?.uploaded).toBeFalsy();
  expect(mockDeleteLocal).not.toHaveBeenCalled();
  await flushAnswerQueue(qc, 'u1');
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(mockUpload).toHaveBeenCalledTimes(2);
  expect(mockUpload.mock.calls[1]?.[0]).toEqual({ path: NAME, fileUri: TAKE.fileUri });
  expect(mockSaveAnswer).toHaveBeenCalledTimes(1);
  expect(useOutbox.getState().answers).toEqual({});
});

it('uploaded but the row write dropped: the retry only writes the row', async () => {
  queueVoice();
  mockSaveAnswer.mockRejectedValueOnce(fail('NETWORK'));
  await flushAnswerQueue(qc, 'u1');
  expect(queuedVoice()).toMatchObject({ path: NAME, uploaded: true });
  await flushAnswerQueue(qc, 'u1');
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockSaveAnswer).toHaveBeenCalledTimes(2);
  expect(useOutbox.getState().answers).toEqual({});
});

it('VOICE_LIMIT from start_voice_upload: failed before anything is uploaded, take kept', async () => {
  queueVoice();
  mockStart.mockReset();
  mockStart.mockRejectedValueOnce(fail('VOICE_LIMIT'));
  await flushAnswerQueue(qc, 'u1');
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockSaveAnswer).not.toHaveBeenCalled();
  expect(useOutbox.getState().answers['cq-1']).toMatchObject({
    status: 'failed',
    errorKind: 'VOICE_LIMIT',
  });
  expect(mockDeleteLocal).not.toHaveBeenCalled();
});

it('a name issued more than ~1 h ago and never uploaded gets a fresh name', async () => {
  queueVoice({ path: 'c1/u1/old.m4a', issuedAt: ago(70 * MIN) });
  await flushAnswerQueue(qc, 'u1');
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(mockUpload).toHaveBeenCalledWith({ path: NAME, fileUri: TAKE.fileUri });
  expect(mockSaveAnswer.mock.calls[0]?.[0]).toMatchObject({ voice: { path: NAME } });
});

it('a take queued before BE-43 (self-made name, no issue time) gets an issued name', async () => {
  queueVoice({ path: 'c1/u1/self-made.m4a' });
  await flushAnswerQueue(qc, 'u1');
  expect(mockUpload).toHaveBeenCalledWith({ path: NAME, fileUri: TAKE.fileUri });
});

it('uploaded more than ~23 h ago and never attached: fresh name, uploaded again, then saved', async () => {
  queueVoice({
    path: 'c1/u1/old.m4a',
    issuedAt: ago(25 * HOUR),
    uploaded: true,
    uploadedAt: ago(23 * HOUR),
  });
  await flushAnswerQueue(qc, 'u1');
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(mockUpload).toHaveBeenCalledWith({ path: NAME, fileUri: TAKE.fileUri });
  expect(mockSaveAnswer.mock.calls[0]?.[0]).toMatchObject({ voice: { path: NAME } });
  expect(useOutbox.getState().answers).toEqual({});
});

it('INVALID_VOICE on the row write: failed, and the next try starts with a fresh name', async () => {
  queueVoice();
  mockSaveAnswer.mockRejectedValueOnce(fail('INVALID_VOICE'));
  await flushAnswerQueue(qc, 'u1');
  expect(useOutbox.getState().answers['cq-1']).toMatchObject({
    status: 'failed',
    errorKind: 'INVALID_VOICE',
    voice: TAKE,
  });
  expect(queuedVoice()).not.toHaveProperty('path');
  useOutbox.getState().setAnswerStatus('cq-1', 'queued');
  await flushAnswerQueue(qc, 'u1');
  expect(mockStart).toHaveBeenCalledTimes(2);
  expect(mockUpload.mock.calls[1]?.[0]).toEqual({ path: NAME_2, fileUri: TAKE.fileUri });
  expect(useOutbox.getState().answers).toEqual({});
});

it('VOICE_TOO_LONG keeps the limit in seconds for the message', async () => {
  queueVoice();
  mockSaveAnswer.mockRejectedValueOnce(new AppError('VOICE_TOO_LONG', 'x', 90));
  await flushAnswerQueue(qc, 'u1');
  expect(useOutbox.getState().answers['cq-1']).toMatchObject({
    status: 'failed',
    errorKind: 'VOICE_TOO_LONG',
    errorMax: 90,
  });
});

it.each(['VOICE_DENIED', 'PREMIUM_REQUIRED'] as const)(
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
  expect(mockStart).not.toHaveBeenCalled();
  expect(mockUpload).not.toHaveBeenCalled();
  onlineManager.setOnline(true);
});

describe('voiceUploadStep', () => {
  const now = Date.parse('2026-11-11T12:00:00.000Z');
  const at = (ms: number) => new Date(now - ms).toISOString();
  it.each([
    ['no name yet', {}, 'issue'],
    ['fresh name', { path: NAME, issuedAt: at(10 * MIN) }, 'upload'],
    ['name at 50 min', { path: NAME, issuedAt: at(50 * MIN) }, 'issue'],
    ['name from the future (clock moved back)', { path: NAME, issuedAt: at(-HOUR) }, 'issue'],
    ['uploaded 1 h ago', { path: NAME, uploaded: true, uploadedAt: at(HOUR) }, 'save'],
    ['uploaded 22 h ago', { path: NAME, uploaded: true, uploadedAt: at(22 * HOUR) }, 'issue'],
    ['uploaded before BE-43 (no time)', { path: NAME, uploaded: true }, 'save'],
  ] as const)('%s: %s', (_label, voice, step) => {
    expect(voiceUploadStep({ ...TAKE, ...voice }, now)).toBe(step);
  });
});
