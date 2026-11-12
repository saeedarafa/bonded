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
 * (pinned top-left, fitted to the screen) and resize it to the export size with macOS `sips`:
 * iPhone 1320 x 2868, Play 1080 x 1920. Files: <out>/<platform>/<nn>-<shot>.png.
 *
 * Known: the system draws the iOS home indicator / Android navigation handle over the bottom of
 * the frame (the drawn phone's lower bezel), which the app cannot hide.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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

/** sips commands that turn a raw capture into the export (none when it already matches). */
function normaliseCommands(file, pxW, pxH, platform) {
  const box = frameBox(pxW, pxH, platform);
  const out = EXPORT[platform];
  const cmds = [];
  if (box.width !== pxW || box.height !== pxH) {
    cmds.push(['sips', '--cropOffset', '0', '0', '-c', String(box.height), String(box.width), file]);
  }
  if (box.width !== out.width || box.height !== out.height) {
    cmds.push(['sips', '-z', String(out.height), String(out.width), file]);
  }
  return cmds;
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
    for (const [cmd, ...rest] of normaliseCommands(file, width, height, args.platform)) {
      run(cmd, rest);
    }
    const done = pngSize(file);
    console.log(`${file}: ${done.width} x ${done.height} (captured ${width} x ${height})`);
  }
}

module.exports = { SHOTS, FRAME, EXPORT, parseArgs, shotUrl, fileName, frameBox, normaliseCommands };

if (require.main === module) {
  try {
    capture(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
