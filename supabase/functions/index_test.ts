import { assertEquals } from 'jsr:@std/assert@1';
import { requireSecret, requireUser } from './_shared/auth.ts';
import { error, json } from './_shared/http.ts';
import { redact } from './_shared/log.ts';
import { type ExpoMessage, sendExpoPush } from './_shared/push.ts';
import { inQuietHours, suppression } from './_shared/rules.ts';
import { handle as notify } from './notify/index.ts';
import { handle as reminder } from './daily-reminder/index.ts';
import { handle as revenuecat } from './revenuecat/index.ts';
import { handle as deleteAccount } from './delete-account/index.ts';

const adminForDeleteAccount = (
  deleteUser: (userId: string) => Promise<{ error: { code?: string; status?: number } | null }>,
  remove: (paths: string[]) => Promise<{ error: unknown | null }> = (_paths) =>
    Promise.resolve({ error: null }),
  buckets: string[] = [],
) =>
() => ({
  auth: { admin: { deleteUser } },
  storage: {
    from: (bucket: string) => {
      buckets.push(bucket);
      return { remove };
    },
  },
});

// Captures console output so a test can assert no user id or error detail is logged.
const captureConsole = async <T>(run: () => Promise<T>): Promise<{ result: T; logged: string }> => {
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originals = methods.map((name) => console[name]);
  for (const name of methods) {
    console[name] = (...args: unknown[]) => lines.push(args.map((arg) => String(arg)).join(' '));
  }
  try {
    return { result: await run(), logged: lines.join('\n') };
  } finally {
    methods.forEach((name, index) => (console[name] = originals[index]));
  }
};

Deno.test('shared HTTP responses have the contract JSON shape', async () => {
  const ok = json({ ok: true });
  assertEquals(ok.status, 200);
  assertEquals(await ok.json(), { ok: true });
  const unauthorized = error('UNAUTHORIZED', 'Unauthorized', 401);
  assertEquals(await unauthorized.json(), { error: 'UNAUTHORIZED', message: 'Unauthorized' });
});

Deno.test('internal secrets require the exact bearer secret', async () => {
  const getEnv = (name: string) => name === 'INTERNAL_FUNCTION_SECRET' ? 'secret' : undefined;
  assertEquals(
    await requireSecret(
      new Request('http://test', { headers: { authorization: 'Bearer secret' } }),
      'INTERNAL_FUNCTION_SECRET',
      getEnv,
    ),
    true,
  );
  assertEquals(
    await requireSecret(
      new Request('http://test', { headers: { authorization: 'Bearer nope' } }),
      'INTERNAL_FUNCTION_SECRET',
      getEnv,
    ),
    false,
  );
  assertEquals(
    await requireSecret(new Request('http://test'), 'INTERNAL_FUNCTION_SECRET', getEnv),
    false,
  );
});

Deno.test('user authentication delegates only a bearer token', async () => {
  assertEquals(
    await requireUser(
      new Request('http://test', { headers: { authorization: 'Bearer jwt' } }),
      (token) => Promise.resolve(token === 'jwt' ? 'user-id' : null),
    ),
    'user-id',
  );
  assertEquals(
    await requireUser(new Request('http://test'), () => Promise.resolve('user-id')),
    null,
  );
});

Deno.test('redaction removes user text from structured metadata', () => {
  assertEquals(redact({ body: 'answer', nested: { message: 'thread', safe: 'id' } }), {
    body: '[redacted]',
    nested: { message: '[redacted]', safe: 'id' },
  });
});

Deno.test('Expo push batches at 100 and reports invalid tokens', async () => {
  const messages: ExpoMessage[] = Array.from(
    { length: 101 },
    (_, index) => ({ to: `token-${index}`, data: { type: 'test', url: 'bonded://today' } }),
  );
  const calls: ExpoMessage[][] = [];
  const result = await sendExpoPush(messages, (_input, init) => {
    const batch = JSON.parse(String(init?.body)) as ExpoMessage[];
    calls.push(batch);
    return Promise.resolve(Response.json({
      data: batch.map((_, index) =>
        index === 0
          ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok' }
      ),
    }));
  });
  assertEquals(calls.map((batch) => batch.length), [100, 1]);
  assertEquals(result.tickets.length, 101);
  assertEquals(result.invalidTokens, ['token-0', 'token-100']);
});

Deno.test('notify rules apply quiet hours, four-per-day caps, type caps, and grouping with a fake clock', () => {
  assertEquals(inQuietHours('02:00', '23:00', '07:00'), true);
  assertEquals(inQuietHours('07:00', '23:00', '07:00'), false);
  const base = {
    type: 'partner_answered',
    localTime: '12:00',
    quietStart: '23:00',
    quietEnd: '07:00',
    preferenceEnabled: true,
    dailyCount: 0,
    typeCount: 0,
    typeCap: 1,
    groupedCount: 0,
  };
  assertEquals(suppression(base), null);
  assertEquals(suppression({ ...base, dailyCount: 4 }), 'daily_cap');
  assertEquals(suppression({ ...base, typeCount: 1 }), 'type_cap');
  assertEquals(suppression({ ...base, localTime: '23:30' }), 'quiet_hours');
  assertEquals(
    suppression({ ...base, type: 'thread_activity', typeCap: null, groupedCount: 1 }),
    'grouped',
  );
});

Deno.test('notify returns 500 when the atomic claim RPC fails', async () => {
  const recipient = '00000000-0000-0000-0000-000000000004';
  const countQuery = {
    eq: () => countQuery,
    in: () => Promise.resolve({ count: 0 }),
  };
  const admin = {
    from: (table: string) => {
      if (table === 'couple_members') {
        return {
          select: () => ({
            eq: () => ({ is: () => Promise.resolve({ data: [{ user_id: recipient }] }) }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: { timezone: 'UTC' } }) }),
          }),
        };
      }
      if (table === 'notification_prefs') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { quiet_start: '23:00:00', quiet_end: '07:00:00', partner_answered: true },
                }),
            }),
          }),
        };
      }
      return { select: () => countQuery };
    },
    rpc: () => Promise.resolve({ data: null, error: { message: 'missing claim RPC' } }),
  };
  const response = await notify(
    new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({
        type: 'partner_answered',
        record_id: '00000000-0000-0000-0000-000000000001',
        couple_id: '00000000-0000-0000-0000-000000000002',
        couple_question_id: null,
        actor_user_id: '00000000-0000-0000-0000-000000000003',
      }),
    }),
    () => Promise.resolve(true),
    { admin: admin as never, now: () => new Date('2026-11-02T12:00:00Z') },
  );
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: 'INTERNAL_ERROR',
    message: 'Notification claim failed',
  });
});

Deno.test('function stubs enforce their caller-specific authentication', async () => {
  const allowInternal = () => Promise.resolve(true);
  const denyInternal = () => Promise.resolve(false);
  assertEquals((await notify(new Request('http://test'), denyInternal)).status, 401);
  assertEquals(
    await (await notify(
      new Request('http://test', {
        method: 'POST',
        body: JSON.stringify({
          type: 'partner_answered',
          record_id: '00000000-0000-0000-0000-000000000001',
          couple_id: '00000000-0000-0000-0000-000000000002',
          couple_question_id: null,
          actor_user_id: '00000000-0000-0000-0000-000000000003',
        }),
      }),
      allowInternal,
      {
        admin: {
          from: () => ({
            select: () => ({ eq: () => ({ is: () => Promise.resolve({ data: [] }) }) }),
          }),
        } as never,
      },
    )).json(),
    {
      sent: 0,
      suppressed: 0,
    },
  );
  assertEquals(await (await reminder(new Request('http://test'), allowInternal)).json(), {
    sent: 0,
  });
  assertEquals((await revenuecat(new Request('http://test'), denyInternal)).status, 401);
  assertEquals(await (await revenuecat(new Request('http://test'), allowInternal)).json(), {
    ok: true,
  });
  assertEquals(
    (await deleteAccount(new Request('http://test'), () => Promise.resolve(null))).status,
    401,
  );
  assertEquals(
    await (await deleteAccount(
      new Request('http://test'),
      () => Promise.resolve('user-id'),
      adminForDeleteAccount(() => Promise.resolve({ error: null })),
    ))
      .json(),
    { ok: true },
  );
});

Deno.test('delete-account deletes only the authenticated user and retries a missing user', async () => {
  const deleted: string[] = [];
  const admin = adminForDeleteAccount((userId) => {
    deleted.push(userId);
    return Promise.resolve({ error: { status: 404, code: 'USER_NOT_FOUND' } });
  });
  const response = await deleteAccount(
    new Request('http://test'),
    () => Promise.resolve('authenticated-user'),
    admin,
  );
  assertEquals(await response.json(), { ok: true });
  assertEquals(deleted, ['authenticated-user']);
});

Deno.test('delete-account reports an admin deletion failure without exposing details', async () => {
  const response = await deleteAccount(
    new Request('http://test'),
    () => Promise.resolve('authenticated-user'),
    adminForDeleteAccount(() => Promise.resolve({ error: { status: 500 } })),
  );
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: 'DELETE_FAILED',
    message: 'Could not delete account',
  });
});

Deno.test('delete-account removes the caller avatar before deleting the Auth user', async () => {
  const calls: string[] = [];
  const response = await deleteAccount(
    new Request('http://test'),
    () => Promise.resolve('authenticated-user'),
    adminForDeleteAccount(
      (userId) => {
        calls.push(`delete:${userId}`);
        return Promise.resolve({ error: null });
      },
      (paths) => {
        calls.push(`remove:${paths.join(',')}`);
        return Promise.resolve({ error: null });
      },
    ),
  );
  assertEquals(await response.json(), { ok: true });
  assertEquals(calls, [
    'remove:authenticated-user/avatar.jpg',
    'delete:authenticated-user',
  ]);
});

Deno.test('delete-account keeps the Auth user when avatar removal fails', async () => {
  let deleted = false;
  const response = await deleteAccount(
    new Request('http://test'),
    () => Promise.resolve('authenticated-user'),
    adminForDeleteAccount(
      () => {
        deleted = true;
        return Promise.resolve({ error: null });
      },
      () => Promise.resolve({ error: { message: 'storage unavailable' } }),
    ),
  );
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: 'DELETE_FAILED',
    message: 'Could not delete account',
  });
  assertEquals(deleted, false);
});

Deno.test('delete-account rejects an unauthenticated caller without touching storage or Auth', async () => {
  let adminUsed = false;
  const response = await deleteAccount(
    new Request('http://test', { method: 'POST' }),
    () => Promise.resolve(null),
    () => {
      adminUsed = true;
      return adminForDeleteAccount(() => Promise.resolve({ error: null }))();
    },
  );
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: 'UNAUTHORIZED', message: 'Unauthorized' });
  assertEquals(adminUsed, false);
});

Deno.test('delete-account removes the avatar from the avatars bucket', async () => {
  const buckets: string[] = [];
  const removed: string[][] = [];
  const response = await deleteAccount(
    new Request('http://test'),
    () => Promise.resolve('authenticated-user'),
    adminForDeleteAccount(
      () => Promise.resolve({ error: null }),
      (paths) => {
        removed.push(paths);
        return Promise.resolve({ error: null });
      },
      buckets,
    ),
  );
  assertEquals(response.status, 200);
  assertEquals(buckets, ['avatars']);
  assertEquals(removed, [['authenticated-user/avatar.jpg']]);
});

Deno.test('delete-account treats either a 404 or USER_NOT_FOUND as a successful retry', async () => {
  for (const notFound of [{ status: 404 }, { code: 'USER_NOT_FOUND' }]) {
    const response = await deleteAccount(
      new Request('http://test'),
      () => Promise.resolve('authenticated-user'),
      adminForDeleteAccount(() => Promise.resolve({ error: notFound })),
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { ok: true });
  }
});

Deno.test('delete-account failures return DELETE_FAILED with no user data in body or logs', async () => {
  const userId = 'user-7f3c-private';
  const detail = 'storage backend detail for user-7f3c-private';
  const failures = [
    adminForDeleteAccount(
      () => Promise.resolve({ error: null }),
      () => Promise.resolve({ error: { message: detail } }),
    ),
    adminForDeleteAccount(() => Promise.resolve({ error: { status: 500, code: detail } })),
    adminForDeleteAccount(() => Promise.reject(new Error(detail))),
    adminForDeleteAccount(
      () => Promise.resolve({ error: null }),
      () => Promise.reject(new Error(detail)),
    ),
    () => {
      throw new Error(detail);
    },
  ];
  for (const admin of failures) {
    const { result: response, logged } = await captureConsole(() =>
      deleteAccount(new Request('http://test'), () => Promise.resolve(userId), admin)
    );
    assertEquals(response.status, 500);
    const body = await response.text();
    assertEquals(JSON.parse(body), { error: 'DELETE_FAILED', message: 'Could not delete account' });
    assertEquals(body.includes(userId), false);
    assertEquals(logged.includes(userId), false);
    assertEquals(logged.includes(detail), false);
  }
});
