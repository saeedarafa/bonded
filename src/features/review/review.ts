import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as StoreReview from 'expo-store-review';

import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * In-app review (MOB-17, after the milestone modal 25). The OS shows its own sheet (Apple
 * SKStoreReviewController, Google Play In-App Review) and decides whether it appears at all; we
 * never show our own rating UI, stars or a "rate us" button (D31).
 *
 * Rules:
 * - never in the first session: a session is a cold start, or coming back after 30 minutes in the
 *   background; the first one on this device is session 1;
 * - at most once every 120 days from our side (the OS adds its own limits);
 * - only after a milestone (25) is closed, never mid-task.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;
export const ASK_INTERVAL_MS = 120 * 24 * 60 * 60 * 1000;
const SESSIONS_KEY = 'sessions';
const ASKED_KEY = 'lastAskedAt';

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
  try {
    storage.setItem(key, String(value));
  } catch {
    // Storage unavailable: the review prompt simply stays off.
  }
}

/** Pure: may we ask now? */
export function canAskForReview(input: {
  sessions: number;
  lastAskedAt: number | null;
  now: number;
}): boolean {
  if (input.sessions < 2) return false;
  return input.lastAskedAt === null || input.now - input.lastAskedAt >= ASK_INTERVAL_MS;
}

/** Count one more session. */
export function recordSession(): number {
  const sessions = (readNumber(SESSIONS_KEY) ?? 0) + 1;
  writeNumber(SESSIONS_KEY, sessions);
  return sessions;
}

export function sessionCount(): number {
  return readNumber(SESSIONS_KEY) ?? 0;
}

let coldStartCounted = false;

/** Root layout: counts the cold start once, and each return after 30 min in the background. */
export function useReviewSessions(): void {
  useEffect(() => {
    if (!coldStartCounted) {
      coldStartCounted = true;
      recordSession();
    }
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
}

/**
 * Ask the OS for its review sheet when the rules allow it. Never throws; returns whether the OS
 * was asked (it may still decide to show nothing).
 */
export async function maybeRequestReview(now: number = Date.now()): Promise<boolean> {
  try {
    const allowed = canAskForReview({
      sessions: sessionCount(),
      lastAskedAt: readNumber(ASKED_KEY),
      now,
    });
    if (!allowed) return false;
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return false;
    writeNumber(ASKED_KEY, now);
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  }
}
