import { createOutboxStore, type OutboxItem } from '@/lib/outbox';
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

const message = (clientId: string, status: OutboxItem['status']): OutboxItem => ({
  clientId,
  coupleQuestionId: 'cq-1',
  body: 'See you at eight',
  createdAt: `2026-11-02T20:0${clientId.length % 10}:00Z`,
  status,
});

const answer = (coupleQuestionId: string, clientWrittenAt = '2026-11-02T22:30:00Z') => ({
  coupleQuestionId,
  userId: 'u1',
  body: 'Coffee before you go.',
  clientWrittenAt,
});

describe('persisted offline queue (MOB-14)', () => {
  it('keeps a failed thread message and its client_id across a restart', () => {
    const storage = memoryStorage();
    const store = createOutboxStore(storage);
    store.getState().put(message('c-1', 'sending'));
    store.getState().setStatus('c-1', 'failed');
    const restarted = createOutboxStore(storage);
    expect(restarted.getState().items['c-1']).toEqual(message('c-1', 'failed'));
  });

  it('after a restart, a message that was sending is "Not sent" and a sent one is gone', () => {
    const storage = memoryStorage();
    const store = createOutboxStore(storage);
    store.getState().put(message('c-1', 'sending'));
    store.getState().put(message('c-22', 'sent'));
    const restarted = createOutboxStore(storage).getState();
    expect(restarted.items['c-1']?.status).toBe('failed');
    expect(restarted.items['c-22']).toBeUndefined();
  });

  it('queues one answer per question with the time it was written, and survives a restart', () => {
    const storage = memoryStorage();
    const store = createOutboxStore(storage);
    store.getState().queueAnswer(answer('cq-1', '2026-11-02T22:30:00Z'));
    store.getState().queueAnswer(answer('cq-1', '2026-11-02T22:31:00Z'));
    expect(Object.keys(store.getState().answers)).toEqual(['cq-1']);
    store.getState().setAnswerStatus('cq-1', 'sending');
    const restarted = createOutboxStore(storage).getState();
    expect(restarted.answers['cq-1']).toEqual({
      ...answer('cq-1', '2026-11-02T22:31:00Z'),
      status: 'queued',
    });
  });

  it('keeps the error kind of a failed answer, and clears it when queued again', () => {
    const store = createOutboxStore(memoryStorage());
    store.getState().queueAnswer(answer('cq-1'));
    store.getState().setAnswerStatus('cq-1', 'failed', 'NOT_PAIRED');
    expect(store.getState().answers['cq-1']?.errorKind).toBe('NOT_PAIRED');
    store.getState().setAnswerStatus('cq-1', 'queued');
    expect(store.getState().answers['cq-1']).not.toHaveProperty('errorKind');
  });

  it('keeps only the newest five answers', () => {
    const store = createOutboxStore(memoryStorage());
    for (let i = 1; i <= 7; i += 1) {
      store.getState().queueAnswer(answer(`cq-${i}`, `2026-11-0${i}T10:00:00Z`));
    }
    expect(Object.keys(store.getState().answers).sort()).toEqual([
      'cq-3',
      'cq-4',
      'cq-5',
      'cq-6',
      'cq-7',
    ]);
  });

  it('sign-out wipes the queue in memory and on disk', () => {
    const storage = memoryStorage();
    const store = createOutboxStore(storage);
    store.getState().put(message('c-1', 'failed'));
    store.getState().queueAnswer(answer('cq-1'));
    expect(storage.data.size).toBe(2);
    store.getState().reset();
    expect(store.getState().items).toEqual({});
    expect(store.getState().answers).toEqual({});
    expect(storage.data.size).toBe(0);
    expect(createOutboxStore(storage).getState().answers).toEqual({});
  });

  it('starts empty when the stored queue is corrupt', () => {
    const storage = memoryStorage();
    storage.setItem('answers', '{not json');
    expect(createOutboxStore(storage).getState().answers).toEqual({});
  });
});
