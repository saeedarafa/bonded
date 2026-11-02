import { QueryClient } from '@tanstack/react-query';

import { AppError } from '@/lib/errors';
import { createQueryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import {
  allCoupleKeys,
  channelName,
  keysToInvalidate,
  REALTIME_TABLES,
  subscribeToCouple,
  type ChangePayload,
  type RealtimeClient,
} from '@/lib/realtime';

const pg = (message: string, code = 'P0001') => ({ message, code });

// Cached queries schedule a garbage-collection timer (24 h here); clear them so Jest can exit.
const clients: QueryClient[] = [];
const track = (qc: QueryClient): QueryClient => {
  clients.push(qc);
  return qc;
};
afterEach(() => {
  clients.splice(0).forEach((qc) => qc.clear());
});

describe('query client', () => {
  const run = async (error: unknown, onSignedOut?: () => void) => {
    const qc = track(createQueryClient(onSignedOut ? { onSignedOut } : {}));
    qc.setDefaultOptions({
      ...qc.getDefaultOptions(),
      queries: { ...qc.getDefaultOptions().queries, retryDelay: 0 },
    });
    let calls = 0;
    await qc
      .fetchQuery({
        queryKey: ['t'],
        queryFn: () => {
          calls += 1;
          return Promise.reject(error);
        },
      })
      .catch(() => undefined);
    return calls;
  };

  it('never retries a definite backend answer', async () => {
    expect(await run(pg('COUPLE_FULL'))).toBe(1);
    expect(await run(pg('RATE_LIMITED'))).toBe(1);
  });

  it('retries transient failures twice', async () => {
    expect(await run(new Error('Network request failed'))).toBe(3);
    expect(await run(new Error('weird'))).toBe(3);
  });

  it('retries an AppError by its kind', async () => {
    expect(await run(new AppError('NETWORK', 'offline'))).toBe(3);
    expect(await run(new AppError('NOT_PAIRED', 'no'))).toBe(1);
  });

  it('signs out once on a signed-out error from a query', async () => {
    const onSignedOut = jest.fn();
    const qc = track(createQueryClient({ onSignedOut }));
    const fail = (key: string) =>
      qc
        .fetchQuery({
          queryKey: [key],
          queryFn: () => Promise.reject(pg('permission denied', '42501')),
        })
        .catch(() => undefined);
    await Promise.all([fail('a'), fail('b')]);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('signs out on a signed-out error from a mutation, not on other errors', async () => {
    const onSignedOut = jest.fn();
    const qc = track(createQueryClient({ onSignedOut }));
    await qc
      .getMutationCache()
      .build(qc, { gcTime: 0, mutationFn: () => Promise.reject(pg('COUPLE_FULL')) })
      .execute(undefined)
      .catch(() => undefined);
    expect(onSignedOut).not.toHaveBeenCalled();
    await qc
      .getMutationCache()
      .build(qc, { gcTime: 0, mutationFn: () => Promise.reject(pg('NOT_AUTHENTICATED')) })
      .execute(undefined)
      .catch(() => undefined);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });
});

describe('query keys', () => {
  it('nest, so invalidating a parent hits its children', () => {
    expect(queryKeys.questions.detail('q1')).toEqual(['questions', 'detail', 'q1']);
    expect(queryKeys.questions.detail('q1').slice(0, 1)).toEqual(queryKeys.questions.all);
    expect(queryKeys.thread.detail('q1').slice(0, 1)).toEqual(queryKeys.thread.all);
    expect(queryKeys.thread.unread().slice(0, 1)).toEqual(queryKeys.thread.all);
    expect(queryKeys.couple.active().slice(0, 1)).toEqual(queryKeys.couple.all);
    expect(queryKeys.offer('intro')).not.toEqual(queryKeys.offer('winback'));
  });
});

describe('realtime invalidation map', () => {
  const change = (row: Record<string, unknown>): ChangePayload =>
    ({ new: row, old: {} }) as ChangePayload;

  it('couple_questions: today, history and that question', () => {
    expect(keysToInvalidate('couple_questions', change({ id: 'cq1' }))).toEqual([
      queryKeys.today.all,
      queryKeys.history.all,
      queryKeys.questions.detail('cq1'),
    ]);
  });

  it('answers: partner status on Today, the question and the streak', () => {
    const keys = keysToInvalidate('answers', change({ couple_question_id: 'cq1' }));
    expect(keys).toContainEqual(queryKeys.today.all);
    expect(keys).toContainEqual(queryKeys.questions.detail('cq1'));
    expect(keys).toContainEqual(queryKeys.streak());
  });

  it('thread messages: that thread and the unread counts; a delete reads the old row', () => {
    expect(keysToInvalidate('thread_messages', change({ couple_question_id: 'cq1' }))).toEqual([
      queryKeys.thread.detail('cq1'),
      queryKeys.thread.unread(),
    ]);
    const deleted = { new: {}, old: { couple_question_id: 'cq2' } } as ChangePayload;
    expect(keysToInvalidate('thread_messages', deleted)[0]).toEqual(queryKeys.thread.detail('cq2'));
  });

  it('falls back to the whole family when the payload has no id (RLS-trimmed delete)', () => {
    expect(keysToInvalidate('thread_messages', change({}))[0]).toEqual(queryKeys.thread.all);
    expect(keysToInvalidate('answers', change({}))).toContainEqual(queryKeys.questions.all);
  });

  it('reactions refresh questions and threads; members refresh the couple', () => {
    expect(keysToInvalidate('reactions', change({ answer_id: 'a1' }))).toEqual([
      queryKeys.questions.all,
      queryKeys.thread.all,
    ]);
    expect(keysToInvalidate('couple_members', change({}))).toContainEqual(queryKeys.couple.all);
  });

  it('handles every table in the contract', () => {
    for (const table of REALTIME_TABLES) {
      expect(keysToInvalidate(table, change({})).length).toBeGreaterThan(0);
    }
  });
});

describe('subscribeToCouple', () => {
  type Handler = (payload: ChangePayload) => void;
  function fakeClient() {
    const handlers = new Map<string, Handler>();
    const filters = new Map<string, string | undefined>();
    let onStatus: (status: string) => void = () => undefined;
    interface FakeChannel {
      on(type: string, filter: { table: string; filter?: string }, cb: Handler): FakeChannel;
      subscribe(cb: (status: string) => void): FakeChannel;
    }
    const channel: FakeChannel = {
      on: jest.fn((_type, filter, cb) => {
        handlers.set(filter.table, cb);
        filters.set(filter.table, filter.filter);
        return channel;
      }),
      subscribe: jest.fn((cb) => {
        onStatus = cb;
        return channel;
      }),
    };
    const client = {
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(() => Promise.resolve('ok')),
    };
    return {
      client: client as unknown as RealtimeClient,
      raw: client,
      handlers,
      filters,
      status: (s: string) => onStatus(s),
    };
  }

  it('opens one couple:{id} channel with every table, filtering couple_questions by couple', () => {
    const f = fakeClient();
    subscribeToCouple(f.client, track(new QueryClient()), 'couple-1');
    expect(f.raw.channel).toHaveBeenCalledTimes(1);
    expect(f.raw.channel).toHaveBeenCalledWith(channelName('couple-1'));
    expect(channelName('couple-1')).toBe('couple:couple-1');
    expect([...f.handlers.keys()].sort()).toEqual([...REALTIME_TABLES].sort());
    expect(f.filters.get('couple_questions')).toBe('couple_id=eq.couple-1');
    expect(f.filters.get('answers')).toBeUndefined();
  });

  it('only invalidates on events, never writes the payload into the cache', () => {
    const f = fakeClient();
    const qc = track(new QueryClient());
    const invalidate = jest.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const setData = jest.spyOn(qc, 'setQueryData');
    subscribeToCouple(f.client, qc, 'couple-1');
    f.handlers.get('answers')?.({
      new: { couple_question_id: 'cq1', body: 'secret' },
      old: {},
    } as ChangePayload);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.questions.detail('cq1') });
    expect(setData).not.toHaveBeenCalled();
  });

  it('refetches everything after a reconnect, not on the first connect', () => {
    const f = fakeClient();
    const qc = track(new QueryClient());
    const invalidate = jest.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    subscribeToCouple(f.client, qc, 'couple-1');
    f.status('SUBSCRIBED');
    expect(invalidate).not.toHaveBeenCalled();
    f.status('CHANNEL_ERROR');
    f.status('SUBSCRIBED');
    expect(invalidate).toHaveBeenCalledTimes(allCoupleKeys().length);
  });

  it('removes the channel on cleanup', () => {
    const f = fakeClient();
    subscribeToCouple(f.client, track(new QueryClient()), 'couple-1')();
    expect(f.raw.removeChannel).toHaveBeenCalledTimes(1);
  });
});
