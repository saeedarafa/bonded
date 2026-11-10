import { create } from 'zustand';

import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

import type { EndedCouple } from './api';

/**
 * Screen 58 "Sam has unpaired" shows once per ended couple on this device (ids only, in the
 * encrypted MMKV store). My own unpair (42) marks the couple first, so I never see 58 for a bond
 * I ended myself here.
 */
const KEY = 'seen';
const MAX = 20;

export type EndedSeenState = {
  seen: string[];
  markSeen: (coupleId: string) => void;
  /** My own unpair failed: the couple is still active, so a later partner unpair must show 58. */
  unmark: (coupleId: string) => void;
};

export function createEndedSeenStore(storage: KeyValueStorage) {
  let initial: string[] = [];
  try {
    const raw = storage.getItem(KEY);
    initial = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    initial = [];
  }
  return create<EndedSeenState>()((set, get) => ({
    seen: initial,
    markSeen: (coupleId) => {
      if (get().seen.includes(coupleId)) return;
      const seen = [...get().seen, coupleId].slice(-MAX);
      set({ seen });
      try {
        storage.setItem(KEY, JSON.stringify(seen));
      } catch {
        // Storage unavailable: worst case 58 shows once more after a restart.
      }
    },
    unmark: (coupleId) => {
      if (!get().seen.includes(coupleId)) return;
      const seen = get().seen.filter((id) => id !== coupleId);
      set({ seen });
      try {
        storage.setItem(KEY, JSON.stringify(seen));
      } catch {
        // Storage unavailable: the in-memory list is still right for this session.
      }
    },
  }));
}

export const useEndedSeen = createEndedSeenStore(createKeyValueStorage('ended:'));

/** The ended couple to tell me about on 58, or null (none, or already seen on this device). */
export function partnerLeftCouple(
  ended: EndedCouple | null | undefined,
  seen: readonly string[],
): EndedCouple | null {
  if (!ended || !ended.paired_at || seen.includes(ended.id)) return null;
  return ended;
}

/** The other member of an ended couple, if their row still exists (gone after account deletion). */
export function formerPartnerId(ended: EndedCouple | null, myId: string | null): string | null {
  return ended?.couple_members.find((m) => m.user_id !== myId)?.user_id ?? null;
}
