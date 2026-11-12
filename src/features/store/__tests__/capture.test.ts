import { deflateSync, inflateSync } from 'node:zlib';

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
  cropPngTopLeft: (buf: Buffer, width: number, height: number) => Buffer;
};

/** A tiny RGBA PNG whose pixel (x, y) is [x, y, row filter, 255], each row with its own filter. */
function makePng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const stride = width * 4;
  const rows: Buffer[] = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = y % 5; // none, sub, up, average, paeth
    const line = Buffer.alloc(stride);
    for (let x = 0; x < width; x += 1) line.set([x, y, filter, 255], x * 4);
    const enc = Buffer.alloc(stride + 1);
    enc[0] = filter;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? line[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      const p = a + b - c;
      const pred = [
        0,
        a,
        b,
        (a + b) >> 1,
        Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
          ? a
          : Math.abs(p - b) <= Math.abs(p - c)
            ? b
            : c,
      ][filter];
      enc[i + 1] = (line[i] - pred) & 0xff;
    }
    rows.push(enc);
    prev = line;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Decodes a PNG written by cropPngTopLeft (filter 0 rows only). */
function readPixels(png: Buffer) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  let off = 8;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    if (png.toString('ascii', off + 4, off + 8) === 'IDAT') {
      idat.push(png.subarray(off + 8, off + 8 + len));
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = (x: number, y: number) => {
    const start = y * (width * 4 + 1);
    expect(raw[start]).toBe(0);
    return [...raw.subarray(start + 1 + x * 4, start + 1 + x * 4 + 4)];
  };
  return { width, height, px };
}

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
    // No sips crop: `--cropOffset 0 0` crops from the centre (MOB-26b), see cropPngTopLeft.
    expect(capture.normaliseCommands('a.png', 1080, 2400, 'android')).toEqual([]);
  });

  it('another size is cropped then resized to the export size', () => {
    // iPhone SE (750 x 1334 px): height-bound.
    const box = capture.frameBox(750, 1334, 'ios');
    expect(box.height).toBe(1334);
    expect(box.width).toBe(Math.round((440 * 1334) / 956));
    expect(capture.normaliseCommands('a.png', 750, 1334, 'ios')).toEqual([
      ['sips', '-z', '2868', '1320', 'a.png'],
    ]);
  });

  it('MOB-26b: crops the top-left box (not the centre), decoding every PNG row filter', () => {
    const src = makePng(9, 16);
    const out = capture.cropPngTopLeft(src, 6, 10);
    const { width, height, px } = readPixels(out);
    expect([width, height]).toEqual([6, 10]);
    // Pixel (x, y) keeps its own coordinates: the first row is the source's first row.
    expect(px(0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(5, 0)).toEqual([5, 0, 0, 255]);
    for (let y = 0; y < 10; y += 1) {
      expect(px(3, y)).toEqual([3, y, y % 5, 255]);
    }
    expect(px(5, 9)).toEqual([5, 9, 4, 255]);
  });

  it('MOB-26b: leaves a PNG of the right size untouched and rejects a larger box', () => {
    const src = makePng(4, 4);
    expect(capture.cropPngTopLeft(src, 4, 4)).toBe(src);
    expect(() => capture.cropPngTopLeft(src, 5, 4)).toThrow(/larger/);
    expect(() => capture.cropPngTopLeft(Buffer.from('nope'), 1, 1)).toThrow(/PNG/);
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
