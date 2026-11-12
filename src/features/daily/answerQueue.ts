import {
  focusManager,
  onlineManager,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import { answerAccepted } from '@/features/daily/analytics';
import { saveAnswer } from '@/features/daily/api';
import { deleteLocalTake, startVoiceUpload, uploadVoice } from '@/features/voice/api';
import { FRESH_UPLOAD_KINDS, voiceUploadStep } from '@/features/voice/uploadStep';
import { useDrafts } from '@/lib/drafts';
import { AppError } from '@/lib/errors';
import { useOutbox } from '@/lib/outbox';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Sends answers queued offline (MOB-14, screen 55). Each keeps the time it was written
 * (`client_written_at`, D17), so it counts for the day it was written; the server clamps it.
 *
 * One flush at a time: a call while a flush runs schedules one more pass, so an answer queued
 * meanwhile is not missed and nothing is sent twice in parallel. Within a pass:
 * - offline: nothing is tried;
 * - saved: removed from the queue, the draft is deleted, today, the streak, the question and
 *   History refetch;
 * - no connection (or the session needs a refresh): back to queued, the pass stops, the next
 *   reconnect or app focus tries again;
 * - any other error is definite: the answer stays on the phone as failed with the error kind.
 *
 * A voice answer (D46, BE-43) first gets an upload name from the server (`start_voice_upload`;
 * `VOICE_LIMIT` stops it there, before anything is sent), uploads its take to the private bucket,
 * then writes the row. A Storage refusal (not Premium, too large, wrong type) is definite like a
 * database code, a dropped connection queues it again. A name older than ~1 h or an upload older
 * than ~23 h is not reused: the take gets a fresh name and is uploaded again (the old object is
 * removed by the server's cleanup). If the take is gone from the phone, the upload fails with
 * `VOICE_FORMAT`, whose text asks to record again.
 *
 * This is the one place outside a Query hook that calls the answers API: the queue must drain even
 * when no screen is mounted. It never reads or logs the answer text beyond sending it.
 */
export { voiceUploadStep } from '@/features/voice/uploadStep';

let running: Promise<void> | null = null;
let again = false;

async function flushOnce(queryClient: QueryClient, userId: string): Promise<void> {
  const outbox = useOutbox.getState;
  const queued = Object.values(outbox().answers)
    .filter((a) => a.userId === userId && a.status === 'queued')
    .sort((a, b) => a.clientWrittenAt.localeCompare(b.clientWrittenAt));
  for (const answer of queued) {
    if (!onlineManager.isOnline()) return;
    const id = answer.coupleQuestionId;
    outbox().setAnswerStatus(id, 'sending');
    const { voice } = answer;
    // Only touch the queued take if it is still this one (a newer lock-in may have replaced it).
    const same = () => outbox().answers[id]?.voice?.fileUri === voice?.fileUri;
    try {
      // D46 / BE-43: a voice answer gets an issued name, uploads its take (once), then writes the row.
      let voicePath: string | undefined = voice?.path;
      if (voice) {
        const step = voiceUploadStep(voice, Date.now());
        if (step === 'issue') {
          voicePath = await startVoiceUpload();
          if (same()) outbox().setVoicePath(id, voicePath, new Date().toISOString());
        }
        if (step !== 'save' && voicePath) {
          await uploadVoice({ path: voicePath, fileUri: voice.fileUri });
          if (same()) outbox().markVoiceUploaded(id, new Date().toISOString());
        }
      }
      await saveAnswer({
        coupleQuestionId: id,
        userId,
        body: answer.body,
        voice: voice && voicePath ? { path: voicePath, durationMs: voice.durationMs } : null,
        clientWrittenAt: answer.clientWrittenAt,
      });
    } catch (error) {
      const kind = error instanceof AppError ? error.kind : 'UNKNOWN';
      const transient = kind === 'NETWORK' || (error instanceof AppError && error.signedOut);
      // Queued again while it was sending (a newer lock-in)? Keep the newer one as queued.
      if (outbox().answers[id]?.status !== 'sending') continue;
      if (transient) {
        outbox().setAnswerStatus(id, 'queued');
        return;
      }
      if (voice && FRESH_UPLOAD_KINDS.includes(kind) && same()) outbox().resetVoiceUpload(id);
      // ANSWER_TOO_LONG keeps the server's limit for the message (a lapse while it waited).
      outbox().setAnswerStatus(
        id,
        'failed',
        kind,
        error instanceof AppError ? error.max : undefined,
      );
      continue;
    }
    // Analytics (MOB-24c): the server took it (`answer_submitted`, ids and buckets only).
    answerAccepted(id);
    // A newer lock-in arrived while this one was in flight: send that one too (next pass).
    if (outbox().answers[id]?.status === 'sending') {
      outbox().removeAnswer(id);
      useDrafts.getState().clearDraft(id);
      // The take is on the server now: the copy on the phone is no longer needed.
      if (voice) deleteLocalTake(voice.fileUri);
    } else {
      again = true;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.today.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.streak() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.badges.awards() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.questions.detail(id) }),
      // MOB-49: a pack question's flow and 30 read who answered from its history detail.
      queryClient.invalidateQueries({ queryKey: queryKeys.history.all }),
    ]);
  }
}

export function flushAnswerQueue(queryClient: QueryClient, userId: string): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await flushOnce(queryClient, userId);
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * Mounted once for the signed-in user (root layout): drains the queue at start, when the
 * connection returns and when the app comes back to the foreground.
 */
export function useAnswerQueueSync(userId: string | null): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const run = () => {
      if (onlineManager.isOnline()) void flushAnswerQueue(queryClient, userId);
    };
    run();
    const stopOnline = onlineManager.subscribe((online) => online && run());
    const stopFocus = focusManager.subscribe((focused) => focused && run());
    return () => {
      stopOnline();
      stopFocus();
    };
  }, [queryClient, userId]);
}
