import { screen } from '@testing-library/react-native';
import type * as ReactNative from 'react-native';

import en from '@/i18n/locales/en.json';
import { renderUi } from '@/test/render';

import personas from '../../../../qa/fixtures/personas.json';
import eas from '../../../../eas.json';
import { STORE_DEMO } from '../demo';
import { StoreFrame } from '../StoreFrame';
import StoreRoute from '../StoreRoute';
import {
  STORE_EXPORT,
  STORE_FRAME,
  STORE_PLATFORMS,
  STORE_SHOT_IDS,
  fitScale,
  isStoreMode,
  storeShotUrl,
} from '../storeMode';

const mockParams: { shot?: string; platform?: string } = {};
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native') as typeof ReactNative;
  return {
    useLocalSearchParams: () => mockParams,
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
  };
});

const ORIGINAL = process.env.EXPO_PUBLIC_STORE_MODE;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_STORE_MODE;
  else process.env.EXPO_PUBLIC_STORE_MODE = ORIGINAL;
});

/** Every string the frame draws (the rendered tree's text nodes). */
function allText(): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object' && 'children' in node) {
      walk((node as { children: unknown }).children);
    }
  };
  walk(screen.toJSON());
  return out.join('\n');
}

describe('store mode flag (MOB-26)', () => {
  it('is off unless EXPO_PUBLIC_STORE_MODE=1', () => {
    delete process.env.EXPO_PUBLIC_STORE_MODE;
    expect(isStoreMode()).toBe(false);
    process.env.EXPO_PUBLIC_STORE_MODE = 'true';
    expect(isStoreMode()).toBe(false);
    process.env.EXPO_PUBLIC_STORE_MODE = '1';
    expect(isStoreMode()).toBe(true);
  });

  it('is never set by the production or base EAS profiles, only by `store`', () => {
    const build = eas.build as Record<string, { env?: Record<string, string>; extends?: string }>;
    expect(build.base?.env?.EXPO_PUBLIC_STORE_MODE).toBeUndefined();
    expect(build.production?.env?.EXPO_PUBLIC_STORE_MODE).toBeUndefined();
    expect(build.production?.extends).toBe('base');
    expect(build.store?.env?.EXPO_PUBLIC_STORE_MODE).toBe('1');
    expect(build.store?.extends).not.toBe('production');
  });

  it('app.config.ts refuses a production build with store mode', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../../../app.config') as {
      assertNoStoreModeInProduction: (env: Record<string, string | undefined>) => void;
    };
    expect(() =>
      mod.assertNoStoreModeInProduction({
        EAS_BUILD_PROFILE: 'production',
        EXPO_PUBLIC_STORE_MODE: '1',
      }),
    ).toThrow(/production/);
    expect(() =>
      mod.assertNoStoreModeInProduction({
        EAS_BUILD_PROFILE: 'store',
        EXPO_PUBLIC_STORE_MODE: '1',
      }),
    ).not.toThrow();
    expect(() =>
      mod.assertNoStoreModeInProduction({ EAS_BUILD_PROFILE: 'production' }),
    ).not.toThrow();
  });
});

describe('export sizes (L5: 60 iPhone, 61 Android)', () => {
  it('iPhone 6.9" exports 1320 x 2868, the board frame x3', () => {
    expect(STORE_EXPORT.ios).toEqual({ width: 1320, height: 2868 });
    expect(STORE_FRAME.ios.width * 3).toBe(1320);
    expect(STORE_FRAME.ios.height * 3).toBe(2868);
  });

  it('Play phone exports 1080 x 1920 (9:16), the board frame x2.5, within the 2:1 maximum', () => {
    expect(STORE_EXPORT.android).toEqual({ width: 1080, height: 1920 });
    expect(STORE_FRAME.android.width * 2.5).toBe(1080);
    expect(STORE_FRAME.android.height * 2.5).toBe(1920);
    const { width, height } = STORE_EXPORT.android;
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(2);
  });

  it('fits a frame to a device window without cropping', () => {
    // iPhone 16 Pro Max (REL-A): 440 x 956 pt, so the iOS frame fills it at x1.
    expect(fitScale(440, 956, 440, 956)).toBe(1);
    // Android emulator 411 x 914 dp: width-bound.
    expect(fitScale(432, 768, 411, 914)).toBeCloseTo(411 / 432);
  });

  it('has a deep link per shot', () => {
    expect(storeShotUrl('reveal', 'android')).toBe('bonded://store/reveal?platform=android');
  });
});

describe('demo data', () => {
  it('uses the QA test personas (Maya views, Sam is the partner)', () => {
    expect(STORE_DEMO.me).toBe(personas.personas.maya.display_name);
    expect(STORE_DEMO.partner).toBe(personas.personas.sam.display_name);
  });
});

describe.each(STORE_PLATFORMS)('StoreFrame %s', (platform) => {
  it.each(STORE_SHOT_IDS)('%s: board caption, no price, no rating', async (shot) => {
    await renderUi(<StoreFrame shot={shot} platform={platform} />);
    expect(screen.getByTestId(`store-frame-${platform}-${shot}`)).toBeTruthy();
    expect(screen.getByTestId('store-caption')).toHaveTextContent(en.store.captions[shot]);
    if (shot !== 'feeling') expect(screen.getByTestId(`store-screen-${shot}`)).toBeTruthy();
    const text = allText();
    expect(text).toContain(en.store.captions[shot]);
    // Prices only come from RevenueCat offerings: no currency, no amounts, no placeholder.
    expect(text).not.toMatch(
      /[$€£¥₹]|\bUSD\b|\bEUR\b|\d+[.,]\d{2}\b|\[PRICE\]|\/\s?(?:mo|month|yr|year)\b/i,
    );
    // No ratings or reviews.
    expect(text).not.toMatch(/★|☆|\brating|\breview|\bstars?\b/i);
  });

  it('the lock frame never shows the partner answer text (reveal rule)', async () => {
    await renderUi(<StoreFrame shot="reveal" platform={platform} />);
    expect(allText()).not.toContain(en.store.thread.answer);
    expect(screen.getByText(en.store.reveal.locked)).toBeTruthy();
  });

  it('the plan frame keeps the board copy but no price', async () => {
    await renderUi(<StoreFrame shot="paywall" platform={platform} />);
    expect(screen.getByText(en.store.paywall.yearly)).toBeTruthy();
    expect(screen.getByText(en.store.paywall.monthly)).toBeTruthy();
    expect(screen.getByText(en.store.paywall.cta)).toBeTruthy();
  });

  it('the feeling frame has no phone, only Bao and Bun and the pops', async () => {
    await renderUi(<StoreFrame shot="feeling" platform={platform} />);
    expect(screen.queryByTestId('store-screen-feeling')).toBeNull();
    expect(screen.getByText('12 days')).toBeTruthy();
    expect(screen.getByText(en.store.pops.badgeUnlocked)).toBeTruthy();
  });
});

describe('/store/[shot] route', () => {
  it('sends every non-store build home', async () => {
    delete process.env.EXPO_PUBLIC_STORE_MODE;
    mockParams.shot = 'today';
    mockParams.platform = 'ios';
    await renderUi(<StoreRoute />);
    expect(screen.getByTestId('redirect')).toHaveTextContent('/');
    expect(screen.queryByTestId('store-route')).toBeNull();
  });

  it('sends an unknown shot home, even in store mode', async () => {
    process.env.EXPO_PUBLIC_STORE_MODE = '1';
    mockParams.shot = 'nope';
    await renderUi(<StoreRoute />);
    expect(screen.getByTestId('redirect')).toBeTruthy();
  });

  it('shows the frame in store mode (Android when asked, iOS by default)', async () => {
    process.env.EXPO_PUBLIC_STORE_MODE = '1';
    mockParams.shot = 'thread';
    mockParams.platform = 'android';
    await renderUi(<StoreRoute />);
    expect(screen.getByTestId('store-frame-android-thread')).toBeTruthy();
    screen.unmount();
    mockParams.platform = undefined;
    await renderUi(<StoreRoute />);
    expect(screen.getByTestId('store-frame-ios-thread')).toBeTruthy();
  });
});
