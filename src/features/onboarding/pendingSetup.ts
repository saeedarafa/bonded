import { create } from 'zustand';

import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * MOB-61 (D50): what T1 and N collected before there is an account, kept in the encrypted MMKV
 * store (prefix `onboardingPending:`) so an app kill between T1 and sign-in loses nothing.
 *
 * - `firstAnswer`: the T1 answer to the day-1 question (D12). Sent once after sign-in by
 *   `finishOnboarding` (`get_daily_question` then the `answers` upsert, CONTRACTS §2), then
 *   dropped. Never logged, tracked or put in a query key.
 * - `ritualTime`: N's daily moment (`HH:MM`), written as `notification_prefs.ritual_time`.
 * - `reminders`: what N's buttons said (`on` = "Turn on reminders" and the OS allowed it), for L's
 *   checklist line only. The OS permission itself is the source of truth for push.
 *
 * Storage failures are swallowed: the in-memory copy still works for this launch.
 */
export type FirstAnswer = { body: string; writtenAt: string };
export type RemindersChoice = 'on' | 'off';

export type PendingSetup = {
  firstAnswer: FirstAnswer | null;
  ritualTime: string | null;
  reminders: RemindersChoice | null;
};

type PendingSetupState = PendingSetup & {
  setFirstAnswer: (body: string) => void;
  setRitual: (ritualTime: string, reminders: RemindersChoice) => void;
  clearFirstAnswer: () => void;
  clearRitual: () => void;
  reset: () => void;
};

const STORAGE_KEY = 'setup';
const EMPTY: PendingSetup = { firstAnswer: null, ritualTime: null, reminders: null };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function restore(storage: KeyValueStorage): PendingSetup {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const value = JSON.parse(raw) as Partial<PendingSetup>;
    const answer = value.firstAnswer;
    return {
      firstAnswer:
        answer &&
        typeof answer.body === 'string' &&
        answer.body &&
        typeof answer.writtenAt === 'string'
          ? { body: answer.body, writtenAt: answer.writtenAt }
          : null,
      ritualTime:
        typeof value.ritualTime === 'string' && TIME.test(value.ritualTime)
          ? value.ritualTime
          : null,
      reminders: value.reminders === 'on' || value.reminders === 'off' ? value.reminders : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function createPendingSetupStore(storage: KeyValueStorage) {
  const store = create<PendingSetupState>()((set) => ({
    ...restore(storage),
    setFirstAnswer: (body) => set({ firstAnswer: { body, writtenAt: new Date().toISOString() } }),
    setRitual: (ritualTime, reminders) => set({ ritualTime, reminders }),
    clearFirstAnswer: () => set({ firstAnswer: null }),
    clearRitual: () => set({ ritualTime: null, reminders: null }),
    reset: () => set({ ...EMPTY }),
  }));
  store.subscribe((state) => {
    const value: PendingSetup = {
      firstAnswer: state.firstAnswer,
      ritualTime: state.ritualTime,
      reminders: state.reminders,
    };
    try {
      if (value.firstAnswer || value.ritualTime || value.reminders) {
        storage.setItem(STORAGE_KEY, JSON.stringify(value));
      } else {
        storage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage unavailable: kept in memory for this launch.
    }
  });
  return store;
}

export const usePendingSetup = createPendingSetupStore(createKeyValueStorage('onboardingPending:'));

/** `HH:MM` 24-hour (what `notification_prefs.ritual_time` takes and the boards show). */
export function isRitualTime(value: string): boolean {
  return TIME.test(value);
}
