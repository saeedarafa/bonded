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

/** D30: the app's domain (invite links, terms, privacy). `app.config.ts` registers it natively. */
export const APP_DOMAIN = 'trybonded.com';
/** D30: invite links are `${INVITE_BASE_URL}/j/BND4827?t=…`. */
export const INVITE_BASE_URL = `https://${APP_DOMAIN}`;

/**
 * Invite / legal link domain (D30): `trybonded.com` in `.env.example` and every EAS profile.
 * Empty means no web domain (local and QA simulator builds): invite links then use `bonded://`
 * and the terms / privacy links are hidden. The old `[your-domain]` placeholder means the app's
 * domain; anything else that isn't a bare host is ignored.
 */
export function inviteDomain(): string | null {
  const domain = (process.env.EXPO_PUBLIC_INVITE_DOMAIN ?? '').trim();
  if (domain === '[your-domain]') return APP_DOMAIN;
  return domain && !/[[\]\s/]/.test(domain) ? domain : null;
}

/**
 * EAS project id (public): Expo push tokens are issued per project (MOB-15). Empty until the PO
 * has created the EAS project (ACCOUNTS 3); `app.config.ts` also writes it to `extra.eas.projectId`.
 */
export function easProjectId(): string {
  return (process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '').trim();
}

/**
 * RevenueCat public SDK key for this platform (CONTRACTS §6, §7). Public by design (it can only
 * read offerings and make purchases for the signed-in user). Empty in CI, Jest and local builds
 * without a RevenueCat project: purchases are then "not available right now" and nothing crashes.
 */
export function revenueCatKey(os: string): string {
  const key =
    os === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
      : os === 'android'
        ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
        : undefined;
  return (key ?? '').trim();
}
