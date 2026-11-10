import {
  AuthClient,
  AuthRetryableFetchError,
  FunctionsFetchError,
  FunctionsHttpError,
} from '@supabase/supabase-js';

import {
  deleteAccount,
  getLatestEndedCouple,
  isAccountGone,
  isUserGoneError,
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
const mockGetUser = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    auth: { getUser: () => mockGetUser() },
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

/**
 * The "user is gone" signal, pinned against the real auth-js parser (2.118): a GoTrue `GET /user`
 * response is fed through `AuthClient.getUser(jwt)` with a fake fetch, so a change in how the
 * library maps the body breaks this test.
 */
describe('isUserGoneError / isAccountGone (43, security review on #132)', () => {
  function authAnswering(status: number, body: object) {
    const fetch = jest.fn(() =>
      Promise.resolve({
        ok: status < 300,
        status,
        statusText: '',
        headers: {
          get: (h: string) => (h.toLowerCase() === 'x-supabase-api-version' ? '2024-01-01' : null),
        },
        json: () => Promise.resolve(body),
      }),
    );
    return new AuthClient({
      url: 'http://auth.test/auth/v1',
      fetch: fetch as unknown as typeof globalThis.fetch,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
  }

  it('GoTrue 403 user_not_found is the only "gone" answer', async () => {
    const auth = authAnswering(403, {
      code: 'user_not_found',
      message: 'User from sub claim in JWT does not exist',
    });
    const { error } = await auth.getUser('jwt');
    expect(error).toMatchObject({ name: 'AuthApiError', status: 403, code: 'user_not_found' });
    expect(isUserGoneError(error)).toBe(true);
  });

  it.each([
    [401, { code: 'bad_jwt', message: 'invalid JWT: token is expired' }],
    [
      403,
      { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' },
    ],
    [400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' }],
    [500, { code: 'unexpected_failure', message: 'boom' }],
    [404, { message: 'User not found' }],
  ])('GoTrue %i %o is not "gone"', async (status, body) => {
    const { error } = await authAnswering(status, body).getUser('jwt');
    expect(error).not.toBeNull();
    expect(isUserGoneError(error)).toBe(false);
  });

  it('a live user, a network error or a thrown error is not "gone"', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null });
    await expect(isAccountGone()).resolves.toBe(false);
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthRetryableFetchError('Network request failed', 0),
    });
    await expect(isAccountGone()).resolves.toBe(false);
    mockGetUser.mockRejectedValueOnce(new Error('boom'));
    await expect(isAccountGone()).resolves.toBe(false);
  });

  it('Auth confirming user_not_found is "gone"', async () => {
    const { error } = await authAnswering(403, { code: 'user_not_found', message: 'x' }).getUser(
      'jwt',
    );
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error });
    await expect(isAccountGone()).resolves.toBe(true);
  });
});
