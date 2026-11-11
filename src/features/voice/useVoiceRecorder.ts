import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useOutbox } from '@/lib/outbox';

import { deleteLocalTake as deleteFile } from './api';
import { VOICE_RECORDING } from './encoding';

/**
 * Deletes a take unless a queued answer or thread message still needs it (the queue deletes it
 * after sending).
 */
function deleteLocalTake(fileUri: string | null | undefined): void {
  if (!fileUri) return;
  const { answers, items } = useOutbox.getState();
  const queued =
    Object.values(answers).some((a) => a.voice?.fileUri === fileUri) ||
    Object.values(items).some((m) => m.voice?.fileUri === fileUri);
  if (!queued) deleteFile(fileUri);
}

/**
 * A finished recording on this phone. Its bucket name is issued by the server when the answer
 * queue uploads it (BE-43 `start_voice_upload`), not here.
 */
export type VoiceTake = { fileUri: string; durationMs: number };

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'recorded';

/** Shorter than this is a slip of the finger, not an answer: discarded. */
export const VOICE_MIN_MS = 500;

/**
 * One voice take for screen 19c and the thread's hold-to-record (22b) (D46): ask for the microphone, record mono AAC up to `maxMs`
 * (stops by itself at the limit), keep the take, record again or delete it.
 *
 * The take's file lives in the app's documents folder. It is deleted here when discarded, replaced
 * or left behind (unmount) unless a queued answer holds it: the answer queue deletes it once it is
 * on the server. No audio, file name or object name is ever logged.
 */
export function useVoiceRecorder({
  coupleId,
  userId,
  maxMs,
}: {
  coupleId: string | null | undefined;
  userId: string | null | undefined;
  maxMs: number;
}) {
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [take, setTake] = useState<VoiceTake | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [autoStopped, setAutoStopped] = useState(false);
  const takeRef = useRef<VoiceTake | null>(null);
  const phaseRef = useRef<RecorderPhase>('idle');
  const stopping = useRef(false);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPhaseBoth = (next: RecorderPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const setTakeBoth = (next: VoiceTake | null) => {
    takeRef.current = next;
    setTake(next);
  };

  const elapsedMs = Math.min(recorderState.durationMillis ?? 0, maxMs);

  const stop = useCallback(
    async (auto = false): Promise<VoiceTake | null> => {
      if (phaseRef.current !== 'recording' || stopping.current) return takeRef.current;
      stopping.current = true;
      if (limitTimer.current) clearTimeout(limitTimer.current);
      limitTimer.current = null;
      const durationMs = Math.min(recorder.getStatus().durationMillis ?? 0, maxMs);
      try {
        await recorder.stop();
      } catch {
        // Already stopped by the native duration limit.
      }
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      stopping.current = false;
      const uri = recorder.uri;
      if (!uri || durationMs < VOICE_MIN_MS || !coupleId || !userId) {
        deleteLocalTake(uri);
        setFailed(!!uri && durationMs >= VOICE_MIN_MS);
        setPhaseBoth('idle');
        return null;
      }
      const next = { fileUri: uri, durationMs };
      setAutoStopped(auto);
      setTakeBoth(next);
      setPhaseBoth('recorded');
      return next;
    },
    [recorder, maxMs, coupleId, userId],
  );

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  /** Resolves `true` once recording runs (false: no permission or the recorder failed). */
  const start = useCallback(async (): Promise<boolean> => {
    if (phaseRef.current === 'recording' || phaseRef.current === 'starting') return false;
    setFailed(false);
    setAutoStopped(false);
    setPhaseBoth('starting');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setDenied(true);
        setPhaseBoth(takeRef.current ? 'recorded' : 'idle');
        return false;
      }
      setDenied(false);
      // A new take replaces the old one (Record again).
      deleteLocalTake(takeRef.current?.fileUri);
      setTakeBoth(null);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      // The native limit is only a backstop (1 s later); the effect below stops at `maxMs`.
      recorder.record({ forDuration: maxMs / 1000 + 1 });
      setPhaseBoth('recording');
      // 90 s auto-stop (D46): the take keeps what was recorded up to the limit.
      limitTimer.current = setTimeout(() => void stopRef.current(true), maxMs);
      return true;
    } catch {
      setFailed(true);
      setPhaseBoth('idle');
      return false;
    }
  }, [recorder, maxMs]);

  /** Delete: the take leaves the phone; back to the record button. */
  const discard = useCallback(() => {
    deleteLocalTake(takeRef.current?.fileUri);
    setTakeBoth(null);
    setAutoStopped(false);
    setPhaseBoth('idle');
  }, []);

  // Leaving the screen: stop a running recording and drop a take nobody took.
  useEffect(
    () => () => {
      if (limitTimer.current) clearTimeout(limitTimer.current);
      if (phaseRef.current === 'recording') {
        recorder
          .stop()
          .then(() => deleteLocalTake(recorder.uri))
          .catch(() => undefined);
        void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      }
      deleteLocalTake(takeRef.current?.fileUri);
    },
    [recorder],
  );

  /** Slide to cancel (22b): stop if recording, then the take leaves the phone. */
  const cancel = useCallback(async () => {
    await stop(false);
    discard();
  }, [stop, discard]);

  return {
    phase,
    take,
    elapsedMs,
    denied,
    failed,
    autoStopped,
    start,
    /** Stops and resolves the take (null when it was too short or failed). */
    stop: () => stop(false),
    discard,
    cancel,
  };
}
