import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/** My display name (and timezone, which the couple inherits at creation). RLS limits this to my row. */
export async function updateMyProfile(
  userId: string,
  fields: { displayName: string; timezone?: string },
): Promise<void> {
  unwrap(
    await supabase
      .from('profiles')
      .update({
        display_name: fields.displayName,
        ...(fields.timezone ? { timezone: fields.timezone } : {}),
      })
      .eq('id', userId),
  );
}
