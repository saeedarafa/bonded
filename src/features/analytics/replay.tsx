import { useSegments } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { replayEnabled } from '@/lib/analytics';

/**
 * D63 / SEC-23 A2 (MOB-87): which screens a masked session replay may show.
 *
 * An **allow-list**, not a block-list: a new screen is never recorded until someone adds it here
 * (and SEC reviews it). Every other route renders under a mask, so the recording shows one grey
 * block there (layout and timing only). On allowed routes the SDK's own masking (all text, inputs
 * and images, `REPLAY_CONFIG`) still applies.
 *
 * Route ids are expo-router segments with groups, `index` dropped: `(tabs)/packs`,
 * `(onboarding)/story/[step]`.
 */
export const REPLAY_ALLOWED_ROUTES: readonly string[] = [
  // Onboarding (starter only, no names or partner data). Not: quiz/names, quiz/dates,
  // plan/first-question, plan/yours, plan/building, plan/moment, plan/trial (see the never list).
  '(onboarding)/welcome',
  '(onboarding)/story/[step]',
  '(onboarding)/quiz/stage',
  '(onboarding)/quiz/goals',
  // Sign-in (the email field is masked as an input).
  '(auth)/sign-in',
  // The opened gift (no names; prices from RevenueCat only).
  '(offer)/gift/opened',
  // Settings without names.
  '(tabs)/us/notifications',
  // Store frames (static copy).
  'store/[shot]',
];

/**
 * Never recorded, even if someone adds them to the allow-list by mistake (a unit test checks the
 * two lists are disjoint): answers, reveal, thread, history, voice, codes and links, Us / key
 * dates / names / feedback / delete, milestones, packs detail, ended couples.
 */
export const REPLAY_NEVER_PREFIXES: readonly string[] = [
  '(tabs)/today',
  '(tabs)/history',
  'question',
  'ended',
  '(pairing)/invite',
  '(pairing)/join',
  '(pairing)/waiting',
  '(pairing)/paired',
  '(pairing)/partner-left',
  'j',
  'join',
  'auth',
  '(tabs)/us', // exact only (38 Us): see REPLAY_NEVER_EXACT
  '(tabs)/us/couple',
  '(tabs)/us/badges',
  '(tabs)/us/delete',
  '(tabs)/us/feedback',
  'milestone',
  '(tabs)/packs/[packId]',
  '(onboarding)/quiz/names',
  '(onboarding)/quiz/dates',
  '(onboarding)/plan/first-question',
  '(onboarding)/plan/yours',
  // First names (SEC review of #439): on these the name would be hidden only by the SDK's text
  // masking, not yet validated on RN/Fabric (QA-54). Back to the allow-list only after that, or
  // with just the name line wrapped in `ReplayMask`.
  '(onboarding)/plan/building', // your and your partner's name
  '(onboarding)/plan/trial', // your and your partner's name
  '(onboarding)/plan/moment', // partner's name
  '(offer)/paywall', // partner's name
  '(offer)/success', // partner's name
  '(offer)/gift', // exact only (the note, partner's name); gift/opened has no name
  '(pairing)/reminders', // partner's name
  '(tabs)/packs', // partner_name
  'dev',
];

/** The route id for a set of segments (`index` dropped). */
export function replayRouteId(segments: readonly string[]): string {
  return segments.filter((s) => s !== 'index').join('/');
}

/** Entries of the never list that block only the route itself, not the routes under it. */
const REPLAY_NEVER_EXACT = new Set(['(tabs)/us', '(offer)/gift']);

export function replayNever(route: string): boolean {
  return REPLAY_NEVER_PREFIXES.some(
    (p) => route === p || (!REPLAY_NEVER_EXACT.has(p) && route.startsWith(`${p}/`)),
  );
}

/** True when the screen may be recorded (still with all text and images masked). */
export function replayMayShow(route: string): boolean {
  if (replayNever(route)) return false;
  return REPLAY_ALLOWED_ROUTES.includes(route);
}

/**
 * The same props as the SDK's `PostHogMaskView` (PostHog RN 4.86): the SDK's no-capture label, the
 * wrapper itself hidden from TalkBack (children stay accessible), and never flattened away. Kept
 * here so the wrapper is one stable `View` whose label toggles with the route: swapping
 * `PostHogMaskView` in and out would remount the whole navigator. A unit test compares these with
 * the SDK's component.
 */
export const REPLAY_MASK_PROPS = Object.freeze({
  // The SDK's no-capture marker, not user-visible text (`importantForAccessibility: 'no'`).
  // eslint-disable-next-line no-restricted-syntax
  accessibilityLabel: 'ph-no-capture',
  importantForAccessibility: 'no',
  collapsable: false,
} as const satisfies ViewProps);

const UNMASKED_PROPS = Object.freeze({
  importantForAccessibility: 'auto',
  collapsable: false,
} as const satisfies ViewProps);

/**
 * Root boundary (app/_layout.tsx) around the navigator. Without the D63 flag it renders the
 * children as they are (no wrapper at all).
 */
export function ReplayBoundary({ children }: { children: ReactNode }) {
  if (!replayEnabled()) return <>{children}</>;
  return <RouteMask>{children}</RouteMask>;
}

function RouteMask({ children }: { children: ReactNode }) {
  const route = replayRouteId(useSegments() as string[]);
  const props = replayMayShow(route) ? UNMASKED_PROPS : REPLAY_MASK_PROPS;
  return (
    <View testID="replay-boundary" style={styles.fill} {...props}>
      {children}
    </View>
  );
}

/**
 * Always masked (when the flag is on): content that sits outside the navigator's view tree, so
 * the root boundary cannot cover it. Sheets (their own Modal window), the milestone modal, push
 * banners and toasts (partner names, answer previews, key-date titles, codes).
 */
export function ReplayMask({
  children,
  overlay = false,
}: {
  children: ReactNode;
  /** For absolutely positioned hosts (banners, toasts): fills the window, lets touches through. */
  overlay?: boolean;
}) {
  if (!replayEnabled()) return <>{children}</>;
  return (
    <View
      testID="replay-mask"
      style={overlay ? StyleSheet.absoluteFill : styles.fill}
      pointerEvents={overlay ? 'box-none' : 'auto'}
      {...REPLAY_MASK_PROPS}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
