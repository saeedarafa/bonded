#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * MOB-26 (screens 60, 61): captures the store screenshots from a store-mode build.
 *
 *   node scripts/store/capture.js --platform ios --device <REL-A udid> [--out store-shots] [--shots today,reveal]
 *   node scripts/store/capture.js --platform android --device emulator-5554 [--out store-shots]
 *   node scripts/store/capture.js --platform ios --dry-run      # print the plan, touch nothing
 *
 * Needs a build with EXPO_PUBLIC_STORE_MODE=1 (the `store` EAS profile, or `.env` + a dev build
 * with Metro running) installed on a device that is already booted. It never boots, creates or
 * deletes a simulator (AGENTS.md): pick REL-A for iOS (iPhone 16 Pro Max = 440 x 956 pt, so the
 * capture is already 1320 x 2868) and the emulator for Android.
 *
 * For each shot: open bonded://store/<shot>?platform=<p>, wait, screenshot, then crop the frame
 * (pinned top-left, fitted to the screen; done in Node, see cropPngTopLeft) and resize it to the
 * export size with macOS `sips`:
 * iPhone 1320 x 2868, Play 1080 x 1920. Files: <out>/<platform>/<nn>-<shot>.png.
 *
 * Known: the system draws the iOS home indicator / Android navigation handle over the bottom of
 * the frame (the drawn phone's lower bezel), which the app cannot hide.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SHOTS = ['today', 'reveal', 'thread', 'feeling', 'widgets', 'milestone', 'packs', 'paywall'];
// Keep in sync with STORE_FRAME / STORE_EXPORT in src/features/store/storeMode.ts (a test checks).
const FRAME = { ios: { width: 440, height: 956 }, android: { width: 432, height: 768 } };
const EXPORT = { ios: { width: 1320, height: 2868 }, android: { width: 1080, height: 1920 } };

function parseArgs(argv) {
  const args = { platform: 'ios', out: 'store-shots', shots: SHOTS, waitMs: 2500, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--platform') args.platform = next();
    else if (a === '--device') args.device = next();
    else if (a === '--out') args.out = next();
    else if (a === '--shots') args.shots = next().split(',');
    else if (a === '--wait') args.waitMs = Number(next());
    else if (a === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  if (!(args.platform in FRAME)) throw new Error(`--platform must be ios or android`);
  const unknown = args.shots.filter((s) => !SHOTS.includes(s));
  if (unknown.length) throw new Error(`Unknown shots: ${unknown.join(', ')}`);
  if (!args.dryRun && !args.device) throw new Error('--device is required (REL-A udid or emulator-5554)');
  return args;
}

function shotUrl(shot, platform) {
  return `bonded://store/${shot}?platform=${platform}`;
}

function fileName(shot) {
  return `${String(SHOTS.indexOf(shot) + 1).padStart(2, '0')}-${shot}.png`;
}

/**
 * The frame's pixel box in a `pxW x pxH` screenshot: the route fits the frame without cropping and
 * pins it top-left, so it is width-bound or height-bound.
 */
function frameBox(pxW, pxH, platform) {
  const f = FRAME[platform];
  const scale = Math.min(pxW / f.width, pxH / f.height);
  return { width: Math.round(f.width * scale), height: Math.round(f.height * scale) };
}

/**
 * sips commands that resize the cropped frame to the export size (none when it already matches).
 * The crop itself is `cropPngTopLeft`: `sips --cropOffset 0 0` treats a zero offset as "not set"
 * and crops from the centre, which cut the caption off the Android shots (MOB-26b).
 */
function normaliseCommands(file, pxW, pxH, platform) {
  const box = frameBox(pxW, pxH, platform);
  const out = EXPORT[platform];
  if (box.width === out.width && box.height === out.height) return [];
  return [['sips', '-z', String(out.height), String(out.width), file]];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Keeps the top-left `width x height` pixels of an 8-bit, non-interlaced PNG (what `screencap` and
 * `simctl io screenshot` write). Returns the buffer unchanged when it already has that size.
 */
function cropPngTopLeft(buf, width, height) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG');
  let ihdr;
  const idat = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (!ihdr) throw new Error('PNG without IHDR');
  const srcW = ihdr.readUInt32BE(0);
  const srcH = ihdr.readUInt32BE(4);
  const [depth, colour, interlace] = [ihdr[8], ihdr[9], ihdr[12]];
  const bpp = CHANNELS[colour];
  if (depth !== 8 || !bpp || interlace !== 0) {
    throw new Error(`Unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
  }
  if (width > srcW || height > srcH) throw new Error('Crop box is larger than the image');
  if (width === srcW && height === srcH) return buf;
  const stride = srcW * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const outStride = width * bpp;
  const out = Buffer.alloc(height * (outStride + 1));
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 0xff;
      else if (filter === 2) line[x] = (line[x] + b) & 0xff;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) line[x] = (line[x] + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`Bad PNG filter ${filter}`);
    }
    line.copy(out, y * (outStride + 1) + 1, 0, outStride); // filter byte 0 (none)
    prev = line;
  }
  const header = Buffer.from(ihdr);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(out)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function pngSize(file) {
  const buf = fs.readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function capture(args) {
  const dir = path.join(args.out, args.platform);
  if (!args.dryRun) fs.mkdirSync(dir, { recursive: true });
  for (const shot of args.shots) {
    const url = shotUrl(shot, args.platform);
    const file = path.join(dir, fileName(shot));
    if (args.dryRun) {
      console.log(`${url} -> ${file} (${EXPORT[args.platform].width} x ${EXPORT[args.platform].height})`);
      continue;
    }
    if (args.platform === 'ios') {
      run('xcrun', ['simctl', 'openurl', args.device, url]);
      sleep(args.waitMs);
      run('xcrun', ['simctl', 'io', args.device, 'screenshot', '--type=png', file]);
    } else {
      run('adb', ['-s', args.device, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
      sleep(args.waitMs);
      const png = execFileSync('adb', ['-s', args.device, 'exec-out', 'screencap', '-p']);
      fs.writeFileSync(file, png);
    }
    const { width, height } = pngSize(file);
    const box = frameBox(width, height, args.platform);
    fs.writeFileSync(file, cropPngTopLeft(fs.readFileSync(file), box.width, box.height));
    for (const [cmd, ...rest] of normaliseCommands(file, width, height, args.platform)) {
      run(cmd, rest);
    }
    const done = pngSize(file);
    console.log(`${file}: ${done.width} x ${done.height} (captured ${width} x ${height})`);
  }
}

module.exports = {
  SHOTS,
  FRAME,
  EXPORT,
  parseArgs,
  shotUrl,
  fileName,
  frameBox,
  normaliseCommands,
  cropPngTopLeft,
};

if (require.main === module) {
  try {
    capture(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
