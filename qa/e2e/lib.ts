// QA-04: shared helpers for the two-simulator runners (run-pairing.ts, run-daily.ts).
// Plain TypeScript that Node 24 runs as is (type stripping).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyScenario, type Queryable } from '../scripts/seed-scenario.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const maestroDir = path.join(repoRoot, '.maestro');
export const outDir = path.join(here, 'out');
export const MAYA = '00000000-0000-4000-a000-00000000a001';
export const SAM = '00000000-0000-4000-a000-00000000a002';
export const COUPLE = '00000000-0000-4000-b000-0000000000c1';
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
export const MAESTRO = process.env.MAESTRO ?? 'maestro';

/** `flow` is relative to .maestro/ (e.g. `daily/reveal-rule-first.yaml`). */
export type Run = { flow: string; device: string; env?: Record<string, string> };
export type Result = { name: string; ok: boolean; detail?: string };

export function maestro({ flow, device, env = {} }: Run): Promise<boolean> {
  fs.mkdirSync(outDir, { recursive: true });
  const name = flow.replace(/\.yaml$/, '').replaceAll('/', '-');
  const args = ['--device', device, 'test', path.join(maestroDir, flow), '--format', 'junit',
    '--output', path.join(outDir, `${name}.xml`), '-e', `MAILPIT_URL=${MAILPIT}`];
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

/**
 * Devices of this run. seed() stops the app on each before seeding: a signed-in app left running by the
 * previous flow can write while the scenario is applied (e.g. create its own couple when its couple is
 * deleted) and break the seed with couple_members_one_active_couple_per_user.
 */
let runDevices: string[] = [];
export function useDevices(...devices: (string | undefined)[]) {
  runDevices = devices.filter((d): d is string => !!d);
}

export function stopApps() {
  for (const d of runDevices) {
    try {
      if (isIosSimulator(d)) execFileSync('xcrun', ['simctl', 'terminate', d, 'com.trybonded.app'], { stdio: 'ignore' });
      else execFileSync('adb', ['-s', d, 'shell', 'am', 'force-stop', 'com.trybonded.app'], { stdio: 'ignore' });
    } catch {
      // not running: fine
    }
  }
}

export async function seed(db: Queryable, scenario: string) {
  stopApps();
  return applyScenario(db, scenario);
}

/** Supabase CLI project id of the local stack (container names `supabase_<service>_<id>`). */
export const PROJECT_ID = process.env.SUPABASE_PROJECT_ID ?? 'bonded';
export const DOCKER = process.env.DOCKER ?? 'docker';

/**
 * QA-38c: pause (or resume) the local stack's Realtime container. At midnight nothing writes
 * `couple_questions`, so a phone hears nothing; a runner that ends a day in the database does write it,
 * and the app's couple channel then refetches Today and 19 moves to the new question before the
 * lock-in. Pausing Realtime for that step keeps the phone as uninformed as at a real midnight; REST
 * (the lock-in) is unaffected. On resume the app reconnects and refetches everything. QA-38d: opt-in
 * (`run daily -- day-ended --pause-realtime`) since #260 fixed the swap (#258).
 */
export function pauseRealtime(on: boolean) {
  execFileSync(DOCKER, [on ? 'pause' : 'unpause', `supabase_realtime_${PROJECT_ID}`], { stdio: 'ignore' });
}

/**
 * QA-24 (moved here for QA-38c, also used by run-history.ts): the pack scenario pairs maya_sam a few days ago (premium-couple: 3 days; free-couple-packs,
 * used before D51: 2), so a fresh sign-in can land on Today with the 52b badge sheet (a badge earned
 * within the last 48 h, MOB-41), correct product behaviour the pack flows don't test; it hides the
 * tab bar. Put the couple's badge awards past the 48-hour celebrate window. (The D28 win-back clock
 * this used to close is retired by D52: no `winback` offer rows or screen 36 any more.) QA-38c: history-month
 * and partner-left earn badges within 48 h too (52b covered Today on REL-A, 2026-11-11).
 */
export async function quietToday(db: Queryable) {
  await db.query(
    `update badge_awards set awarded_at = least(awarded_at, now() - interval '3 days') where couple_id = $1 or user_id in ($2, $3)`, [COUPLE, MAYA, SAM]);
}
