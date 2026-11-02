import { toAppError, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Database, Tables } from '@/types/database';

export type CoupleMember = Pick<Tables<'couple_members'>, 'user_id' | 'left_at'>;
export type ActiveCouple = Tables<'couples'> & { couple_members: CoupleMember[] };

/** My active couple (solo or paired) with its members, or null before `create_couple` has run. */
export async function getActiveCouple(): Promise<ActiveCouple | null> {
  return unwrap(
    await supabase
      .from('couples')
      .select('*, couple_members(user_id, left_at)')
      .eq('status', 'active')
      .maybeSingle(),
  );
}

type Stage = Database['public']['Enums']['couple_stage'];

/**
 * `create_couple` (BE-03): the solo couple that `create_invite` needs. A retry while still solo
 * updates the settings and returns the same id, so calling it twice is safe.
 */
export async function createCouple(input: {
  stage: Stage | null;
  goals: string[];
  partnerName: string;
}): Promise<string> {
  const id = unwrap(
    await supabase.rpc('create_couple', {
      // The contract allows null; the generated type is stricter than the function.
      p_stage: input.stage as Stage,
      p_goals: input.goals,
      ...(input.partnerName ? { p_partner_name: input.partnerName } : {}),
    }),
  );
  return id ?? '';
}

/**
 * `unpair()`: the couple becomes `ended`. A retry after success raises NOT_PAIRED, which means
 * it is already done, so that is success here (CONTRACTS §2).
 */
export async function unpair(): Promise<void> {
  const { error } = await supabase.rpc('unpair');
  if (!error) return;
  const appError = toAppError(error);
  if (appError.kind === 'NOT_PAIRED') return;
  throw appError;
}
