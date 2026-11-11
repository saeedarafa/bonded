import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useEffect, useMemo } from 'react';

import {
  getThread,
  getUnreadCount,
  markThreadRead,
  removeMessageReaction,
  sendMessage,
  setMessageReaction,
  type ThreadMessage,
} from '@/features/thread/api';
import { deleteLocalTake, startVoiceUpload, uploadVoice } from '@/features/voice/api';
import { VOICE_MESSAGE_MAX_BYTES } from '@/features/voice/encoding';
import { bodyOrVoice } from '@/features/voice/placeholder';
import { FRESH_UPLOAD_KINDS, voiceUploadStep } from '@/features/voice/uploadStep';
import { AppError, messageFor, toAppError } from '@/lib/errors';
import { useOutbox, type OutboxItem, type OutboxStatus } from '@/lib/outbox';
import { queryKeys } from '@/lib/queryKeys';

/**
 * A voice message as the thread shows it: a bucket object (sent) or, while it is still on its way,
 * the take on this phone (`fileUri`) until it is uploaded.
 */
export type ThreadVoice = { durationMs: number; path?: string; fileUri?: string };

export type ThreadItem = Omit<ThreadMessage, 'id' | 'voice'> & {
  id: string;
  status: OutboxStatus;
  voice: ThreadVoice | null;
};

/** A take ready to send (from the recorder). */
export type VoiceMessageTake = { fileUri: string; durationMs: number };

/**
 * Pure: the server's messages, then my pending ones (sending or failed) that the server doesn't
 * have yet. One row per `client_id`, so a retried or already-arrived message is never shown twice.
 */
export function mergeThread(
  server: ThreadMessage[],
  outbox: OutboxItem[],
  coupleQuestionId: string,
  userId: string,
): ThreadItem[] {
  const arrived = new Set(server.map((m) => m.clientId));
  const pending = outbox
    .filter((o) => o.coupleQuestionId === coupleQuestionId && !arrived.has(o.clientId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map<ThreadItem>((o) => ({
      id: `local-${o.clientId}`,
      clientId: o.clientId,
      userId,
      body: o.voice ? bodyOrVoice(null) : o.body,
      voice: o.voice
        ? o.voice.uploaded && o.voice.path
          ? { durationMs: o.voice.durationMs, path: o.voice.path }
          : { durationMs: o.voice.durationMs, fileUri: o.voice.fileUri }
        : null,
      createdAt: o.createdAt,
      reactions: [],
      status: o.status,
    }));
  return [...server.map<ThreadItem>((m) => ({ ...m, status: 'sent' })), ...pending];
}

/** Today's thread; realtime `thread_messages` events invalidate it. */
export function useThread(coupleQuestionId: string | undefined, { enabled }: { enabled: boolean }) {
  return useQuery<ThreadMessage[], AppError>({
    queryKey: queryKeys.thread.detail(coupleQuestionId ?? ''),
    queryFn: () => getThread(coupleQuestionId ?? ''),
    enabled: enabled && !!coupleQuestionId,
  });
}

/** The thread with my pending messages merged in (see `mergeThread`). */
export function useThreadItems(
  coupleQuestionId: string | undefined,
  userId: string | null,
  server: ThreadMessage[] | undefined,
): ThreadItem[] {
  const items = useOutbox((s) => s.items);
  return useMemo(
    () =>
      coupleQuestionId && userId
        ? mergeThread(server ?? [], Object.values(items), coupleQuestionId, userId)
        : [],
    [server, items, coupleQuestionId, userId],
  );
}

/** One send attempt of a voice message: name, upload (once), then the row (BE-43). */
async function sendVoiceMessage(item: OutboxItem, userId: string): Promise<void> {
  const voice = item.voice;
  if (!voice) return;
  const outbox = useOutbox.getState;
  // Only record progress if the outbox still holds this take.
  const same = () => outbox().items[item.clientId]?.voice?.fileUri === voice.fileUri;
  const current = outbox().items[item.clientId]?.voice ?? voice;
  const step = voiceUploadStep(current, Date.now());
  let path = current.path;
  if (step === 'issue') {
    path = await startVoiceUpload();
    if (same()) outbox().setMessageVoicePath(item.clientId, path, new Date().toISOString());
  }
  if (step !== 'save' && path) {
    await uploadVoice({ path, fileUri: voice.fileUri, maxBytes: VOICE_MESSAGE_MAX_BYTES });
    if (same()) outbox().markMessageVoiceUploaded(item.clientId, new Date().toISOString());
  }
  if (!path) throw new AppError('UNKNOWN', messageFor('UNKNOWN'));
  await sendMessage({
    clientId: item.clientId,
    coupleQuestionId: item.coupleQuestionId,
    userId,
    body: '',
    voice: { path, durationMs: voice.durationMs },
  });
}

/**
 * Optimistic send (22). `send(body)` gives the message a new `client_id` and shows it at once as
 * sending; a failure keeps it as "Not sent" and `retry(clientId)` resends the SAME `client_id`
 * (CONTRACTS §2: a duplicate error then means it already arrived). Retrying a message that is
 * still sending does nothing, so two taps can't race.
 *
 * `sendVoice(take)` (22b, D46, MOB-56) does the same for a recorded take: the outbox keeps the file
 * and the issued bucket name, so a retry reuses a fresh name or a finished upload. The take leaves
 * the phone once the row is written. `onError` gets definite errors (e.g. `VOICE_LIMIT`), so the
 * screen can say why a voice message failed; message text is never part of it.
 */
export function useSendMessage(
  coupleQuestionId: string | undefined,
  userId: string | null,
  { onError }: { onError?: (error: AppError, item: OutboxItem) => void } = {},
) {
  const queryClient = useQueryClient();
  const mutation = useMutation<void, AppError, OutboxItem>({
    networkMode: 'always',
    mutationFn: async (item) => {
      if (!userId) throw new AppError('SIGNED_OUT', messageFor('SIGNED_OUT'));
      try {
        if (item.voice) {
          await sendVoiceMessage(item, userId);
          return;
        }
        await sendMessage({
          clientId: item.clientId,
          coupleQuestionId: item.coupleQuestionId,
          userId,
          body: item.body,
        });
      } catch (e) {
        throw e instanceof AppError ? e : toAppError(e);
      }
    },
    onMutate: (item) => useOutbox.getState().put({ ...item, status: 'sending' }),
    onError: (error, item) => {
      const outbox = useOutbox.getState();
      if (item.voice && FRESH_UPLOAD_KINDS.includes(error.kind)) {
        outbox.resetMessageVoiceUpload(item.clientId);
      }
      outbox.setStatus(item.clientId, 'failed');
      onError?.(error, item);
    },
    onSuccess: async (_data, item) => {
      useOutbox.getState().setStatus(item.clientId, 'sent');
      // The recording is on the server and attached: the copy on the phone is no longer needed.
      if (item.voice) deleteLocalTake(item.voice.fileUri);
      const key = queryKeys.thread.detail(item.coupleQuestionId);
      await queryClient.invalidateQueries({ queryKey: key });
      const server = queryClient.getQueryData<ThreadMessage[]>(key);
      if (server?.some((m) => m.clientId === item.clientId)) {
        useOutbox.getState().remove([item.clientId]);
      }
    },
  });

  const start = (item: OutboxItem) => {
    // Into the outbox at once, so the take is held (the recorder won't delete it) before any await.
    useOutbox.getState().put(item);
    mutation.mutate(item);
  };

  return {
    send: (body: string) => {
      if (!coupleQuestionId || !userId) return;
      start({
        clientId: randomUUID(),
        coupleQuestionId,
        body,
        createdAt: new Date().toISOString(),
        status: 'sending',
      });
    },
    sendVoice: (take: VoiceMessageTake) => {
      if (!coupleQuestionId || !userId) return;
      start({
        clientId: randomUUID(),
        coupleQuestionId,
        body: '',
        voice: { fileUri: take.fileUri, durationMs: take.durationMs },
        createdAt: new Date().toISOString(),
        status: 'sending',
      });
    },
    retry: (clientId: string) => {
      const item = useOutbox.getState().items[clientId];
      if (!item || item.status !== 'failed') return;
      mutation.mutate(item);
    },
  };
}

/** Partner messages I haven't seen in this thread (0 while signed out or without a question). */
export function useThreadUnread(coupleQuestionId: string | undefined, userId: string | null) {
  return useQuery<number, AppError>({
    queryKey: queryKeys.thread.unreadFor(coupleQuestionId ?? ''),
    queryFn: () => getUnreadCount(coupleQuestionId ?? '', userId ?? ''),
    enabled: !!coupleQuestionId && !!userId,
  });
}

/**
 * While the thread is open, moves my read marker to the newest message from the server (server
 * time, so a skewed device clock can't hide or resurface messages). Only when it moves.
 */
export function useMarkThreadRead(
  coupleQuestionId: string | undefined,
  userId: string | null,
  server: ThreadMessage[] | undefined,
) {
  const queryClient = useQueryClient();
  const newest = server?.length ? server[server.length - 1]?.createdAt : undefined;
  const { mutate } = useMutation<void, AppError, string>({
    mutationFn: (lastReadAt) =>
      markThreadRead({
        coupleQuestionId: coupleQuestionId ?? '',
        userId: userId ?? '',
        lastReadAt,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.thread.unread() }),
  });
  useEffect(() => {
    if (coupleQuestionId && userId && newest) mutate(newest);
  }, [coupleQuestionId, userId, newest, mutate]);
}

/** Pure: the thread with my reaction on one message set to `kind` (null removes it). */
export function withMyMessageReaction(
  messages: ThreadMessage[],
  messageId: string,
  userId: string,
  kind: string | null,
): ThreadMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId) return m;
    const others = m.reactions.filter((r) => r.userId !== userId);
    return {
      ...m,
      reactions: kind ? [...others, { id: `optimistic-${userId}`, userId, kind }] : others,
    };
  });
}

export type MessageReactInput = { messageId: string; userId: string; kind: string | null };

/**
 * React to a thread message (22, D45), optimistic with rollback: `kind` replaces mine, null removes
 * it. The caller applies the one-per-person rule (`nextReaction`); the database validates the emoji.
 */
export function useMessageReaction(coupleQuestionId: string | undefined) {
  const queryClient = useQueryClient();
  const key = queryKeys.thread.detail(coupleQuestionId ?? '');
  return useMutation<void, AppError, MessageReactInput, { previous?: ThreadMessage[] }>({
    networkMode: 'always',
    mutationFn: ({ messageId, userId, kind }) =>
      kind
        ? setMessageReaction({ messageId, userId, kind })
        : removeMessageReaction({ messageId, userId }),
    onMutate: async ({ messageId, userId, kind }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ThreadMessage[]>(key);
      if (previous) {
        queryClient.setQueryData(key, withMyMessageReaction(previous, messageId, userId, kind));
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
