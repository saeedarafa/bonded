import type { ConfigContext, ExpoConfig } from 'expo/config';

// Scheme `bonded` per D30. The bundle id is the D30 placeholder until the PO decides;
// EAS / store config is MOB-02 (waits on LEAD-03 and D30).
const BUNDLE_ID = 'app.bonded.mobile';

// Invite links https://<domain>/j/BND4827?t=… open the app (D02, D07). Until the real domain is
// set (`[your-domain]` placeholder) no universal-link entries are written.
const rawDomain = (process.env.EXPO_PUBLIC_INVITE_DOMAIN ?? '').trim();
const inviteDomain = rawDomain && !/[[\]\s/]/.test(rawDomain) ? rawDomain : null;

// Google sign-in needs the reversed iOS client id as a URL scheme; the plugin throws without it,
// so it is only added once the Google Cloud project exists.
const googleIosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME?.trim();

// Expo push tokens are issued per EAS project (MOB-15). Set once `eas init` has run (MOB-02).
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();

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
    supportsTablet: false,
    usesAppleSignIn: true,
    ...(inviteDomain && { associatedDomains: [`applinks:${inviteDomain}`] }),
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#FFFFFF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    ...(inviteDomain && {
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host: inviteDomain, pathPrefix: '/j/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    }),
  },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-apple-authentication',
    // Push (MOB-15): APNs entitlement on iOS, POST_NOTIFICATIONS on Android 13+.
    'expo-notifications',
    // Voice answers (MOB-55, D46): microphone usage text on iOS, RECORD_AUDIO on Android.
    [
      'expo-audio',
      {
        microphonePermission:
          'Bonded uses the microphone only when you record a voice answer or message for your partner.',
        recordAudioAndroid: true,
      },
    ] as [string, { microphonePermission: string; recordAudioAndroid: boolean }],
    ...(googleIosUrlScheme
      ? [
          ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }] as [
            string,
            { iosUrlScheme: string },
          ],
        ]
      : []),
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFFFFF',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],
  ...(easProjectId && { extra: { ...config.extra, eas: { projectId: easProjectId } } }),
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});
