import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database';

export type Profile = Pick<Tables<'profiles'>, 'id' | 'display_name' | 'avatar_url'>;

/** My row and my partner's (RLS returns exactly those). */
export async function getCoupleProfiles(): Promise<Profile[]> {
  return unwrap(await supabase.from('profiles').select('id, display_name, avatar_url')) ?? [];
}

/** The device's IANA timezone, or undefined where the runtime can't tell. */
export function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

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
