import { useEffect, useRef } from 'react';
import { useSegments } from 'expo-router';
import { AppState } from 'react-native';
import * as StoreReview from 'expo-store-review';

import { track } from '@/lib/analytics';
import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * In-app review (MOB-17, D62 / MOB-85). The OS shows its own sheet (Apple SKStoreReviewController,
 * Google Play In-App Review) and decides whether it appears at all; we never show our own rating
 * UI, stars, a "do you like Bonded?" question or a "rate us" button, and never ask before it
 * (D31, D62: no review gating).
 *
 * Rules:
 * - D62: only once the app has been used on 2 different local days on this device;
 * - never in the first session: a session is a cold start, or coming back after 30 minutes in the
 *   background; the first one on this device is session 1;
 * - #68 (lead): never in a session that began signed out on this install (fresh install,
 *   onboarding, sign-in, or a sign-out and back in): only from a LATER app open;
 * - D62: never in a session that showed a paywall, an offer screen or the cancel flow, and never on
 *   a local day that showed an error screen;
 * - at most once every 120 days from our side (the OS adds its own limits);
 * - only at a happy moment: right after a reveal (20/21) or a milestone (25) is closed, never
 *   mid-task.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;
export const ASK_INTERVAL_MS = 120 * 24 * 60 * 60 * 1000;
const SESSIONS_KEY = 'sessions';
const ASKED_KEY = 'lastAskedAt';
/** The latest session in which the app was seen signed out (#68). */
const SIGNED_OUT_KEY = 'signedOutSession';
/** D62: the first local day (`YYYY-MM-DD`) the app was used here, and whether a later one followed. */
const FIRST_DAY_KEY = 'firstDay';
const SECOND_DAY_KEY = 'secondDay';
/** D62: the latest local day an error screen was shown. */
const ERROR_DAY_KEY = 'errorDay';

export type ReviewTrigger = 'reveal' | 'milestone';
/** Why a session never asks (D62). Kept on the device only, never sent. */
export type ReviewSuppression = 'paywall' | 'offer' | 'cancel';

let storage: KeyValueStorage = createKeyValueStorage('review:');

/** Tests swap the store. */
export function setReviewStorage(next: KeyValueStorage): void {
  storage = next;
}

function readNumber(key: string): number | null {
  try {
    const raw = storage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number): void {
  writeString(key, String(value));
}

function readString(key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage unavailable: the review prompt simply stays off.
  }
}

/** The device's local calendar day, `YYYY-MM-DD`. */
export function localDay(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** D62: note that the app is in use today. Remembers the first day and whether another followed. */
export function recordUseDay(now: number = Date.now()): void {
  const today = localDay(now);
  const first = readString(FIRST_DAY_KEY);
  if (first === null) writeString(FIRST_DAY_KEY, today);
  else if (first !== today && readString(SECOND_DAY_KEY) === null) {
    writeString(SECOND_DAY_KEY, today);
  }
}

/** D62: used on at least 2 different local days. */
export function usedOnTwoDays(): boolean {
  return readString(SECOND_DAY_KEY) !== null;
}

/** Session number in which a paywall, offer or cancel screen was shown (memory only). */
let suppressedSession: number | null = null;

/** D62: a paywall, an offer screen or the cancel flow showed: no prompt for the rest of the session. */
export function suppressReviewThisSession(_reason: ReviewSuppression): void {
  countColdStart();
  suppressedSession = sessionCount();
}

/** D62: an error screen showed: no prompt for the rest of this local day. */
export function markReviewErrorDay(now: number = Date.now()): void {
  writeString(ERROR_DAY_KEY, localDay(now));
}

/** Pure: may we ask now? */
export function canAskForReview(input: {
  sessions: number;
  lastAskedAt: number | null;
  now: number;
  /** The latest session that was signed out at some point (sign-in or onboarding happened in it). */
  signedOutSession?: number | null;
  /** D62: the app has been used on 2 different local days (defaults to true for the pure rule). */
  usedOnTwoDays?: boolean;
  /** D62: this session showed a paywall, an offer or the cancel flow. */
  suppressedThisSession?: boolean;
  /** D62: today showed an error screen. */
  errorToday?: boolean;
}): boolean {
  if (input.sessions < 2) return false;
  if (input.usedOnTwoDays === false) return false;
  if (input.suppressedThisSession || input.errorToday) return false;
  if (input.signedOutSession != null && input.sessions <= input.signedOutSession) return false;
  return input.lastAskedAt === null || input.now - input.lastAskedAt >= ASK_INTERVAL_MS;
}

/** Count one more session (and its local day, D62). */
export function recordSession(now: number = Date.now()): number {
  const sessions = (readNumber(SESSIONS_KEY) ?? 0) + 1;
  writeNumber(SESSIONS_KEY, sessions);
  recordUseDay(now);
  return sessions;
}

export function sessionCount(): number {
  return readNumber(SESSIONS_KEY) ?? 0;
}

let coldStartCounted = false;

/** The cold start counts once per JS runtime, whichever hook gets there first. */
function countColdStart(): void {
  if (coldStartCounted) return;
  coldStartCounted = true;
  recordSession();
}

/**
 * #68: this session saw the app signed out (fresh install, onboarding, sign-in screens, or a
 * sign-out). Remember its number: the prompt waits for a later session.
 */
export function markSignedOutSession(): void {
  countColdStart();
  writeNumber(SIGNED_OUT_KEY, sessionCount());
}

/**
 * Root layout: counts the cold start once, and each return after 30 min in the background. Pass the
 * auth status so a session that starts (or passes through) signed out never asks (#68).
 */
export function useReviewSessions(authStatus?: 'loading' | 'signedIn' | 'signedOut'): void {
  useEffect(() => {
    if (authStatus === 'signedOut') markSignedOutSession();
  }, [authStatus]);
  useEffect(() => {
    countColdStart();
    let backgroundAt: number | null = null;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt = Date.now();
      else if (state === 'active' && backgroundAt !== null) {
        if (Date.now() - backgroundAt >= SESSION_GAP_MS) recordSession();
        backgroundAt = null;
      }
    });
    return () => sub.remove();
  }, []);
}

/** Test hook: forget that the cold start was counted. */
export function resetReviewSessionsForTests(): void {
  coldStartCounted = false;
  suppressedSession = null;
  asking = false;
}

/** One request at a time: a milestone closing over a reveal must not ask twice. */
let asking = false;

/**
 * Ask the OS for its review sheet when the rules allow it. Never throws; returns whether the OS
 * was asked (it may still decide to show nothing).
 */
export async function maybeRequestReview(
  trigger: ReviewTrigger,
  now: number = Date.now(),
): Promise<boolean> {
  if (asking) return false;
  asking = true;
  try {
    // Today counts as a day of use even if the session began yesterday.
    recordUseDay(now);
    const sessions = sessionCount();
    const allowed = canAskForReview({
      sessions,
      lastAskedAt: readNumber(ASKED_KEY),
      signedOutSession: readNumber(SIGNED_OUT_KEY),
      usedOnTwoDays: usedOnTwoDays(),
      suppressedThisSession: suppressedSession !== null && suppressedSession === sessions,
      errorToday: readString(ERROR_DAY_KEY) === localDay(now),
      now,
    });
    if (!allowed) return false;
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return false;
    writeNumber(ASKED_KEY, now);
    // Analytics (MOB-24d, §3.6, D62): we asked; the OS decides whether anything shows.
    track('review_prompt_requested', { trigger });
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  } finally {
    asking = false;
  }
}

/** The OS sheet waits for the closing screen to leave (it shows over Today). */
export const REVIEW_DELAY_MS = 600;

/**
 * D62: ask after this screen closes, if it showed its happy moment (`shown`). Runs when the screen
 * leaves the stack, however it was closed; the timer outlives the screen on purpose.
 */
export function useReviewOnClose(trigger: ReviewTrigger, shown: boolean): void {
  const shownRef = useRef(false);
  if (shown) shownRef.current = true;
  useEffect(
    () => () => {
      if (shownRef.current) setTimeout(() => void maybeRequestReview(trigger), REVIEW_DELAY_MS);
    },
    [trigger],
  );
}

/** D62: mount on a paywall, offer or cancel screen; the session then never asks. */
export function useSuppressReview(reason: ReviewSuppression, active = true): void {
  useEffect(() => {
    if (active) suppressReviewThisSession(reason);
  }, [reason, active]);
}

/** D62: mount on an error screen; today then never asks. */
export function useReviewErrorDay(active: boolean): void {
  useEffect(() => {
    if (active) markReviewErrorDay();
  }, [active]);
}

/** D62: render inside an error screen (where a hook can't go); today then never asks. */
export function ReviewErrorDayMark(): null {
  useReviewErrorDay(true);
  return null;
}

/**
 * D62, which routes are a paywall or an offer: the `(offer)` group (14 gift, 15 gift opened, 16
 * paywall with its exit offer 17, 35 success) and P3 (onboarding trial paywall).
 */
export function suppressionForRoute(segments: readonly string[]): ReviewSuppression | null {
  if (segments[0] === '(offer)') return segments[1] === 'paywall' ? 'paywall' : 'offer';
  if (segments[0] === '(onboarding)' && segments[1] === 'plan' && segments[2] === 'trial') {
    return 'paywall';
  }
  return null;
}

/** Root layout: a paywall or offer route in front silences the review prompt for the session. */
export function useReviewRouteSuppression(): void {
  const segments = useSegments() as string[];
  const reason = suppressionForRoute(segments);
  useSuppressReview(reason ?? 'offer', reason !== null);
}
