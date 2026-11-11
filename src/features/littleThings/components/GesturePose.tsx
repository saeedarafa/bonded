import { View } from 'react-native';

import { Mascot, type MascotMood } from '@/ui';

import type { LittleThingKind } from '../model';

/**
 * Bao and Bun acting a gesture out (D48, 24d). Until MOB-66 builds the gesture moments from
 * `little-things.html` on the mascot rig (`src/ui/components/mascot/`, D32 as amended), every
 * gesture plays its closest mood (animated by MOB-31; the still pose with Reduce Motion). MOB-66
 * replaces the body of this component; nothing else changes.
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
