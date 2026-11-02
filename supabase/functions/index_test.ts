import { assertEquals } from 'jsr:@std/assert@1';
import { requireSecret, requireUser } from './_shared/auth.ts';
import { error, json } from './_shared/http.ts';
import { redact } from './_shared/log.ts';
import { type ExpoMessage, sendExpoPush } from './_shared/push.ts';
import { handle as notify } from './notify/index.ts';
import { handle as reminder } from './daily-reminder/index.ts';
import { handle as revenuecat } from './revenuecat/index.ts';
import { handle as deleteAccount } from './delete-account/index.ts';

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

Deno.test('function stubs enforce their caller-specific authentication', async () => {
  const allowInternal = () => Promise.resolve(true);
  const denyInternal = () => Promise.resolve(false);
  assertEquals((await notify(new Request('http://test'), denyInternal)).status, 401);
  assertEquals(await (await notify(new Request('http://test'), allowInternal)).json(), {
    sent: 0,
    suppressed: 0,
  });
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
    await (await deleteAccount(new Request('http://test'), () => Promise.resolve('user-id')))
      .json(),
    { ok: true },
  );
});
