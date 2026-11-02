import { create } from 'zustand';

import { createKeyValueStorage, type KeyValueStorage } from '@/lib/storage';

/**
 * Answer drafts and reveal marks (MOB-11), kept on the device in the encrypted MMKV store
 * (src/lib/storage.ts), keyed by `couple_question_id`.
 * - A draft is my unsent answer text. It is deleted once the answer is saved and on sign-out.
 * - A reveal mark says I already opened the partner's answer for that question (hold to reveal,
 *   screen 20), so Today sends me to the revealed answers (21) instead of the hold again. Ids only.
 *
 * Draft text is never logged, tracked or put in a query key. Storage failures are swallowed: the
 * in-memory state still works and the worst case is a lost draft.
 */
const DRAFTS_KEY = 'answers';
const REVEALED_KEY = 'revealed';
/** Old questions are useless: keep a few recent drafts and marks, drop the rest. */
const MAX_DRAFTS = 5;
const MAX_REVEALED = 30;

export type DraftState = {
  drafts: Record<string, string>;
  revealed: string[];
  setDraft: (coupleQuestionId: string, body: string) => void;
  clearDraft: (coupleQuestionId: string) => void;
  markRevealed: (coupleQuestionId: string) => void;
  /** Sign-out: forget every draft and mark, in memory and on disk. */
  reset: () => void;
};

function read<T>(storage: KeyValueStorage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(storage: KeyValueStorage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: keep the in-memory state.
  }
}

function remove(storage: KeyValueStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing stored, or storage unavailable.
  }
}

export function createDraftStore(storage: KeyValueStorage) {
  return create<DraftState>()((set, get) => ({
    drafts: read<Record<string, string>>(storage, DRAFTS_KEY, {}),
    revealed: read<string[]>(storage, REVEALED_KEY, []),
    setDraft: (id, body) => {
      const rest = Object.entries(get().drafts).filter(([key]) => key !== id);
      const kept = rest.slice(Math.max(0, rest.length - (MAX_DRAFTS - 1)));
      const drafts = Object.fromEntries(body ? [...kept, [id, body]] : kept);
      set({ drafts });
      if (Object.keys(drafts).length) write(storage, DRAFTS_KEY, drafts);
      else remove(storage, DRAFTS_KEY);
    },
    clearDraft: (id) => get().setDraft(id, ''),
    markRevealed: (id) => {
      if (get().revealed.includes(id)) return;
      const revealed = [...get().revealed, id].slice(-MAX_REVEALED);
      set({ revealed });
      write(storage, REVEALED_KEY, revealed);
    },
    reset: () => {
      set({ drafts: {}, revealed: [] });
      remove(storage, DRAFTS_KEY);
      remove(storage, REVEALED_KEY);
    },
  }));
}

export const useDrafts = createDraftStore(createKeyValueStorage('daily:'));

/** Called from the SIGNED_OUT handler (DataProvider). */
export function clearDrafts(): void {
  useDrafts.getState().reset();
}
