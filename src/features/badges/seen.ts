import { create } from 'zustand';

import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * Badge awards already celebrated on this device (ids only, no content), in the encrypted MMKV
 * store. A celebration (25 or 52b) marks its awards seen when it opens, so killing the app on the
 * modal never replays it. Kept across sign-out: award ids belong to one couple or user.
 */
const SEEN_KEY = 'seen';
const MAX_SEEN = 100;

export type SeenState = {
  seen: string[];
  markSeen: (ids: readonly string[]) => void;
};

export function createSeenStore(storage: KeyValueStorage) {
  let initial: string[] = [];
  try {
    const raw = storage.getItem(SEEN_KEY);
    initial = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    initial = [];
  }
  return create<SeenState>()((set, get) => ({
    seen: initial,
    markSeen: (ids) => {
      const added = ids.filter((id) => !get().seen.includes(id));
      if (!added.length) return;
      const seen = [...get().seen, ...added].slice(-MAX_SEEN);
      set({ seen });
      try {
        storage.setItem(SEEN_KEY, JSON.stringify(seen));
      } catch {
        // Storage unavailable: worst case a badge is celebrated again after a restart.
      }
    },
  }));
}

export const useSeenBadges = createSeenStore(createKeyValueStorage('badges:'));
