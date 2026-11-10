// BE-39 (security informational follow-up): when Supabase Auth itself is unreachable, a user-JWT
// function answers 503 AUTH_UNAVAILABLE (retry) instead of 401 (which reads as "signed out").
// A rejected token is still 401. The real supabase-js client runs against a stubbed fetch.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { AuthUnavailableError, getUserFromSupabase, requireUser } from '../_shared/auth.ts';
import { handle } from './index.ts';

const withAuth = async (
  reply: () => Promise<Response>,
  body: () => Promise<void>,
): Promise<void> => {
  const realFetch = globalThis.fetch;
  const before = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].map((k) => [k, Deno.env.get(k)]);
  Deno.env.set('SUPABASE_URL', 'https://fixture-ref.supabase.example');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service-role');
  globalThis.fetch = () => reply();
  try {
    await body();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of before) v === undefined ? Deno.env.delete(k!) : Deno.env.set(k!, v);
  }
};
const apiError = (status: number) => () =>
  Promise.resolve(
    new Response(JSON.stringify({ code: status, error_code: 'fixture', msg: 'fixture' }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
const request = () =>
  new Request('http://test', { method: 'POST', headers: { authorization: 'Bearer fixture-jwt' } });
const neverAdmin = () => {
  throw new Error('admin must not be reached');
};

Deno.test('Auth network failure, 5xx and 503 map to AuthUnavailableError', async () => {
  for (
    const reply of [
      () => Promise.reject(new TypeError('fixture network down')),
      apiError(500),
      apiError(502),
      apiError(503),
    ]
  ) {
    await withAuth(reply, async () => {
      await assertRejects(() => getUserFromSupabase('fixture-jwt'), AuthUnavailableError);
    });
  }
});

Deno.test('Auth 4xx (bad, expired or unknown token) is still "not authenticated"', async () => {
  for (const status of [400, 401, 403, 404]) {
    await withAuth(apiError(status), async () => {
      assertEquals(await getUserFromSupabase('fixture-jwt'), null);
    });
  }
});

Deno.test('requireUser: only an Auth outage escapes; other failures stay fail-closed', async () => {
  assertEquals(
    await requireUser(new Request('http://test'), () => Promise.reject(new Error())),
    null,
  );
  await assertRejects(
    () => requireUser(request(), () => Promise.reject(new AuthUnavailableError())),
    AuthUnavailableError,
  );
  assertEquals(await requireUser(request(), () => Promise.reject(new Error('fixture'))), null);
  assertEquals(await requireUser(request(), () => Promise.resolve(null)), null);
});

Deno.test('delete-account answers 503 AUTH_UNAVAILABLE when Auth is down, 401 when the token is rejected', async () => {
  await withAuth(() => Promise.reject(new TypeError('fixture network down')), async () => {
    const response = await handle(request(), requireUser, neverAdmin);
    assertEquals(response.status, 503);
    assertEquals(await response.json(), {
      error: 'AUTH_UNAVAILABLE',
      message: 'Authentication is temporarily unavailable',
    });
  });
  await withAuth(apiError(401), async () => {
    const response = await handle(request(), requireUser, neverAdmin);
    assertEquals(response.status, 401);
    assertEquals((await response.json()).error, 'UNAUTHORIZED');
  });
  // Missing SUPABASE_URL / service key is a misconfiguration, not an outage: still 401.
  const url = Deno.env.get('SUPABASE_URL');
  Deno.env.delete('SUPABASE_URL');
  try {
    assertEquals((await handle(request(), requireUser, neverAdmin)).status, 401);
  } finally {
    if (url !== undefined) Deno.env.set('SUPABASE_URL', url);
  }
  // An authenticator that throws something else is a server error, not an Auth outage.
  const unexpected = await handle(
    request(),
    () => Promise.reject(new Error('fixture')),
    neverAdmin,
  );
  assertEquals(unexpected.status, 500);
});
