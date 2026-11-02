import * as Haptics from 'expo-haptics';

/**
 * Haptics per DESIGN.md §6 / tokens.haptics. One place, so the mapping can't drift:
 * - selection: hold-ring ticks, picking a plan or pill
 * - light: nudge sent, reaction tap
 * - success: reveal opens, both answered, payment done
 * - heavy: badge unlocked, 7/30/100-day milestones
 * - error: payment failed, expired or wrong code
 * Failures are swallowed: a device without a haptic engine must never break a flow.
 */
function run(fn: () => Promise<void>): void {
  void fn().catch(() => undefined);
}

export const haptics = {
  selection: () => run(() => Haptics.selectionAsync()),
  light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  heavy: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
