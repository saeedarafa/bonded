import { LITTLE_THING_KINDS, type LittleThingKind } from './model';

/**
 * Little-things push sounds and Android channels (CONTRACTS §5, BE-45, MOB-59). The server picks
 * `sound: little_thing_<kind>.wav` (iOS) and `channelId: little_thing_<kind>` (Android) from the
 * newest gesture; quiet-hour pushes use `little_thing_quiet` without a sound.
 *
 * Kinds whose notification sound is bundled as `assets/sounds/little_thing_<kind>.wav` (MOB-65:
 * all five; app.config.ts bundles them through the expo-notifications plugin). Android cannot
 * change a channel's sound after it is created, so a dev build that made the channels before the
 * files landed needs a reinstall.
 */
export const BUNDLED_NOTIFICATION_SOUNDS: readonly LittleThingKind[] = LITTLE_THING_KINDS;

export type LittleThingChannel = {
  id: string;
  /** i18n key under `push.channels`. */
  nameKey: string;
  quiet: boolean;
  /** Bundled file name, or undefined for the default sound (null: no sound). */
  sound: string | null | undefined;
};

export function littleThingSoundFile(kind: LittleThingKind): string {
  return `little_thing_${kind}.wav`;
}

/** The six channels: one per gesture plus the quiet-hours one. Pure, so it is unit-tested. */
export function littleThingChannels(
  bundled: readonly LittleThingKind[] = BUNDLED_NOTIFICATION_SOUNDS,
): LittleThingChannel[] {
  const perGesture = LITTLE_THING_KINDS.map((kind) => ({
    id: `little_thing_${kind}`,
    nameKey: `little_thing_${kind}`,
    quiet: false,
    sound: bundled.includes(kind) ? littleThingSoundFile(kind) : undefined,
  }));
  return [
    ...perGesture,
    { id: 'little_thing_quiet', nameKey: 'little_thing_quiet', quiet: true, sound: null },
  ];
}
