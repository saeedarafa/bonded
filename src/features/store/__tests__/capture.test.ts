import { STORE_EXPORT, STORE_FRAME, STORE_SHOT_IDS, storeShotUrl } from '../storeMode';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const capture = require('../../../../scripts/store/capture.js') as {
  SHOTS: string[];
  FRAME: Record<'ios' | 'android', { width: number; height: number }>;
  EXPORT: Record<'ios' | 'android', { width: number; height: number }>;
  parseArgs: (argv: string[]) => { platform: string; device?: string; shots: string[] };
  shotUrl: (shot: string, platform: string) => string;
  fileName: (shot: string) => string;
  frameBox: (
    w: number,
    h: number,
    platform: 'ios' | 'android',
  ) => { width: number; height: number };
  normaliseCommands: (
    file: string,
    w: number,
    h: number,
    platform: 'ios' | 'android',
  ) => string[][];
};

describe('scripts/store/capture.js (MOB-26)', () => {
  it('matches the app: shots, frame sizes, export sizes, deep links', () => {
    expect(capture.SHOTS).toEqual([...STORE_SHOT_IDS]);
    for (const p of ['ios', 'android'] as const) {
      expect(capture.FRAME[p]).toEqual({
        width: STORE_FRAME[p].width,
        height: STORE_FRAME[p].height,
      });
      expect(capture.EXPORT[p]).toEqual(STORE_EXPORT[p]);
      expect(capture.shotUrl('packs', p)).toBe(storeShotUrl('packs', p));
    }
  });

  it('names files in listing order', () => {
    expect(capture.fileName('today')).toBe('01-today.png');
    expect(capture.fileName('paywall')).toBe('08-paywall.png');
  });

  it('REL-A (iPhone 16 Pro Max, 1320 x 2868 px) needs no crop or resize', () => {
    expect(capture.normaliseCommands('a.png', 1320, 2868, 'ios')).toEqual([]);
  });

  it('a taller Android screen (1080 x 2400) is cropped to the 9:16 frame, already 1080 x 1920', () => {
    expect(capture.frameBox(1080, 2400, 'android')).toEqual({ width: 1080, height: 1920 });
    expect(capture.normaliseCommands('a.png', 1080, 2400, 'android')).toEqual([
      ['sips', '--cropOffset', '0', '0', '-c', '1920', '1080', 'a.png'],
    ]);
  });

  it('another size is cropped then resized to the export size', () => {
    // iPhone SE (750 x 1334 px): height-bound.
    const box = capture.frameBox(750, 1334, 'ios');
    expect(box.height).toBe(1334);
    expect(box.width).toBe(Math.round((440 * 1334) / 956));
    expect(capture.normaliseCommands('a.png', 750, 1334, 'ios')).toEqual([
      ['sips', '--cropOffset', '0', '0', '-c', '1334', String(box.width), 'a.png'],
      ['sips', '-z', '2868', '1320', 'a.png'],
    ]);
  });

  it('validates arguments', () => {
    expect(() => capture.parseArgs(['--platform', 'web', '--dry-run'])).toThrow(/platform/);
    expect(() => capture.parseArgs(['--shots', 'today,nope', '--dry-run'])).toThrow(/nope/);
    expect(() => capture.parseArgs(['--platform', 'ios'])).toThrow(/--device/);
    expect(capture.parseArgs(['--platform', 'android', '--device', 'emulator-5554'])).toMatchObject(
      { platform: 'android', device: 'emulator-5554', shots: [...STORE_SHOT_IDS] },
    );
  });
});
