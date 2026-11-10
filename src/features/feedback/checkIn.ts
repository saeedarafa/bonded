import { create } from 'zustand';

import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * When this device last asked for the monthly check-in (26), per user. A time only: the score
 * itself is only in the server row.
 */
const KEY = 'asked';

export type CheckInState = {
  asked: Record<string, number>;
  lastAskedAt: (userId: string) => number | null;
  markAsked: (userId: string, at: number) => void;
};

export function createCheckInStore(storage: KeyValueStorage) {
  let initial: Record<string, number> = {};
  try {
    const raw = storage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') initial = parsed as Record<string, number>;
  } catch {
    initial = {};
  }
  return create<CheckInState>()((set, get) => ({
    asked: initial,
    lastAskedAt: (userId) => {
      const n = get().asked[userId];
      return typeof n === 'number' && Number.isFinite(n) ? n : null;
    },
    markAsked: (userId, at) => {
      const asked = { ...get().asked, [userId]: at };
      set({ asked });
      try {
        storage.setItem(KEY, JSON.stringify(asked));
      } catch {
        // Storage unavailable: worst case it asks again after a restart, a month later at most.
      }
    },
  }));
}

export const useCheckIn = createCheckInStore(createKeyValueStorage('checkin:'));
