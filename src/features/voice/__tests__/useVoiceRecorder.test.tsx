import { act, renderHook } from '@testing-library/react-native';
import { File } from 'expo-file-system';

import { VOICE_ANSWER_MAX_MS, VOICE_RECORDING } from '@/features/voice/encoding';
import { useVoiceRecorder } from '@/features/voice/useVoiceRecorder';
import { clearOutbox, useOutbox } from '@/lib/outbox';

type FakeRecorder = {
  uri: string | null;
  durationMillis: number;
  isRecording: boolean;
  options: unknown;
  record: jest.Mock;
  stop: jest.Mock;
};
const audio = (
  jest.requireMock('expo-audio') as {
    __audio: { permission: boolean; recorders: FakeRecorder[] };
  }
).__audio;
const lastRecorder = () => audio.recorders[audio.recorders.length - 1]!;

const props = {
  coupleId: 'C1',
  userId: 'U1',
  maxMs: VOICE_ANSWER_MAX_MS,
  context: 'answer' as const,
};

beforeEach(() => {
  jest.useFakeTimers();
  audio.permission = true;
  clearOutbox();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function startRecording() {
  const hook = await renderHook(() => useVoiceRecorder(props));
  await act(async () => {
    await hook.result.current.start();
  });
  return hook;
}

it('records with the D46 encoder settings', async () => {
  const hook = await startRecording();
  expect(lastRecorder().options).toBe(VOICE_RECORDING);
  expect(hook.result.current.phase).toBe('recording');
  expect(lastRecorder().record).toHaveBeenCalledWith({ forDuration: 91 });
});

it('stops by itself at 90 s and keeps the take (auto-stop)', async () => {
  const hook = await startRecording();
  lastRecorder().durationMillis = 89_950;
  await act(async () => {
    jest.advanceTimersByTime(VOICE_ANSWER_MAX_MS);
  });
  expect(lastRecorder().stop).toHaveBeenCalled();
  expect(hook.result.current.phase).toBe('recorded');
  expect(hook.result.current.autoStopped).toBe(true);
  expect(hook.result.current.take).toMatchObject({ durationMs: 89_950 });
  // BE-43: no bucket name on the phone; the server issues it at upload time.
  expect(hook.result.current.take).not.toHaveProperty('path');
});

it('never keeps more than 90 s', async () => {
  const hook = await startRecording();
  lastRecorder().durationMillis = 95_000;
  await act(async () => {
    await hook.result.current.stop();
  });
  expect(hook.result.current.take?.durationMs).toBe(VOICE_ANSWER_MAX_MS);
});

it('a stop by hand cancels the auto-stop', async () => {
  const hook = await startRecording();
  lastRecorder().durationMillis = 12_000;
  await act(async () => {
    await hook.result.current.stop();
  });
  expect(hook.result.current.autoStopped).toBe(false);
  await act(async () => {
    jest.advanceTimersByTime(VOICE_ANSWER_MAX_MS);
  });
  expect(lastRecorder().stop).toHaveBeenCalledTimes(1);
});

it('drops a slip of the finger (under half a second)', async () => {
  const del = jest.spyOn(File.prototype, 'delete');
  const hook = await startRecording();
  lastRecorder().durationMillis = 200;
  await act(async () => {
    await hook.result.current.stop();
  });
  expect(hook.result.current.phase).toBe('idle');
  expect(hook.result.current.take).toBeNull();
  expect(del).toHaveBeenCalled();
});

it('microphone refused: no recording, the denied state', async () => {
  audio.permission = false;
  const hook = await startRecording();
  expect(hook.result.current.denied).toBe(true);
  expect(hook.result.current.phase).toBe('idle');
});

it('Delete removes the take from the phone; a queued take is left to the queue', async () => {
  const del = jest.spyOn(File.prototype, 'delete');
  const hook = await startRecording();
  lastRecorder().durationMillis = 5_000;
  await act(async () => {
    await hook.result.current.stop();
  });
  const take = hook.result.current.take!;
  useOutbox.getState().queueAnswer({
    coupleQuestionId: 'cq-1',
    userId: 'u1',
    body: '',
    voice: { ...take },
    clientWrittenAt: '2026-11-11T20:00:00Z',
  });
  await act(async () => hook.result.current.discard());
  expect(del).not.toHaveBeenCalled();
  clearOutbox();
  // Record again, then Delete: nobody else holds this take.
  await act(async () => {
    await hook.result.current.start();
  });
  lastRecorder().durationMillis = 5_000;
  await act(async () => {
    await hook.result.current.stop();
  });
  await act(async () => hook.result.current.discard());
  expect(del).toHaveBeenCalledTimes(1);
  expect(hook.result.current.phase).toBe('idle');
});
