import Constants from 'expo-constants';

import { toAppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

/**
 * Private feedback and the monthly check-in (MOB-23, D22, CONTRACTS §2 "Feedback", BE-15).
 *
 * The `feedback` row is write-only to its owner: RLS allows the insert but no read, so the insert
 * runs WITHOUT `.select()` (PostgREST `return=minimal`); asking for the row back would fail. Only
 * the service role reads it (a person on the team, reply by email). The text never goes to
 * analytics, Sentry or logs.
 */
export type FeedbackKind = Database['public']['Enums']['feedback_kind'];

export type FeedbackInput = {
  userId: string;
  kind: FeedbackKind;
  /** 1 to 5 (check-in faces); null for feedback. */
  score: number | null;
  /** Stable tag ids (not the translated labels), at most 12. */
  tags: readonly string[];
  /** Optional, at most 2,000 characters; '' when empty. */
  body: string;
};

/** CONTRACTS §2: app version is optional and at most 80 characters. */
export function appVersion(): string | null {
  const v = Constants.expoConfig?.version?.trim();
  return v ? v.slice(0, 80) : null;
}

export async function sendFeedback(input: FeedbackInput): Promise<void> {
  const { error } = await supabase.from('feedback').insert({
    user_id: input.userId,
    kind: input.kind,
    score: input.score,
    tags: [...input.tags],
    body: input.body,
    app_version: appVersion(),
  });
  if (error) throw toAppError(error);
}
