import { createCouple } from '@/features/couple/api';
import { upsertKeyDates } from '@/features/keyDates/api';
import { keyDateRows } from '@/features/keyDates/model';
import { syncPendingPurchase } from '@/features/premium/pendingPurchase';
import { deviceTimezone, updateMyProfile } from '@/features/profile/api';
import { saveRitualTime } from '@/features/push/api';
import { track } from '@/lib/analytics';
import { AppError, toAppError } from '@/lib/errors';

import { trackOnboardingFinished } from './analytics';
import { flushOnboardingAnswers, queueOnboardingAnswers } from './answerSync';
import { getDailyQuestionId, saveFirstAnswer } from './api';
import { usePendingSetup } from './pendingSetup';
import { useOnboarding } from './store';

/** The couple exists but its key dates (47) weren't saved: SetupBond can offer to go on without them. */
export class KeyDatesWriteError extends AppError {
  readonly step = 'keyDates' as const;
}

export function isKeyDatesWriteError(error: unknown): error is KeyDatesWriteError {
  return error instanceof AppError && (error as Partial<KeyDatesWriteError>).step === 'keyDates';
}

/**
 * Analytics bookkeeping across retries (a refused key-dates write runs the setup again): the
 * couple already reported as created, and the user whose T1 reached the server.
 */
let reportedCouple: string | null = null;
let t1SavedFor: string | null = null;

/** Tests: forget what was reported. */
export function resetFinishAnalyticsForTests(): void {
  reportedCouple = null;
  t1SavedFor = null;
}

export type FinishResult =
  | { kind: 'done'; coupleId: string }
  /** `create_couple` said `ALREADY_PAIRED`: nothing else was written; the local T1 is dropped. */
  | { kind: 'alreadyPaired' };

/**
 * Writes what onboarding collected, right after sign-in, in the order of CONTRACTS §2 "Finishing
 * onboarding" (D50, BE-48). Every call is safe to repeat, so a failed attempt is simply run again
 * (the local copies stay until each write succeeded):
 *
 * 0. a P3 purchase made signed out (MOB-62): `Purchases.logIn(uid)` → `revenuecat-sync`
 *    (CONTRACTS §2 step 2). Never fails the setup: an unsynced purchase stays marked and the
 *    session's RevenueCat identity retries it (`usePurchasesIdentity`);
 * 1. profile name + timezone (before the couple: it copies the profile timezone);
 * 2. `create_couple(stage, goals, partner name)`; `ALREADY_PAIRED` stops here and drops T1;
 * 3. N's ritual time → `notification_prefs.ritual_time` (also after "Not now");
 * 4. the 03/05/06 answers (questionnaire v2): queued on the phone, sent once; their failure never
 *    fails the setup (they retry on their own, MOB-37);
 * 5. T1: `get_daily_question()` (day 1 = the `first_day` question, D12), then the `answers` upsert
 *    without `client_written_at`. Written once: the local answer is dropped right after it is in,
 *    so a later retry (key dates) never sends it again, and the upsert key makes a repeat the same
 *    row anyway;
 * 6. 47's key dates (optional, MOB-28): a refused write offers "continue without dates". Since
 *    MOB-69 onboarding no longer shows 47; dates come only from 47 opened directly or an older build.
 *
 * Answer text is never logged; errors carry only the kind and a translated message.
 */
export async function finishOnboarding(input: {
  userId: string;
  skipKeyDates?: boolean;
}): Promise<FinishResult> {
  const { userId, skipKeyDates } = input;
  if (skipKeyDates) useOnboarding.getState().clearKeyDates();
  const onboarding = useOnboarding.getState();
  const { displayName, stage, goals, partnerName } = onboarding;

  await syncPendingPurchase(userId);

  if (displayName.trim()) {
    await updateMyProfile(userId, { displayName: displayName.trim(), timezone: deviceTimezone() });
  }

  let coupleId: string;
  try {
    coupleId = await createCouple({ stage, goals, partnerName: partnerName.trim() });
  } catch (error) {
    const appError = toAppError(error);
    if (appError.kind !== 'ALREADY_PAIRED') throw appError;
    usePendingSetup.getState().reset();
    return { kind: 'alreadyPaired' };
  }
  // Analytics (MOB-24d, §3.4): SetupBond created the solo couple (once, retries reuse it).
  if (reportedCouple !== coupleId) {
    reportedCouple = coupleId;
    track('solo_couple_created');
  }

  const ritual = usePendingSetup.getState().ritualTime;
  if (ritual) {
    await saveRitualTime(userId, ritual);
    if (usePendingSetup.getState().ritualTime === ritual) usePendingSetup.getState().clearRitual();
  }

  queueOnboardingAnswers(userId, onboarding);
  const answersSynced = await flushOnboardingAnswers(userId);

  const first = usePendingSetup.getState().firstAnswer;
  if (first) {
    const coupleQuestionId = await getDailyQuestionId();
    await saveFirstAnswer({ coupleQuestionId, userId, body: first.body });
    if (usePendingSetup.getState().firstAnswer === first) {
      usePendingSetup.getState().clearFirstAnswer();
    }
    t1SavedFor = userId;
  }

  const { keyDates, remindWeekBefore } = useOnboarding.getState();
  const rows = coupleId ? keyDateRows({ coupleId, userId, dates: keyDates, remindWeekBefore }) : [];
  try {
    await upsertKeyDates(rows);
  } catch (error) {
    const appError = toAppError(error);
    // A dead session goes back to auth as usual; anything else may be skipped by the person.
    if (appError.signedOut) throw appError;
    throw new KeyDatesWriteError(appError.kind, appError.message);
  }
  // Analytics (MOB-24d, §3.7): which kinds of date were saved (47); never the date or a title.
  for (const row of rows) track('key_date_added', { type: row.kind });
  trackOnboardingFinished({
    t1Saved: t1SavedFor === userId,
    answersSynced,
    returning: onboarding.returning,
  });
  t1SavedFor = null;
  return { kind: 'done', coupleId };
}
