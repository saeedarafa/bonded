/**
 * Public env (CONTRACTS §7). Only EXPO_PUBLIC_* values reach the bundle, and Metro inlines them
 * only for the literal `process.env.EXPO_PUBLIC_X` form, so each one is spelled out here.
 * Service keys never belong in the app.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in (see CONTRACTS §7).`,
    );
  }
  return value;
}

export function supabaseEnv(): { url: string; anonKey: string } {
  return {
    url: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
    anonKey: required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  };
}
