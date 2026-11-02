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

/** Google sign-in client ids (public by design). Empty until the Google Cloud project exists. */
export function googleEnv(): { webClientId: string; iosClientId: string } {
  return {
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
  };
}

/** Invite / legal link domain; null while it is still the `[your-domain]` placeholder. */
export function inviteDomain(): string | null {
  const domain = (process.env.EXPO_PUBLIC_INVITE_DOMAIN ?? '').trim();
  return domain && !/[[\]\s/]/.test(domain) ? domain : null;
}
