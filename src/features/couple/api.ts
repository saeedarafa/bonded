import { toAppError, unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

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
