import { createAudioPlayer, setAudioModeAsync, type AudioSource } from 'expo-audio';
import * as Haptics from 'expo-haptics';

import { KISS_MAX, type LittleThingKind } from './model';

/**
 * How a received gesture feels on Today (D48, MOB-59, 24d): one short sound and one haptic per
 * gesture. Both are fire-and-forget: a phone without a haptic engine or audio must never break
 * Today, and nothing here is logged.
 */

/**
 * The five in-app sounds (D48, MOB-65): original, < 1.5 s, rendered from the prototype synth by
 * `design-handoff/assets/sounds/render-sounds.mjs` (16-bit PCM WAV, mono, 11 025 Hz). The same
 * files are the iOS notification sounds and the Android channel sounds (`app.config.ts`,
 * `channels.ts`, CONTRACTS §5). Metro needs a static `require` per file.
 */
export const GESTURE_SOUNDS: Record<LittleThingKind, AudioSource> = {
  hug: require('../../../assets/sounds/little_thing_hug.wav'),
  kiss: require('../../../assets/sounds/little_thing_kiss.wav'),
  goodnight: require('../../../assets/sounds/little_thing_goodnight.wav'),
  good_morning: require('../../../assets/sounds/little_thing_good_morning.wav'),
  miss_you: require('../../../assets/sounds/little_thing_miss_you.wav'),
};

/** True when the gesture's sound is bundled (all five since MOB-65). */
export function hasGestureSound(kind: LittleThingKind): boolean {
  return GESTURE_SOUNDS[kind] !== undefined;
}

/**
 * Plays the gesture's sound once. Callers check the 41 "Little things sounds" switch first.
 * Platform norms: on iOS the silent switch always wins (`playsInSilentMode: false`, the ambient
 * category) and the ringer/media volume applies; on Android the sound plays at media volume, like
 * other in-app sounds. Other audio keeps playing (mixed). The player is released when it ends.
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

/**
 * When the sound plays within the moment on the mascot (MOB-66), ms from its start. MOB-65 cut the
 * prototype's lead-in silence from the files; the prototype starts each sound with the animation,
 * so the cut lead-in is the offset: the kiss "mwah" on each peck (one per kiss, 0.9 s apart), the
 * goodnight notes as the moon rises, the good-morning notes as the lid lifts, the heartbeats when
 * the heart reaches the other one.
 */
export function gestureSoundTimes(kind: LittleThingKind, amount: number): number[] {
  switch (kind) {
    case 'hug':
      return [0];
    case 'kiss': {
      const n = Math.min(KISS_MAX, Math.max(1, Math.round(amount)));
      return Array.from({ length: n }, (_, i) => i * 900 + 300);
    }
    case 'goodnight':
      return [200];
    case 'good_morning':
      return [500];
    case 'miss_you':
      return [750];
  }
}

/** Plays the gesture's sound in time with its moment; returns a cancel (Today going away). */
export function playGestureSoundsTimed(kind: LittleThingKind, amount: number): () => void {
  const timers = gestureSoundTimes(kind, amount).map((at) =>
    setTimeout(() => playGestureSound(kind), at),
  );
  return () => timers.forEach(clearTimeout);
}

type Step = { at: number; run: () => Promise<void> };

const light = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
const soft = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
const medium = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

/**
 * The haptic per gesture (prototype `design-handoff/prototypes/little-things.html`), in time with
 * the sound and the moment on the mascot (`gestureSoundTimes`, MOB-66):
 * - kiss: two light taps per kiss, on each peck (up to 5 kisses);
 * - hug: a long soft rumble, as long as the hug (soft taps every 120 ms, up to 5 s);
 * - goodnight: one slow, soft pulse;
 * - good morning: three quick light taps;
 * - miss you: thump-thump, twice, with the heartbeats.
 * Times in ms from the start. Pure, so it is unit-tested.
 */
export function hapticSteps(kind: LittleThingKind, amount: number): Step[] {
  const times = gestureSoundTimes(kind, amount);
  const lead = times[0] ?? 0;
  switch (kind) {
    case 'kiss':
      return times.flatMap((at) => [
        { at, run: light },
        { at: at + 90, run: light },
      ]);
    case 'hug': {
      const ms = Math.min(5000, Math.max(600, amount));
      return Array.from({ length: Math.floor(ms / 120) }, (_, i) => ({ at: i * 120, run: soft }));
    }
    case 'goodnight':
      return [{ at: lead, run: soft }];
    case 'good_morning':
      return [0, 110, 220].map((at) => ({ at: lead + at, run: light }));
    case 'miss_you':
      // The sound's four beats: 0, 0.24 s, 0.9 s, 1.14 s.
      return [0, 240, 900, 1140].map((at) => ({ at: lead + at, run: medium }));
  }
}

/** Plays the gesture's haptic; returns a cancel for when Today goes away mid-pattern. */
export function playGestureHaptic(kind: LittleThingKind, amount: number): () => void {
  const timers = hapticSteps(kind, amount).map((step) =>
    setTimeout(() => void step.run().catch(() => undefined), step.at),
  );
  return () => timers.forEach(clearTimeout);
}
