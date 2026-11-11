import { AppError, messageFor, toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

import {
  isLittleThingKind,
  limitDetailsFrom,
  RECEIVE_WINDOW_MS,
  toToday,
  type LittleThingKind,
  type LittleThingsToday,
  type ReceivedRow,
} from './model';

/**
 * Little things (D48, BE-44, CONTRACTS §2). The limits are enforced by the database; the app only
 * greys a fan item when the server says `at_limit`.
 */

/** `LITTLE_THING_LIMIT` with its details: which kind, and whether Premium would allow more. */
export class LittleThingLimitError extends AppError {
  readonly limitKind: LittleThingKind | undefined;
  readonly morePremium: boolean;

  constructor(limitKind: LittleThingKind | undefined, morePremium: boolean) {
    super('LITTLE_THING_LIMIT', messageFor('LITTLE_THING_LIMIT'));
    this.limitKind = limitKind;
    this.morePremium = morePremium;
  }
}

function toLittleThingError(error: unknown): AppError {
  const e = toAppError(error);
  if (e.kind !== 'LITTLE_THING_LIMIT') return e;
  const details =
    typeof error === 'object' && error !== null
      ? limitDetailsFrom((error as { details?: unknown }).details)
      : undefined;
  return new LittleThingLimitError(details?.kind, details?.morePremium ?? false);
}

export type SentLittleThing = { id: string; sameTime: boolean; atLimit: boolean };

/**
 * `send_little_thing(p_kind, p_amount, p_client_id)`. `clientId` is one UUID per gesture: a retry
 * with the same id returns the first result and counts once.
 */
export async function sendLittleThing(input: {
  kind: LittleThingKind;
  amount: number;
  clientId: string;
}): Promise<SentLittleThing> {
  const { data, error } = await supabase.rpc('send_little_thing', {
    p_kind: input.kind,
    p_amount: input.amount,
    p_client_id: input.clientId,
  });
  if (error) throw toLittleThingError(error);
  if (!data?.id) throw toAppError(new Error('send_little_thing returned no id'));
  return { id: data.id, sameTime: data.same_time === true, atLimit: data.at_limit === true };
}

/** `undo_little_thing(p_id)`: within 5 s of the send; returns today's state after the undo. */
export async function undoLittleThing(id: string): Promise<LittleThingsToday> {
  const { data, error } = await supabase.rpc('undo_little_thing', { p_id: id });
  if (error) throw toLittleThingError(error);
  return toToday(data ?? []);
}

/** `little_things_today()`: one row per kind, `at_limit` and `more_with_premium`, no counts. */
export async function getLittleThingsToday(): Promise<LittleThingsToday> {
  const { data, error } = await supabase.rpc('little_things_today');
  if (error) throw toLittleThingError(error);
  return toToday(data ?? []);
}

/**
 * The couple's recent gestures (both senders) for the 24d moment (CONTRACTS §2 table read; RLS:
 * my couple only). Undone sends are skipped. Realtime INSERT/UPDATE on `little_things` only
 * invalidates this query; the payload is never used.
 */
export async function getRecentLittleThings(
  coupleId: string,
  now: number = Date.now(),
): Promise<ReceivedRow[]> {
  const since = new Date(now - RECEIVE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('little_things')
    .select('id, sender_id, kind, amount, same_time, created_at')
    .eq('couple_id', coupleId)
    .is('undone_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw toAppError(error);
  const rows: ReceivedRow[] = [];
  for (const r of data ?? []) {
    if (!isLittleThingKind(r.kind)) continue;
    rows.push({
      id: r.id,
      senderId: r.sender_id,
      kind: r.kind,
      amount: r.amount,
      sameTime: r.same_time === true,
      createdAt: r.created_at,
    });
  }
  return rows;
}
