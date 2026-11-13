import { assertEquals } from 'jsr:@std/assert@1';
import { createHandler, hashToken } from './index.ts';

const TOKEN = 'bwt_' + 'A'.repeat(43);
const CLIENT = '11111111-1111-4111-8111-111111111111';

type Call = [string, Record<string, unknown>];
const harness = (
  answer: (
    name: string,
  ) => { data: unknown; error: { message?: string; details?: string } | null } = () => ({
    data: { premium: true },
    error: null,
  }),
) => {
  const calls: Call[] = [];
  const handle = createHandler({
    rpc: (name, args) => {
      calls.push([name, args]);
      return Promise.resolve(answer(name));
    },
  });
  return { handle, calls };
};

const post = (
  body: unknown,
  auth: string | null = `Bearer ${TOKEN}`,
  url = 'https://fixture.invalid/functions/v1/widget',
) =>
  new Request(url, {
    method: 'POST',
    headers: auth === null ? {} : { authorization: auth },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

Deno.test('hashToken is lower-case hex sha256', async () => {
  assertEquals(
    await hashToken('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

Deno.test('state: the RPC gets only the token hash, never the token; response is no-store', async () => {
  const { handle, calls } = harness();
  const response = await handle(post({ action: 'state' }));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('cache-control'), 'no-store');
  assertEquals(await response.json(), { premium: true });
  assertEquals(calls, [['widget_state', { p_token_hash: await hashToken(TOKEN) }]]);
  assertEquals(JSON.stringify(calls).includes(TOKEN), false);
});

Deno.test('send passes kind and client id; undo wraps the state list', async () => {
  const { handle, calls } = harness((name) => ({
    data: name === 'widget_send'
      ? { id: CLIENT, same_time: false, at_limit: false }
      : [{ kind: 'hug', at_limit: false }],
    error: null,
  }));
  const sent = await handle(post({ action: 'send', kind: 'hug', client_id: CLIENT }));
  assertEquals(sent.status, 200);
  const undone = await handle(post({ action: 'undo', id: CLIENT }));
  assertEquals(await undone.json(), { little_things: [{ kind: 'hug', at_limit: false }] });
  const hash = await hashToken(TOKEN);
  assertEquals(calls, [
    ['widget_send', { p_token_hash: hash, p_kind: 'hug', p_client_id: CLIENT }],
    ['widget_undo', { p_token_hash: hash, p_id: CLIENT }],
  ]);
});

Deno.test('missing, malformed, non-Bearer or query-string tokens are the same 401 without a DB call', async () => {
  const { handle, calls } = harness();
  for (
    const request of [
      post({ action: 'state' }, null),
      post({ action: 'state' }, 'Bearer bwt_short'),
      post({ action: 'state' }, `Basic ${TOKEN}`),
      post({ action: 'state' }, 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x'),
      post({ action: 'state', token: TOKEN }, null),
      post({ action: 'state' }, null, `https://fixture.invalid/functions/v1/widget?token=${TOKEN}`),
    ]
  ) {
    const response = await handle(request);
    assertEquals(response.status, 401);
    assertEquals((await response.json()).error, 'WIDGET_AUTH');
    assertEquals(response.headers.get('cache-control'), 'no-store');
  }
  assertEquals(calls.length, 0);
});

Deno.test('a token the DB refuses (unknown/expired/revoked/ended) is 401 WIDGET_AUTH', async () => {
  const { handle } = harness(() => ({ data: null, error: { message: 'WIDGET_AUTH' } }));
  const response = await handle(post({ action: 'state' }));
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: 'WIDGET_AUTH', message: 'Open Bonded to continue' });
});

Deno.test('DB codes map to statuses; unknown errors never echo upstream text', async () => {
  const cases: [string, number][] = [
    ['PREMIUM_REQUIRED', 403],
    ['INVALID_LITTLE_THING', 400],
    ['UNDO_EXPIRED', 409],
    ['RATE_LIMITED', 429],
    ['relation "x" does not exist', 500],
  ];
  for (const [code, status] of cases) {
    const { handle } = harness(() => ({ data: null, error: { message: code } }));
    const response = await handle(post({ action: 'send', kind: 'kiss', client_id: CLIENT }));
    assertEquals(response.status, status);
    const body = await response.json();
    assertEquals(body.error, status === 500 ? 'WIDGET_FAILED' : code);
    assertEquals(JSON.stringify(body).includes('relation'), false);
  }
});

Deno.test('LITTLE_THING_LIMIT returns only kind and more_with_premium', async () => {
  const { handle } = harness(() => ({
    data: null,
    error: {
      message: 'LITTLE_THING_LIMIT',
      details: '{"kind":"hug","more_with_premium":false,"x":"y"}',
    },
  }));
  const response = await handle(post({ action: 'send', kind: 'hug', client_id: CLIENT }));
  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    error: 'LITTLE_THING_LIMIT',
    message: 'Limit reached for today',
    kind: 'hug',
    more_with_premium: false,
  });
});

Deno.test('bad input: method, action, kind, client id, oversized body', async () => {
  const { handle, calls } = harness();
  const get = await handle(
    new Request('https://fixture.invalid/functions/v1/widget', { method: 'GET' }),
  );
  assertEquals(get.status, 405);
  for (
    const body of [
      { action: 'nope' },
      { action: 'send', kind: 'slap', client_id: CLIENT },
      { action: 'send', kind: 'hug' },
      { action: 'send', kind: 'hug', client_id: 'x' },
      { action: 'undo', id: 'x' },
      '[1]',
      '{bad json',
      JSON.stringify({ action: 'state', pad: 'x'.repeat(2000) }),
    ]
  ) {
    const response = await handle(post(body));
    assertEquals(response.status, 400);
    assertEquals(response.headers.get('cache-control'), 'no-store');
  }
  assertEquals(calls.length, 0);
});

Deno.test('an RPC that throws is a 500 without detail', async () => {
  const handle = createHandler({ rpc: () => Promise.reject(new Error('boom bwt_secret')) });
  const response = await handle(post({ action: 'state' }));
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: 'WIDGET_FAILED', message: 'Widget unavailable' });
});
