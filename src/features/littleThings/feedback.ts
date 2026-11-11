import { createAudioPlayer, setAudioModeAsync, type AudioSource } from 'expo-audio';
import * as Haptics from 'expo-haptics';

import { KISS_MAX, type LittleThingKind } from './model';

/**
 * How a received gesture feels on Today (D48, MOB-59, 24d): one short sound and one haptic per
 * gesture. Both are fire-and-forget: a phone without a haptic engine or audio must never break
 * Today, and nothing here is logged.
 */

/**
 * LEAD-11 seam: the five in-app sounds (< 1.5 s, ~20 KB, original, PO-approved). Until the files
 * land in `assets/sounds/` this map is empty and gestures play silently. To add one:
 * `kiss: require('../../../assets/sounds/little_thing_kiss.wav')` (Metro needs a static require).
 * The same files are the iOS notification sounds (`app.config.ts` picks them up when present).
 */
export const GESTURE_SOUNDS: Partial<Record<LittleThingKind, AudioSource>> = {};

/** True once LEAD-11's sound for this gesture is bundled. */
export function hasGestureSound(kind: LittleThingKind): boolean {
  return GESTURE_SOUNDS[kind] !== undefined;
}

/**
 * Plays the gesture's sound once. The silent switch always wins (`playsInSilentMode: false`) and
 * other audio keeps playing (mixed). The player is released when the sound ends.
 */
export function playGestureSound(kind: LittleThingKind): void {
  const source = GESTURE_SOUNDS[kind];
  if (source === undefined) return;
  void (async () => {
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
    const player = createAudioPlayer(source);
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (!status.didJustFinish) return;
      sub.remove();
      player.remove();
    });
    player.play();
  })().catch(() => undefined);
}

type Step = { at: number; run: () => Promise<void> };

const light = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
const soft = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
const medium = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

/**
 * The haptic per gesture (prototype `design-handoff/prototypes/little-things.html`):
 * - kiss: two light taps per kiss (up to 5 kisses);
 * - hug: a long soft rumble, as long as the hug (soft taps every 120 ms, up to 5 s);
 * - goodnight: one slow, soft pulse;
 * - good morning: three quick light taps;
 * - miss you: thump-thump, twice.
 * Times in ms from the start. Pure, so it is unit-tested.
 */
export function hapticSteps(kind: LittleThingKind, amount: number): Step[] {
  switch (kind) {
    case 'kiss': {
      const n = Math.min(KISS_MAX, Math.max(1, amount));
      return Array.from({ length: n * 2 }, (_, i) => ({
        at: Math.floor(i / 2) * 320 + (i % 2) * 90,
        run: light,
      }));
    }
    case 'hug': {
      const ms = Math.min(5000, Math.max(600, amount));
      return Array.from({ length: Math.floor(ms / 120) }, (_, i) => ({ at: i * 120, run: soft }));
    }
    case 'goodnight':
      return [{ at: 0, run: soft }];
    case 'good_morning':
      return [0, 110, 220].map((at) => ({ at, run: light }));
    case 'miss_you':
      return [0, 180, 700, 880].map((at) => ({ at, run: medium }));
  }
}

/** Plays the gesture's haptic; returns a cancel for when Today goes away mid-pattern. */
export function playGestureHaptic(kind: LittleThingKind, amount: number): () => void {
  const timers = hapticSteps(kind, amount).map((step) =>
    setTimeout(() => void step.run().catch(() => undefined), step.at),
  );
  return () => timers.forEach(clearTimeout);
}
