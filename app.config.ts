import type { ConfigContext, ExpoConfig } from 'expo/config';

import tokens from './src/ui/tokens.json';

// D30 (decided 2026-11-11), PO 2026-11-12 (hellobonded replaces the D30 ids): one id for the iOS bundle identifier and the Android application id.
// It can't change after the first store upload (ACCOUNTS 4, 5).
const BUNDLE_ID = 'com.hellobonded.app';

// D30: the app's domain. Invite links https://hellobonded.com/j/BND4827?t=… open the app (D02, D07)
// through universal links (AASA) and Android App Links (assetlinks.json); both files are LEAD-04.
const APP_DOMAIN = 'hellobonded.com';

// A build may add a second link domain (a subdomain of APP_DOMAIN, e.g. a staging host) through
// EXPO_PUBLIC_INVITE_DOMAIN; the `[your-domain]` placeholder, other domains (the old D30 one is not
// ours, PO 2026-11-12) and anything that isn't a bare host are ignored.
const rawDomain = (process.env.EXPO_PUBLIC_INVITE_DOMAIN ?? '').trim().toLowerCase();
const extraDomain =
  !/[[\]\s/:]/.test(rawDomain) && rawDomain.endsWith(`.${APP_DOMAIN}`) ? rawDomain : null;
const LINK_DOMAINS = [...new Set([APP_DOMAIN, ...(extraDomain ? [extraDomain] : [])])];

// Google sign-in needs the reversed iOS client id as a URL scheme; the plugin throws without it,
// so it is only added once the Google Cloud project exists.
const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?.trim();

// Expo push tokens are issued per EAS project (MOB-15). Set once the PO has run `eas init`
// (ACCOUNTS 3); EAS builds read it from the project's environment variables.
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();

// Little-things notification sounds (D48, CONTRACTS §5, MOB-65): iOS `sound` and the Android channel
// sound are bundled as `assets/sounds/little_thing_<kind>.wav` (rendered by
// design-handoff/assets/sounds/render-sounds.mjs). Keep in sync with `BUNDLED_NOTIFICATION_SOUNDS`
// in src/features/littleThings/channels.ts (a unit test checks both).
const LITTLE_THING_SOUND_KINDS = ['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you'];
const LITTLE_THING_SOUNDS = LITTLE_THING_SOUND_KINDS.map(
  (kind) => `./assets/sounds/little_thing_${kind}.wav`,
);

// MOB-26: store mode (screenshot frames at /store/<shot>) is for the `store` EAS profile and local
// dev builds only. Any other EAS profile (production, preview) with it set fails here instead of
// shipping the demo route. A local release build (`expo run:ios --configuration Release`, an Xcode
// or Gradle archive) has no EAS profile to check, so the route itself also stays off in release
// unless the build sets EXPO_PUBLIC_STORE_BUILD=1 too (src/features/store/storeMode.ts).
export function assertNoStoreModeInProduction(env: NodeJS.ProcessEnv = process.env): void {
  const profile = env.EAS_BUILD_PROFILE;
  const storeFlags = Boolean(env.EXPO_PUBLIC_STORE_MODE || env.EXPO_PUBLIC_STORE_BUILD);
  if (!storeFlags || !profile || profile === 'store' || profile.startsWith('development')) return;
  throw new Error(
    `EXPO_PUBLIC_STORE_MODE / EXPO_PUBLIC_STORE_BUILD must not be set for the "${profile}" EAS profile, only for "store" (MOB-26). A production build must never ship the store route.`,
  );
}
assertNoStoreModeInProduction();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Bonded',
  slug: 'bonded',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'bonded',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    // #324: Bonded icon (design-handoff/assets/icon). iOS 18 dark variant; no tinted art in the
    // hand-off, so iOS derives the tinted icon from the light one.
    icon: { light: './assets/images/icon.png', dark: './assets/images/icon-dark.png' },
    supportsTablet: false,
    usesAppleSignIn: true,
    associatedDomains: LINK_DOMAINS.map((domain) => `applinks:${domain}`),
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      // #324: foreground art keeps the hand-off's 72 dp safe zone; background = tokens light `bg`.
      backgroundColor: tokens.color.light.bg,
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    // Android App Links: https://hellobonded.com/j/* opens the app once assetlinks.json is live.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: LINK_DOMAINS.map((host) => ({ scheme: 'https', host, pathPrefix: '/j/' })),
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-apple-authentication',
    // Push (MOB-15): APNs entitlement on iOS, POST_NOTIFICATIONS on Android 13+.
    ['expo-notifications', { sounds: LITTLE_THING_SOUNDS }],
    // Voice answers (MOB-55, D46): microphone usage text on iOS, RECORD_AUDIO on Android.
    // #272: sounds and voice play only while the app is open. The plugin defaults
    // enableBackgroundPlayback to true, which declares UIBackgroundModes `audio` on iOS (App Review
    // 2.5.4) and FOREGROUND_SERVICE(_MEDIA_PLAYBACK) + a playback service on Android.
    [
      'expo-audio',
      {
        microphonePermission:
          'Bonded uses the microphone only when you record a voice answer or message for your partner.',
        recordAudioAndroid: true,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ] as [
      string,
      {
        microphonePermission: string;
        recordAudioAndroid: boolean;
        enableBackgroundPlayback: boolean;
        enableBackgroundRecording: boolean;
      },
    ],
    ...(googleIosUrlScheme
      ? [
          ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }] as [
            string,
            { iosUrlScheme: string },
          ],
        ]
      : []),
    // Home and lock-screen widgets (MOB-30, D26; 38b MOB-57, D47): WidgetKit extension + App Group
    // on iOS, AppWidget receivers on Android. Bridge module: plugins/widgets/modules/bonded-widgets.
    './plugins/widgets',
    // #271 (UI-08): the launch screen uses the app's background (tokens `bg`) and follows the
    // appearance, so a dark cold start has no white frame before Today. Art (#324): the icon's two
    // mascots on transparent, readable on both backgrounds. Final launch art stays MOB-26.
    [
      'expo-splash-screen',
      {
        backgroundColor: tokens.color.light.bg,
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
        dark: { backgroundColor: tokens.color.dark.bg },
      },
    ],
  ],
  ...(easProjectId && { extra: { ...config.extra, eas: { projectId: easProjectId } } }),
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});
