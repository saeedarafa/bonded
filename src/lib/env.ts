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

/**
 * D30, PO 2026-11-12: the app's domain (invite links, terms, privacy). `app.config.ts` registers it
 * natively. The D30 domain before it is not ours: no fallback, never linked.
 */
export const APP_DOMAIN = 'hellobonded.com';
/** D30: invite links are `${INVITE_BASE_URL}/j/BND4827?t=…`. */
export const INVITE_BASE_URL = `https://${APP_DOMAIN}`;

/**
 * Invite / legal link domain (D30): `hellobonded.com` in `.env.example` and every EAS profile.
 * Empty means no web domain (local and QA simulator builds): invite links then use `bonded://`
 * and the terms / privacy links are hidden. The old `[your-domain]` placeholder means the app's
 * domain. Only the app's domain or one of its subdomains (e.g. a staging host) is used; any other
 * value (a stale `.env` with an old domain, a URL) is ignored, so links never point elsewhere.
 */
export function inviteDomain(): string | null {
  const domain = (process.env.EXPO_PUBLIC_INVITE_DOMAIN ?? '').trim().toLowerCase();
  if (domain === '[your-domain]') return APP_DOMAIN;
  return isAppDomain(domain) ? domain : null;
}

/** `hellobonded.com` or a bare subdomain of it; nothing else. */
export function isAppDomain(host: string): boolean {
  return !/[[\]\s/:]/.test(host) && (host === APP_DOMAIN || host.endsWith(`.${APP_DOMAIN}`));
}

/**
 * D62 (MOB-85): the support mailbox for Settings 40 "Send feedback" (`support@hellobonded.com` in
 * `.env.example` and every EAS profile). Only a plain address at the app's domain (or a subdomain)
 * is used; empty or anything else hides the row.
 */
export function supportEmail(): string | null {
  const raw = (process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '').trim().toLowerCase();
  const m = /^([a-z0-9._+-]+)@([a-z0-9.-]+)$/.exec(raw);
  return m && isAppDomain(m[2]!) ? raw : null;
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

/** D54: PostHog EU unless a build sets another https host. */
export const POSTHOG_EU_HOST = 'https://eu.i.posthog.com';

/**
 * PostHog project key (public by design: it can only send events) and host (MOB-24, D54). Empty
 * key = analytics is a no-op (dev, CI, Jest, local builds). `testBuild` marks every event of an
 * E2E or internal test build as `is_test_account` so PostHog can filter it out.
 */
export function analyticsEnv(): { key: string; host: string; testBuild: boolean } {
  const host = (process.env.EXPO_PUBLIC_POSTHOG_HOST ?? '').trim();
  return {
    key: (process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '').trim(),
    host: /^https:\/\/[a-z0-9.-]+$/i.test(host) ? host : POSTHOG_EU_HOST,
    testBuild: (process.env.EXPO_PUBLIC_ANALYTICS_TEST_BUILD ?? '').trim() === '1',
  };
}
