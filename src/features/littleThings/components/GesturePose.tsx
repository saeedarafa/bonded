import { View } from 'react-native';

import { Mascot, type MascotMood } from '@/ui';

import type { LittleThingKind } from '../model';

/**
 * LEAD-11 seam: Bao and Bun acting a gesture out (D48, 24d). The Rive gesture poses (D32) are not
 * in `design-handoff/assets/` yet, so every gesture shows its closest still mood, which is also
 * the Reduce Motion pose. When the Rive file lands, this component plays the gesture's animation
 * (still final pose with Reduce Motion) and nothing else changes.
 * Decorative: the bubble's text says what happened.
 */
export const GESTURE_MOOD: Record<LittleThingKind, MascotMood> = {
  hug: 'snuggled',
  kiss: 'celebrating',
  goodnight: 'napping',
  good_morning: 'together',
  miss_you: 'saving-a-seat',
};

export function GesturePose({ kind, size }: { kind: LittleThingKind; size: number }) {
  return (
    <View
      testID={`24d-pose-${kind}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Mascot mood={GESTURE_MOOD[kind]} size={size} />
    </View>
  );
}
