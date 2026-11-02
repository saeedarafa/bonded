import { createDraftStore } from '@/lib/drafts';
import type { KeyValueStorage } from '@/lib/storage';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('answer drafts (MOB-11)', () => {
  it('keeps a draft per question on disk and restores it in a new session', () => {
    const storage = memoryStorage();
    const store = createDraftStore(storage);
    store.getState().setDraft('cq-1', 'Your laugh.');
    expect(store.getState().drafts).toEqual({ 'cq-1': 'Your laugh.' });
    expect(createDraftStore(storage).getState().drafts).toEqual({ 'cq-1': 'Your laugh.' });
  });

  it('deletes the draft once the answer is saved (empty draft = no entry on disk)', () => {
    const storage = memoryStorage();
    const store = createDraftStore(storage);
    store.getState().setDraft('cq-1', 'Your laugh.');
    store.getState().clearDraft('cq-1');
    expect(store.getState().drafts).toEqual({});
    expect(storage.data.size).toBe(0);
  });

  it('keeps only the five most recent drafts', () => {
    const store = createDraftStore(memoryStorage());
    for (let i = 1; i <= 7; i += 1) store.getState().setDraft(`cq-${i}`, `draft ${i}`);
    expect(Object.keys(store.getState().drafts)).toEqual(['cq-3', 'cq-4', 'cq-5', 'cq-6', 'cq-7']);
  });

  it('remembers reveals once, by id only', () => {
    const storage = memoryStorage();
    const store = createDraftStore(storage);
    store.getState().markRevealed('cq-1');
    store.getState().markRevealed('cq-1');
    expect(store.getState().revealed).toEqual(['cq-1']);
    expect(createDraftStore(storage).getState().revealed).toEqual(['cq-1']);
  });

  it('forgets everything on sign-out', () => {
    const storage = memoryStorage();
    const store = createDraftStore(storage);
    store.getState().setDraft('cq-1', 'Your laugh.');
    store.getState().markRevealed('cq-1');
    store.getState().reset();
    expect(store.getState()).toMatchObject({ drafts: {}, revealed: [] });
    expect(storage.data.size).toBe(0);
  });

  it('survives storage that throws (no native module) and a corrupt value', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('no mmkv');
      },
      setItem: () => {
        throw new Error('no mmkv');
      },
      removeItem: () => {
        throw new Error('no mmkv');
      },
    };
    const store = createDraftStore(broken);
    store.getState().setDraft('cq-1', 'x');
    expect(store.getState().drafts).toEqual({ 'cq-1': 'x' });
    const corrupt = memoryStorage();
    corrupt.setItem('answers', '{not json');
    expect(createDraftStore(corrupt).getState().drafts).toEqual({});
  });
});
