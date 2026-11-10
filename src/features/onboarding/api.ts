import type { Database } from '@/types/database';
import { unwrap } from '@/lib/errors';
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
