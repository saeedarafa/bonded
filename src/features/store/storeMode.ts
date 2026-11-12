/**
 * MOB-26 (screens 60, 61): store mode renders the store screenshot frames (S13-Launch-Brand,
 * StoreScreen board) at `/store/<shot>` with demo data, so a script can capture them.
 *
 * Off unless the build sets `EXPO_PUBLIC_STORE_MODE=1` (the `store` EAS profile or a local
 * `.env`). In a release bundle (`__DEV__` false) it also needs `EXPO_PUBLIC_STORE_BUILD=1`, which
 * only the `store` EAS profile sets: a local release build (`expo run:ios --configuration
 * Release`, an Xcode or Gradle archive) with a stray `EXPO_PUBLIC_STORE_MODE=1` in `.env` keeps
 * the route off. app.config.ts refuses any other EAS profile (production included) with either
 * flag, and a test checks eas.json. Store mode changes nothing else in the app: the frames are a
 * separate route with fixed demo data and no network calls.
 */
export function isStoreMode(dev: boolean = __DEV__): boolean {
  if (process.env.EXPO_PUBLIC_STORE_MODE !== '1') return false;
  return dev || process.env.EXPO_PUBLIC_STORE_BUILD === '1';
}

/** The eight shots, in the board's (and the listing description's) order. */
export const STORE_SHOT_IDS = [
  'today',
  'reveal',
  'thread',
  'feeling',
  'widgets',
  'milestone',
  'packs',
  'paywall',
] as const;
export type StoreShotId = (typeof STORE_SHOT_IDS)[number];

export const STORE_PLATFORMS = ['ios', 'android'] as const;
export type StorePlatform = (typeof STORE_PLATFORMS)[number];

export function isStoreShotId(value: unknown): value is StoreShotId {
  return typeof value === 'string' && (STORE_SHOT_IDS as readonly string[]).includes(value);
}

export function isStorePlatform(value: unknown): value is StorePlatform {
  return typeof value === 'string' && (STORE_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Export sizes from the L5 spec and the S13 board: 60 = App Store iPhone 6.9" (1320 x 2868),
 * 61 = Google Play phone (1080 x 1920, 9:16; Play allows at most 2:1).
 */
export const STORE_EXPORT: Record<StorePlatform, { width: number; height: number }> = {
  ios: { width: 1320, height: 2868 },
  android: { width: 1080, height: 1920 },
};

/**
 * Frame geometry in board px (S13-Launch-Brand `.fr.ios` / `.fr.and`, `.dev`, `.scr`). The
 * export is the frame scaled up: iOS x3 (440 x 956 = an iPhone 16 Pro Max screen in points),
 * Android x2.5. The phone screen inside is the real layout (440 x 956 pt, 412 x 915 dp), scaled
 * down to fit the drawn phone.
 */
export const STORE_FRAME = {
  ios: {
    width: 440,
    height: 956,
    paddingTop: 40,
    badge: 64,
    badgeRadius: 20,
    badgeIcon: 30,
    caption: 36,
    captionTop: 16,
    deviceTop: 226,
    deviceWidth: 380,
    deviceRadius: 56,
    screenBox: { width: 360, height: 782, radius: 46 },
    screen: { width: 440, height: 956 },
  },
  android: {
    width: 432,
    height: 768,
    paddingTop: 30,
    badge: 52,
    badgeRadius: 16,
    badgeIcon: 26,
    caption: 30,
    captionTop: 12,
    deviceTop: 176,
    deviceWidth: 350,
    deviceRadius: 44,
    screenBox: { width: 330, height: 733, radius: 34 },
    screen: { width: 412, height: 915 },
  },
} as const;

/** Bezel padding around the phone screen (`.dev` padding). */
export const STORE_BEZEL = 10;

/** Scale that fits a `w x h` box into `boxW x boxH` without cropping. */
export function fitScale(w: number, h: number, boxW: number, boxH: number): number {
  return Math.min(boxW / w, boxH / h);
}

/** `bonded://store/<shot>?platform=<platform>`: the deep link the capture script opens. */
export function storeShotUrl(shot: StoreShotId, platform: StorePlatform): string {
  return `bonded://store/${shot}?platform=${platform}`;
}
