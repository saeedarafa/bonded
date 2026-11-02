import type { PostgrestError } from '@supabase/supabase-js';

import { AppError, messageFor, toAppError, unwrap, type MessageOptions } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

import type { RawStreak } from './today';

/** Today's question for the Today tab. Answer text is never selected here (ids and times only). */
export type TodayQuestion = {
  id: string;
  answerCount: number;
  question: string;
  /** Answers RLS lets me see (mine; the partner's only once I've answered): who and when. */
  answers: { userId: string; createdAt: string }[];
};

const unknown = () => new AppError('UNKNOWN', messageFor('UNKNOWN'));

/**
 * `get_daily_question()` assigns (or returns) today's `couple_questions` row; the detail select adds
 * the question and who has answered. A locked partner answer is absent: `answerCount` still counts it.
 */
export async function getTodayQuestion(): Promise<TodayQuestion> {
  const row = unwrap(await supabase.rpc('get_daily_question'));
  if (!row?.id) throw unknown();
  const detail = unwrap(
    await supabase
      .from('couple_questions')
      .select('id, answer_count, question:questions(body), answers(user_id, created_at)')
      .eq('id', row.id)
      .single(),
  );
  if (!detail) throw unknown();
  return {
    id: detail.id,
    answerCount: detail.answer_count,
    question: detail.question?.body ?? '',
    answers: (detail.answers ?? []).map((a) => ({ userId: a.user_id, createdAt: a.created_at })),
  };
}

/** `get_streak()` (BE-06). Normalised by the hook (QA-BUG-3 nulls). */
export async function getStreak(): Promise<RawStreak | null> {
  return unwrap(await supabase.rpc('get_streak'));
}

/**
 * `send_nudge()` (D16, BE-10) is planned, not on main: not in the generated types yet, so the
 * Today screen hides the button while this is false. Flip it when BE-10 merges and drop the cast.
 */
export const NUDGE_AVAILABLE = false;

type UntypedRpc = (fn: string) => PromiseLike<{ error: PostgrestError | null }>;

/** One nudge a day while the partner hasn't answered (`NUDGE_LIMIT`, `PARTNER_ALREADY_ANSWERED`). */
export async function sendNudge(options?: MessageOptions): Promise<void> {
  const rpc = supabase.rpc.bind(supabase) as unknown as UntypedRpc;
  const { error } = await rpc('send_nudge');
  if (error) throw toAppError(error, options);
}
