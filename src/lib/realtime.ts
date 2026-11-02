import type { QueryClient } from '@tanstack/react-query';
import type {
  RealtimePostgresChangesPayload,
  REALTIME_SUBSCRIBE_STATES,
  SupabaseClient,
} from '@supabase/supabase-js';

import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/database';

/**
 * Realtime skeleton (MOB-06; MOB-13 finishes it, MOB-12 adds typing presence, D15).
 * CONTRACTS §2: ONE channel `couple:{couple_id}`; events are only signals, so every handler
 * invalidates queries and the app refetches. The payload is read for ids only, never for text,
 * and is never logged.
 */
export type RealtimeTable =
  'couple_questions' | 'answers' | 'thread_messages' | 'reactions' | 'couple_members';

export const REALTIME_TABLES: readonly RealtimeTable[] = [
  'couple_questions',
  'answers',
  'thread_messages',
  'reactions',
  'couple_members',
];

type Row = Record<string, unknown>;
export type ChangePayload = Pick<RealtimePostgresChangesPayload<Row>, 'new' | 'old'>;

function idOf(payload: ChangePayload, column: string): string | undefined {
  for (const row of [payload.new, payload.old] as (Row | undefined)[]) {
    const v = row?.[column];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/** Which query keys a change on `table` makes stale. Pure, so it is unit-tested. */
export function keysToInvalidate(
  table: RealtimeTable,
  payload: ChangePayload,
): (readonly unknown[])[] {
  switch (table) {
    case 'couple_questions': {
      const id = idOf(payload, 'id');
      return [
        queryKeys.today.all,
        queryKeys.history.all,
        id ? queryKeys.questions.detail(id) : queryKeys.questions.all,
      ];
    }
    case 'answers': {
      // RLS scopes the event: a locked partner answer never arrives; its unlock arrives as an
      // update on couple_questions (answer_count) or the answer itself.
      const id = idOf(payload, 'couple_question_id');
      return [
        queryKeys.today.all,
        queryKeys.history.all,
        queryKeys.streak(),
        id ? queryKeys.questions.detail(id) : queryKeys.questions.all,
      ];
    }
    case 'thread_messages': {
      const id = idOf(payload, 'couple_question_id');
      return [id ? queryKeys.thread.detail(id) : queryKeys.thread.all, queryKeys.thread.unread()];
    }
    case 'reactions':
      // Reactions carry answer_id or message_id, not the question: refresh both lists.
      return [queryKeys.questions.all, queryKeys.thread.all];
    case 'couple_members':
      return [queryKeys.couple.all, queryKeys.profiles.all, queryKeys.today.all];
  }
}

/** Everything that may have changed while the socket was down. */
export function allCoupleKeys(): (readonly unknown[])[] {
  return [
    queryKeys.couple.all,
    queryKeys.profiles.all,
    queryKeys.today.all,
    queryKeys.questions.all,
    queryKeys.history.all,
    queryKeys.thread.all,
    queryKeys.streak(),
  ];
}

export type RealtimeClient = Pick<SupabaseClient<Database>, 'channel' | 'removeChannel'>;

export function channelName(coupleId: string): string {
  return `couple:${coupleId}`;
}

/**
 * Opens the couple channel and wires every table to invalidations. Returns the unsubscribe
 * function. After the first successful subscribe, a later SUBSCRIBED means we reconnected, so
 * everything is refetched (events were missed while offline).
 */
export function subscribeToCouple(
  client: RealtimeClient,
  queryClient: QueryClient,
  coupleId: string,
): () => void {
  const invalidate = (keys: (readonly unknown[])[]) => {
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
  };

  let channel = client.channel(channelName(coupleId));
  for (const table of REALTIME_TABLES) {
    channel = channel.on<Row>(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        // Only couple_questions has couple_id; the other tables are scoped by RLS.
        ...(table === 'couple_questions' ? { filter: `couple_id=eq.${coupleId}` } : {}),
      },
      (payload) => invalidate(keysToInvalidate(table, payload)),
    );
  }

  let hasConnected = false;
  channel.subscribe((status: `${REALTIME_SUBSCRIBE_STATES}`) => {
    if (status !== 'SUBSCRIBED') return;
    if (hasConnected) invalidate(allCoupleKeys());
    hasConnected = true;
  });

  return () => {
    void client.removeChannel(channel);
  };
}
