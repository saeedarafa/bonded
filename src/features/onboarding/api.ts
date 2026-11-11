import type { Database } from '@/types/database';
import { AppError, messageFor, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export type OnboardingAnswerRow = Database['public']['Tables']['onboarding_answers']['Insert'];

/**
 * `onboarding_answers` upsert (CONTRACTS §2, BE-33, D38). One row per user + question + questionnaire
 * version, so repeating the same rows never makes a duplicate (MOB-37 retries rely on it). RLS keeps
 * the rows to their owner. Answers are never logged.
 */
export async function upsertOnboardingAnswers(rows: OnboardingAnswerRow[]): Promise<void> {
  if (rows.length === 0) return;
  unwrap(
    await supabase
      .from('onboarding_answers')
      .upsert(rows, { onConflict: 'user_id,question_id,questionnaire_version' }),
  );
}

/**
 * T1 (MOB-61, CONTRACTS §2 "Finishing onboarding", step 7): `get_daily_question()` assigns the new
 * couple's day-1 question (`first_day`, D12) or returns it again on a retry. Returns its
 * `couple_questions` id.
 */
export async function getDailyQuestionId(): Promise<string> {
  const row = unwrap(await supabase.rpc('get_daily_question'));
  if (!row?.id) throw new AppError('UNKNOWN', messageFor('UNKNOWN'));
  return row.id;
}

/**
 * The T1 answer as my answer to that question. **No `client_written_at`** (CONTRACTS §2): arrival
 * time makes it count for the couple's first local day. The upsert key makes a retry the same row.
 */
export async function saveFirstAnswer(input: {
  coupleQuestionId: string;
  userId: string;
  body: string;
}): Promise<void> {
  unwrap(
    await supabase
      .from('answers')
      .upsert(
        { couple_question_id: input.coupleQuestionId, user_id: input.userId, body: input.body },
        { onConflict: 'couple_question_id,user_id' },
      ),
  );
}
