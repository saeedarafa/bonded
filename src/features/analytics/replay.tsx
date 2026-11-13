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
  // Onboarding (starter only, no partner data). Not: quiz/names (names), quiz/dates (key dates),
  // plan/first-question (T1 answer), plan/yours (names).
  '(onboarding)/welcome',
  '(onboarding)/story/[step]',
  '(onboarding)/quiz/stage',
  '(onboarding)/quiz/goals',
  '(onboarding)/plan/building',
  '(onboarding)/plan/moment',
  '(onboarding)/plan/trial',
  // Sign-in (the email field is masked as an input).
  '(auth)/sign-in',
  // Paywalls and the gift (prices from RevenueCat only).
  '(offer)/paywall',
  '(offer)/success',
  '(offer)/gift',
  '(offer)/gift/opened',
  // Settings without names.
  '(pairing)/reminders',
  '(tabs)/us/notifications',
  '(tabs)/packs',
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
  'dev',
];

/** The route id for a set of segments (`index` dropped). */
export function replayRouteId(segments: readonly string[]): string {
  return segments.filter((s) => s !== 'index').join('/');
}

/** Entries of the never list that block only the route itself, not the routes under it. */
const REPLAY_NEVER_EXACT = new Set(['(tabs)/us']);

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
