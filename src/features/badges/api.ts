import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

export type Badge = Tables<'badges'>;
export type BadgeAward = Pick<
  Tables<'badge_awards'>,
  'id' | 'badge_slug' | 'couple_id' | 'user_id' | 'awarded_at'
>;

/** The badge catalogue (BE-12, `supabase/content/badges.csv`). Readable by any signed-in user. */
export async function getBadgeCatalogue(): Promise<Badge[]> {
  return unwrap(await supabase.from('badges').select('*').order('threshold')) ?? [];
}

/**
 * Badges awarded to our couple (shared streak rows, `couple_id`) and to me (personal rows,
 * `user_id`). RLS decides which rows come back; awards are written by the server only.
 */
export async function getBadgeAwards(): Promise<BadgeAward[]> {
  return (
    unwrap(
      await supabase
        .from('badge_awards')
        .select('id, badge_slug, couple_id, user_id, awarded_at')
        .order('awarded_at', { ascending: false }),
    ) ?? []
  );
}
