import type { ReactionKind } from '@/features/daily/api';
import { toAppError, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/**
 * Thread (22, CONTRACTS §2). RLS decides what is readable and postable: only couple members, only
 * once both have answered, only for questions of the pair period. The app never re-checks that.
 * Message text is never logged and never goes into an error, a query key or analytics.
 */
export type ThreadMessage = {
  id: string;
  /** Device UUID of the send; the same on every retry (`thread_messages.client_id` is unique). */
  clientId: string;
  userId: string;
  body: string;
  createdAt: string;
  reactions: { id: string; userId: string; kind: ReactionKind }[];
};

export async function getThread(coupleQuestionId: string): Promise<ThreadMessage[]> {
  const rows = unwrap(
    await supabase
      .from('thread_messages')
      .select('id, client_id, user_id, body, created_at, reactions(id, user_id, kind)')
      .eq('couple_question_id', coupleQuestionId)
      .order('created_at'),
  );
  return (rows ?? []).map((m) => ({
    id: m.id,
    clientId: m.client_id,
    userId: m.user_id,
    body: m.body,
    createdAt: m.created_at,
    reactions: (m.reactions ?? []).map((r) => ({ id: r.id, userId: r.user_id, kind: r.kind })),
  }));
}

/** Postgres unique violation: `client_id` already exists, so an earlier attempt got through. */
const UNIQUE_VIOLATION = '23505';

/**
 * Sends one message. Retries MUST pass the same `clientId`: the unique `client_id` turns a resend
 * of a message that already arrived into a duplicate error, which counts as sent.
 */
export async function sendMessage(input: {
  clientId: string;
  coupleQuestionId: string;
  userId: string;
  body: string;
}): Promise<void> {
  const { error } = await supabase.from('thread_messages').insert({
    client_id: input.clientId,
    couple_question_id: input.coupleQuestionId,
    user_id: input.userId,
    body: input.body,
  });
  if (error && error.code !== UNIQUE_VIOLATION) throw toAppError(error);
}

/** Moves my read marker to `lastReadAt` (the newest message I've seen, server time). */
export async function markThreadRead(input: {
  coupleQuestionId: string;
  userId: string;
  lastReadAt: string;
}): Promise<void> {
  unwrap(
    await supabase.from('thread_reads').upsert(
      {
        couple_question_id: input.coupleQuestionId,
        user_id: input.userId,
        last_read_at: input.lastReadAt,
      },
      { onConflict: 'couple_question_id,user_id' },
    ),
  );
}

/**
 * Unread partner messages in one thread, from the live `thread_reads` marker (no text selected):
 * messages by someone else newer than my marker, or all of them without one.
 */
export async function getUnreadCount(coupleQuestionId: string, userId: string): Promise<number> {
  const marker = unwrap(
    await supabase
      .from('thread_reads')
      .select('last_read_at')
      .eq('couple_question_id', coupleQuestionId)
      .eq('user_id', userId)
      .maybeSingle(),
  );
  let query = supabase
    .from('thread_messages')
    .select('id', { count: 'exact', head: true })
    .eq('couple_question_id', coupleQuestionId)
    .neq('user_id', userId);
  if (marker?.last_read_at) query = query.gt('created_at', marker.last_read_at);
  const { count, error } = await query;
  if (error) throw toAppError(error);
  return count ?? 0;
}

/**
 * `unread_thread_counts()` (BE-20): unread partner messages for every open thread at once (History
 * rows). Threads without unread messages are absent.
 */
export const UNREAD_COUNTS_AVAILABLE = true;

export async function getUnreadThreadCounts(): Promise<Record<string, number>> {
  const rows = unwrap(await supabase.rpc('unread_thread_counts')) ?? [];
  const out: Record<string, number> = {};
  for (const row of rows) out[row.couple_question_id] = row.unread;
  return out;
}
