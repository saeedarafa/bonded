import type { ConfigContext, ExpoConfig } from 'expo/config';

import tokens from '../../ui/tokens.json';

type Bytes = Uint8Array & { readUInt32BE(offset: number): number };
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as {
  existsSync(p: string): boolean;
  readFileSync(p: string): Bytes;
};
const crypto = require('crypto') as {
  createHash(alg: 'sha256'): { update(b: Bytes): { digest(enc: 'hex'): string } };
};
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * #324 (release blocker): the app icon, the Android adaptive layers and the splash art must be
 * the Bonded art from design-handoff/assets/icon, never the Expo template.
 */
// Jest runs from the repo root (as in widgets/plugin.test.ts), so paths are cwd-relative.

// sha256 of the Expo template images that shipped in assets/images before #324.
const TEMPLATE_HASHES = new Set([
  '7a667804bb80a6a424a5daf18a2599c4f32237cf06fe78fc0de45dbb09e0eccf', // icon.png
  '9e3d0315a33c6799de601dd34cd8bf8cc3a8d16f3bf75592baec2ceb7240b391', // android-icon-foreground.png
  'fb139c2dee362ebf2070e23b96da6fc0d43f8492de38b8af1fd7223e19b5861d', // android-icon-background.png
  '6371fc2c12e33ad2215a86c281db3d682a81bebe7c957a842c13b8bf00cceb83', // android-icon-monochrome.png
  '27b060a757a29038c9618586baa0ba3894dbe60d084c6059df497ff429c2d92f', // splash-icon.png
]);

type AppConfigModule = { default: (ctx: ConfigContext) => ExpoConfig };

function loadConfig(): ExpoConfig {
  let config: ExpoConfig | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../../app.config') as AppConfigModule;
    config = mod.default({ config: {} } as ConfigContext);
  });
  return config as ExpoConfig;
}

/** Width, height and PNG colour type (2 = RGB, 6 = RGBA) from the IHDR chunk. */
function pngHeader(path: string) {
  const buf = fs.readFileSync(path);
  expect(buf.readUInt32BE(12)).toBe(0x49484452); // 'IHDR'
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

function sha256(path: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

function splashImage(config: ExpoConfig): string | undefined {
  const entry = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen') as
    [string, { image?: string }] | undefined;
  return entry?.[1].image;
}

describe('app icon (#324)', () => {
  const config = loadConfig();
  const iosIcon = config.ios?.icon;
  const adaptive = config.android?.adaptiveIcon;

  const paths = [
    config.icon,
    typeof iosIcon === 'object' ? iosIcon.light : iosIcon,
    typeof iosIcon === 'object' ? iosIcon.dark : undefined,
    adaptive?.foregroundImage,
    adaptive?.backgroundImage,
    adaptive?.monochromeImage,
    splashImage(config),
  ].filter((p): p is string => typeof p === 'string');

  it('every icon and splash image exists and is not the Expo template', () => {
    expect(paths.length).toBeGreaterThanOrEqual(6);
    for (const path of paths) {
      expect(fs.existsSync(path)).toBe(true);
      expect(TEMPLATE_HASHES.has(sha256(path))).toBe(false);
    }
  });

  it('iOS icons are 1024 x 1024 without an alpha channel (App Store rule), light + dark', () => {
    expect(typeof iosIcon).toBe('object');
    if (typeof iosIcon !== 'object') return;
    expect(iosIcon.light).toBe(config.icon);
    for (const path of [iosIcon.light, iosIcon.dark]) {
      expect(pngHeader(path as string)).toEqual({ width: 1024, height: 1024, colorType: 2 });
    }
  });

  it('Android adaptive layers: transparent foreground + monochrome, background = tokens bg', () => {
    expect(adaptive?.backgroundColor).toBe(tokens.color.light.bg);
    expect(adaptive?.backgroundImage).toBeUndefined();
    for (const path of [adaptive?.foregroundImage, adaptive?.monochromeImage]) {
      const header = pngHeader(path as string);
      expect(header.colorType).toBe(6);
      expect(header.width).toBe(header.height);
    }
  });
});
