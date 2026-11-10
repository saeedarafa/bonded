import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/**
 * Weekly recap (31). `weekly_recap` (BE-14, D21) returns counts and an answer id only; the
 * premium fields are null for a free couple (the server decides). The most-loved answer is read
 * in two steps through RLS: first who wrote it and where (no text), then its text only when the
 * screen may show it (`lovedTextAllowed`).
 */
export type WeeklyRecap = {
  daysTogether: number;
  replies: number | null;
  reactions: number | null;
  mostLovedAnswerId: string | null;
  isFull: boolean;
};

export async function getWeeklyRecap(weekStart: string): Promise<WeeklyRecap> {
  const row = unwrap(await supabase.rpc('weekly_recap', { p_week_start: weekStart }));
  return {
    daysTogether: row?.days_together ?? 0,
    replies: row?.replies ?? null,
    reactions: row?.reactions ?? null,
    mostLovedAnswerId: row?.most_loved_answer_id ?? null,
    isFull: row?.is_full === true,
  };
}

/** The most-loved answer without its text. */
export type LovedAnswer = {
  id: string;
  userId: string;
  coupleQuestionId: string;
  source: string;
  assignedFor: string | null;
  createdAt: string;
  hearts: number;
};

export async function getLovedAnswer(answerId: string): Promise<LovedAnswer | null> {
  const row = unwrap(
    await supabase
      .from('answers')
      .select(
        'id, user_id, created_at, couple_question_id, reactions(count), couple_question:couple_questions(source, assigned_for)',
      )
      .eq('id', answerId)
      .maybeSingle(),
  );
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    coupleQuestionId: row.couple_question_id,
    source: row.couple_question?.source ?? 'unknown',
    assignedFor: row.couple_question?.assigned_for ?? null,
    createdAt: row.created_at,
    hearts: row.reactions?.[0]?.count ?? 0,
  };
}

/** The answer's text: called only once the reveal rule allows it (never logged). */
export async function getAnswerBody(answerId: string): Promise<string | null> {
  const row = unwrap(
    await supabase.from('answers').select('body').eq('id', answerId).maybeSingle(),
  );
  return row?.body ?? null;
}
