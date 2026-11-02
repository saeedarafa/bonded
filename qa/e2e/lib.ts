// QA-04: shared helpers for the two-simulator runners (run-pairing.ts, run-daily.ts).
// Plain TypeScript that Node 24 runs as is (type stripping).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const maestroDir = path.join(repoRoot, '.maestro');
export const outDir = path.join(here, 'out');
export const MAYA = '00000000-0000-4000-a000-00000000a001';
export const SAM = '00000000-0000-4000-a000-00000000a002';
export const COUPLE = '00000000-0000-4000-b000-0000000000c1';
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
export const MAESTRO = process.env.MAESTRO ?? 'maestro';
export const D02 = process.env.D02_APPROVAL === 'true';

/** `flow` is relative to .maestro/ (e.g. `daily/reveal-rule-first.yaml`). */
export type Run = { flow: string; device: string; env?: Record<string, string> };
export type Result = { name: string; ok: boolean; detail?: string };

export function maestro({ flow, device, env = {} }: Run): Promise<boolean> {
  fs.mkdirSync(outDir, { recursive: true });
  const name = flow.replace(/\.yaml$/, '').replaceAll('/', '-');
  const args = ['--device', device, 'test', path.join(maestroDir, flow), '--format', 'junit',
    '--output', path.join(outDir, `${name}.xml`), '-e', `MAILPIT_URL=${MAILPIT}`, '-e', `D02_APPROVAL=${D02}`];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  return new Promise((resolve) => {
    const child = spawn(MAESTRO, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (e) => {
      console.error(`cannot start ${MAESTRO}: ${e.message}`);
      resolve(false);
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

/** Poll until `probe` returns non-null, or fail after `ms`. Database state, never a sleep. */
export async function waitFor<T>(what: string, ms: number, probe: () => Promise<T | null>): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await probe();
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out after ${ms / 1000}s waiting for ${what}`);
}

export async function clearMail() {
  const res = await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => null);
  if (!res || !res.ok) console.warn(`could not empty the mail catcher at ${MAILPIT} (old OTP mails may be read)`);
}

/** A Maestro `text:` selector (a full-match regex) that matches any element containing `s`. */
export function containsText(s: string): string {
  return `.*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`;
}

const isIosSimulator = (device: string) => /^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}$/i.test(device);

/**
 * Turn the OS reduce-motion setting on or off on a simulator or emulator. React Native reads it through
 * AccessibilityInfo.isReduceMotionEnabled (iOS: UIAccessibility; Android: transition animation scale 0).
 * Flows relaunch the app afterwards (launchApp clearState), so the new value is read at start.
 */
export function setReduceMotion(device: string, on: boolean) {
  if (isIosSimulator(device)) {
    execFileSync('xcrun', ['simctl', 'spawn', device, 'defaults', 'write', 'com.apple.Accessibility',
      'ReduceMotionEnabled', '-bool', on ? 'true' : 'false']);
    // Tell running processes the setting changed (same notification Settings posts).
    execFileSync('xcrun', ['simctl', 'spawn', device, 'notifyutil', '-p', 'com.apple.accessibility.reduce.motion.status']);
  } else {
    for (const key of ['transition_animation_scale', 'animator_duration_scale', 'window_animation_scale']) {
      execFileSync('adb', ['-s', device, 'shell', 'settings', 'put', 'global', key, on ? '0' : '1']);
    }
  }
}
