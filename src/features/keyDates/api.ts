import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

import type { KeyDateRow } from './model';

/**
 * `key_dates` upsert (CONTRACTS §2, BE-03). Safe to repeat: one row per couple and kind (per member
 * for birthdays). RLS refuses a row for another couple or someone else's birthday; that surfaces as
 * an AppError like any other write.
 */
export async function upsertKeyDates(rows: KeyDateRow[]): Promise<void> {
  if (rows.length === 0) return;
  unwrap(await supabase.from('key_dates').upsert(rows, { onConflict: 'couple_id,kind,user_id' }));
}
