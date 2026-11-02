import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

type GetEnv = (name: string) => string | undefined;

// Service-role access belongs only in Edge Functions. Never expose this client to the app.
export const createAdminClient = (getEnv: GetEnv = Deno.env.get): SupabaseClient => {
  const url = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('MISCONFIGURED');
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};
