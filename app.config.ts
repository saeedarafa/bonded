import type { ConfigContext, ExpoConfig } from 'expo/config';

// Scheme `bonded` per D30. The bundle id is the D30 placeholder until the PO decides;
// EAS / store config is MOB-02 (waits on LEAD-03 and D30).
const BUNDLE_ID = 'app.bonded.mobile';

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
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#FFFFFF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  plugins: [
    'expo-router',
    'expo-localization',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFFFFF',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});
