import type { QueryClient } from '@tanstack/react-query';
import type {
  RealtimePostgresChangesPayload,
  REALTIME_SUBSCRIBE_STATES,
  SupabaseClient,
} from '@supabase/supabase-js';

import { queryKeys } from '@/lib/queryKeys';
import type { Database } from '@/types/database';

/**
 * Realtime (MOB-06; MOB-13 verifies latency). Typing presence is a broadcast (MOB-12, D15).
 * CONTRACTS §2: ONE channel `couple:{couple_id}`; events are only signals, so every handler
 * invalidates queries and the app refetches. The payload is read for ids only, never for text,
 * and is never logged.
 */
export type RealtimeTable =
  | 'couple_questions'
  | 'answers'
  | 'thread_messages'
  | 'reactions'
  | 'couple_members'
  | 'join_requests';

export const REALTIME_TABLES: readonly RealtimeTable[] = [
  'couple_questions',
  'answers',
  'thread_messages',
  'reactions',
  'couple_members',
  'join_requests',
];

/** Tables with a `couple_id` column, filtered to this couple on the channel. */
const COUPLE_FILTERED: readonly RealtimeTable[] = ['couple_questions', 'join_requests'];

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
        // A completed day advances the streak, and the streak trigger writes badge awards.
        queryKeys.badges.awards(),
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
    case 'join_requests':
      // BE-26: someone asked to join (or a request was decided). Rows carry no names: the
      // inviter refetches `pending_join_requests()`; an approval also adds a couple member.
      return [queryKeys.joinRequests.all, queryKeys.couple.all];
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
    queryKeys.badges.awards(),
    queryKeys.joinRequests.all,
  ];
}

export type RealtimeClient = Pick<SupabaseClient<Database>, 'channel' | 'removeChannel'>;

export function channelName(coupleId: string): string {
  return `couple:${coupleId}`;
}

/** D15: the broadcast event on the couple channel. Ids only, never text; no database writes. */
export const TYPING_EVENT = 'typing';
export type TypingPayload = { user_id: string; couple_question_id: string };

type Channel = ReturnType<RealtimeClient['channel']>;
type Shared = { channel: Channel; refs: number };

/**
 * One channel per couple, shared by every mounted screen: supabase-js returns the SAME channel for
 * the same topic, and adding `postgres_changes` bindings to a joined channel throws, so a second
 * screen (Today under Revealed under Thread in the stack) must reuse it, and only the last one to
 * unmount removes it.
 */
const shared = new WeakMap<RealtimeClient, Map<string, Shared>>();

function typingPayload(raw: unknown): TypingPayload | null {
  const p = (raw as { payload?: unknown } | null)?.payload as Partial<TypingPayload> | undefined;
  if (typeof p?.user_id !== 'string' || typeof p.couple_question_id !== 'string') return null;
  return { user_id: p.user_id, couple_question_id: p.couple_question_id };
}

/**
 * Opens the couple channel (or joins the open one) and wires every table to invalidations, plus
 * the `typing` broadcast to `onTyping`. Returns the unsubscribe function. After the first
 * successful subscribe, a later SUBSCRIBED means we reconnected, so everything is refetched.
 */
export function subscribeToCouple(
  client: RealtimeClient,
  queryClient: QueryClient,
  coupleId: string,
  onTyping: (payload: TypingPayload) => void = () => undefined,
): () => void {
  const byCouple = shared.get(client) ?? new Map<string, Shared>();
  shared.set(client, byCouple);
  let entry = byCouple.get(coupleId);

  if (!entry) {
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
          // couple_questions and join_requests have couple_id; the other tables are scoped by RLS.
          ...(COUPLE_FILTERED.includes(table) ? { filter: `couple_id=eq.${coupleId}` } : {}),
        },
        (payload) => invalidate(keysToInvalidate(table, payload)),
      );
    }
    channel = channel.on('broadcast', { event: TYPING_EVENT }, (message) => {
      const payload = typingPayload(message);
      if (payload) onTyping(payload);
    });

    let hasConnected = false;
    channel.subscribe((status: `${REALTIME_SUBSCRIBE_STATES}`) => {
      if (status !== 'SUBSCRIBED') return;
      if (hasConnected) invalidate(allCoupleKeys());
      hasConnected = true;
    });
    entry = { channel, refs: 0 };
    byCouple.set(coupleId, entry);
  }

  const mine = entry;
  mine.refs += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    mine.refs -= 1;
    if (mine.refs > 0) return;
    byCouple.delete(coupleId);
    void client.removeChannel(mine.channel);
  };
}

/**
 * Broadcasts `typing` on the open couple channel (the Composer throttles it to every 3 s). Only
 * over a joined socket: typing is ephemeral, so it is dropped rather than sent over REST.
 */
export function sendTyping(client: RealtimeClient, coupleId: string, payload: TypingPayload): void {
  const channel = shared.get(client)?.get(coupleId)?.channel;
  if (!channel || channel.state !== 'joined') return;
  void channel.send({ type: 'broadcast', event: TYPING_EVENT, payload });
}

export function joinRequestChannelName(requestId: string): string {
  return `join-request:${requestId}`;
}

/**
 * BE-26, the joiner's side: while my typed-code request waits for the inviter, watch my own
 * `join_requests` row (RLS: requester or inviter). Its `couple_id` is the INVITER's couple, so the
 * couple channel can't carry it. Every event (and a reconnect) only refetches. Returns the
 * unsubscribe function.
 */
export function subscribeToJoinRequest(
  client: RealtimeClient,
  queryClient: QueryClient,
  requestId: string,
): () => void {
  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.joinRequests.mine(requestId) });
  };
  const channel = client
    .channel(joinRequestChannelName(requestId))
    .on<Row>(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'join_requests', filter: `id=eq.${requestId}` },
      refetch,
    );
  let hasConnected = false;
  channel.subscribe((status: `${REALTIME_SUBSCRIBE_STATES}`) => {
    if (status !== 'SUBSCRIBED') return;
    if (hasConnected) refetch();
    hasConnected = true;
  });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    void client.removeChannel(channel);
  };
}
