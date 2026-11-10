import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import {
  deleteAccount,
  getLatestEndedCouple,
  getNotificationPrefs,
  saveNotificationPrefs,
  updateCoupleSettings,
} from '@/features/settings/api';

// A chainable query builder: every filter returns itself; the awaited end returns `mockResult`.
let mockResult: { data: unknown; error: unknown } = { data: null, error: null };
const mockCalls: [string, unknown[]][] = [];
function mockBuilder(): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'not', 'order', 'limit', 'update', 'upsert']) {
    b[name] = (...args: unknown[]) => {
      mockCalls.push([name, args]);
      return b;
    };
  }
  b.maybeSingle = () => Promise.resolve(mockResult);
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(mockResult).then(resolve);
  return b;
}
const mockFrom = jest.fn((_table: string) => mockBuilder());
const mockInvoke = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockResult = { data: null, error: null };
});

describe('notification prefs (CONTRACTS §2)', () => {
  it('reads my row', async () => {
    mockResult = { data: { replies: true }, error: null };
    await expect(getNotificationPrefs()).resolves.toEqual({ replies: true });
    expect(mockFrom).toHaveBeenCalledWith('notification_prefs');
  });

  it('upserts only the changed columns on user_id', async () => {
    await saveNotificationPrefs('u1', { quiet_start: '22:00', quiet_end: '07:00' });
    expect(mockCalls).toContainEqual([
      'upsert',
      [{ user_id: 'u1', quiet_start: '22:00', quiet_end: '07:00' }, { onConflict: 'user_id' }],
    ]);
  });

  it('a failure is an AppError', async () => {
    mockResult = { data: null, error: { message: 'Network request failed' } };
    await expect(saveNotificationPrefs('u1', { tips: true })).rejects.toMatchObject({
      kind: 'NETWORK',
    });
  });
});

describe('couple settings', () => {
  it('updates stage/goals of my couple only', async () => {
    await updateCoupleSettings('c1', { goals: ['romance'] });
    expect(mockFrom).toHaveBeenCalledWith('couples');
    expect(mockCalls).toEqual([
      ['update', [{ goals: ['romance'] }]],
      ['eq', ['id', 'c1']],
    ]);
  });
});

describe('getLatestEndedCouple (58)', () => {
  it('asks for the newest ended couple that had a partner', async () => {
    mockResult = { data: { id: 'c-old' }, error: null };
    await expect(getLatestEndedCouple()).resolves.toEqual({ id: 'c-old' });
    expect(mockCalls).toContainEqual(['eq', ['status', 'ended']]);
    expect(mockCalls).toContainEqual(['not', ['paired_at', 'is', null]]);
    expect(mockCalls).toContainEqual(['order', ['ended_at', { ascending: false }]]);
  });
});

describe('deleteAccount (43, BE-16)', () => {
  it('calls the function and accepts {ok:true}', async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(deleteAccount()).resolves.toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith('delete-account', { method: 'POST', body: {} });
  });

  it('a 200 without ok is not success', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await expect(deleteAccount()).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });

  it('no connection is NETWORK', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new FunctionsFetchError('x') });
    await expect(deleteAccount()).rejects.toMatchObject({ kind: 'NETWORK' });
  });

  it('401 is SIGNED_OUT, 500 DELETE_FAILED is the generic message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError({ status: 401 }),
    });
    await expect(deleteAccount()).rejects.toMatchObject({ kind: 'SIGNED_OUT' });
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError({ status: 500 }),
    });
    await expect(deleteAccount()).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });
});
