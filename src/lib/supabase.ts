import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { supabaseEnv } from '@/lib/env';
import { noStoreFetch } from '@/lib/httpCache';
import { authStorage } from '@/lib/storage';
import type { Database } from '@/types/database';

/**
 * The one Supabase client (MOB-06), typed with `Database`, signed in as the user (anon key only;
 * the service role key never ships in the app). Import it only from `src/features/<f>/api.ts`
 * and `src/lib/*`; screens and components never touch it (data access rule, AGENTS.md).
 */
const { url, anonKey } = supabaseEnv();

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    flowType: 'pkce',
    // Deep links are handled by expo-router/MOB-08, not by the client reading the URL.
    detectSessionInUrl: false,
  },
  // MOB-89 (#479): every request (auth, PostgREST, Storage, functions) says `no-store`, so no
  // token or answer text lands in the OS HTTP cache. See src/lib/httpCache.ts.
  global: { fetch: noStoreFetch },
});

/** Keep the token fresh only while the app is in the foreground (supabase-js on React Native). */
export function startAuthAutoRefresh(): () => void {
  const apply = (state: string) => {
    if (state === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  };
  apply(AppState.currentState ?? 'active');
  const sub = AppState.addEventListener('change', apply);
  return () => {
    sub.remove();
    void supabase.auth.stopAutoRefresh();
  };
}
