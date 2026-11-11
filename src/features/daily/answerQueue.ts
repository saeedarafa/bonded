import {
  focusManager,
  onlineManager,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import { saveAnswer } from '@/features/daily/api';
import { deleteLocalTake, uploadVoice } from '@/features/voice/api';
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
 * A voice answer (D46) uploads its take to the private bucket first; a Storage refusal (not Premium,
 * too large, wrong type) is definite like a database code, a dropped connection queues it again.
 *
 * This is the one place outside a Query hook that calls the answers API: the queue must drain even
 * when no screen is mounted. It never reads or logs the answer text beyond sending it.
 */
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
    try {
      // D46: a voice answer uploads its take first (once), then writes the row that points at it.
      if (voice && !voice.uploaded) {
        await uploadVoice({ path: voice.path, fileUri: voice.fileUri });
        outbox().markVoiceUploaded(id);
      }
      await saveAnswer({
        coupleQuestionId: id,
        userId,
        body: answer.body,
        voice: voice ? { path: voice.path, durationMs: voice.durationMs } : null,
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
      // ANSWER_TOO_LONG keeps the server's limit for the message (a lapse while it waited).
      outbox().setAnswerStatus(
        id,
        'failed',
        kind,
        error instanceof AppError ? error.max : undefined,
      );
      continue;
    }
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
