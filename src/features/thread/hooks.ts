import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useEffect, useMemo } from 'react';

import {
  getThread,
  getUnreadCount,
  markThreadRead,
  sendMessage,
  type ThreadMessage,
} from '@/features/thread/api';
import { AppError, messageFor } from '@/lib/errors';
import { useOutbox, type OutboxItem, type OutboxStatus } from '@/lib/outbox';
import { queryKeys } from '@/lib/queryKeys';

export type ThreadItem = Omit<ThreadMessage, 'id'> & { id: string; status: OutboxStatus };

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
      body: o.body,
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

/**
 * Optimistic send (22). `send(body)` gives the message a new `client_id` and shows it at once as
 * sending; a failure keeps it as "Not sent" and `retry(clientId)` resends the SAME `client_id`
 * (CONTRACTS §2: a duplicate error then means it already arrived). Retrying a message that is
 * still sending does nothing, so two taps can't race.
 */
export function useSendMessage(coupleQuestionId: string | undefined, userId: string | null) {
  const queryClient = useQueryClient();
  const mutation = useMutation<void, AppError, OutboxItem>({
    networkMode: 'always',
    mutationFn: (item) => {
      if (!userId) throw new AppError('SIGNED_OUT', messageFor('SIGNED_OUT'));
      return sendMessage({
        clientId: item.clientId,
        coupleQuestionId: item.coupleQuestionId,
        userId,
        body: item.body,
      });
    },
    onMutate: (item) => useOutbox.getState().put({ ...item, status: 'sending' }),
    onError: (_error, item) => useOutbox.getState().setStatus(item.clientId, 'failed'),
    onSuccess: async (_data, item) => {
      useOutbox.getState().setStatus(item.clientId, 'sent');
      const key = queryKeys.thread.detail(item.coupleQuestionId);
      await queryClient.invalidateQueries({ queryKey: key });
      const server = queryClient.getQueryData<ThreadMessage[]>(key);
      if (server?.some((m) => m.clientId === item.clientId)) {
        useOutbox.getState().remove([item.clientId]);
      }
    },
  });

  return {
    send: (body: string) => {
      if (!coupleQuestionId || !userId) return;
      mutation.mutate({
        clientId: randomUUID(),
        coupleQuestionId,
        body,
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
