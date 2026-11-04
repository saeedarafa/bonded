import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { createHandler } from './index.ts';

const token = 'a'.repeat(32);
const path = '00000000-0000-0000-0000-000000003001/avatar.jpg';
const now = Date.parse('2026-12-01T08:00:00Z');
const preview = {
  inviter_name: 'Maya',
  inviter_avatar_url: null,
  inviter_answered_today: true,
  expires_at: '2026-12-03T08:00:00Z',
} as const;
const request = (input: unknown = { p_code: 'BND·4827', p_token: token }) =>
  new Request('https://fixture.invalid/functions/v1/invite-preview', {
    method: 'POST',
    body: JSON.stringify(input),
  });
const signed = 'https://fixture.invalid/storage/v1/object/sign/avatars/fixture?token=FIXTURE';
const harness = () => {
  const reads: string[][] = [];
  const signs: [string, number][] = [];
  const deps = {
    preview: (code: string, supplied: string) => {
      reads.push([code, supplied]);
      return Promise.resolve({ preview: { ...preview }, avatar_path: path });
    },
    sign: (object: string, seconds: number): Promise<string | null> => {
      signs.push([object, seconds]);
      return Promise.resolve(signed);
    },
    now: () => now,
  };
  return { deps, reads, signs };
};

Deno.test('valid link previews only minimal fields and signs the DB-selected path for 60 seconds', async () => {
  const { deps, reads, signs } = harness();
  const handle = createHandler(deps);
  for (let i = 0; i < 2; i++) {
    const response = await handle(request());
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { ...preview, inviter_avatar_url: signed });
    assertEquals(response.headers.get('cache-control'), 'no-store');
    assertEquals(response.headers.get('referrer-policy'), 'no-referrer');
  }
  assertEquals(reads, [['BND·4827', token], ['BND·4827', token]]);
  assertEquals(signs, [[path, 60], [path, 60]]);
});

Deno.test('signatures never outlive invite expiry and caller cannot supply a clock or path', async () => {
  const { deps, signs } = harness();
  deps.now = () => Date.parse(preview.expires_at) - 19_900;
  const response = await createHandler(deps)(request({
    p_code: '4827',
    p_token: token,
    p_now: '2000-01-01Z',
    path: 'other-user/avatar.jpg',
    expiresIn: 86400,
  }));
  assertEquals(response.status, 200);
  assertEquals(signs, [[path, 19]]);
});

Deno.test('missing, malformed or oversized capability never reaches DB or Storage', async () => {
  const { deps, reads, signs } = harness();
  for (
    const input of [
      null,
      {},
      { p_code: '4827' },
      { p_code: '4827', p_token: null },
      { p_code: '4827', p_token: 'x' },
      { p_code: '4827', p_token: '../'.repeat(11) },
      { p_code: 'a'.repeat(33), p_token: token },
      { p_code: {}, p_token: token },
    ]
  ) {
    const response = await createHandler(deps)(request(input));
    assertEquals(response.status, 401);
    assertEquals(await response.json(), { error: 'UNAUTHORIZED', message: 'Invalid invite link' });
  }
  assertEquals(reads, []);
  assertEquals(signs, []);
});

Deno.test('unknown, wrong, expired, revoked and used capabilities share the SQL-denied response', async () => {
  const { deps, signs } = harness();
  const handle = createHandler({ ...deps, preview: () => Promise.resolve(null) });
  const response = await handle(request());
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: 'UNAUTHORIZED', message: 'Invalid invite link' });
  assertEquals(signs, []);
});

Deno.test('already expired or invalid expiry never signs even if the database read was earlier', async () => {
  const { deps, signs } = harness();
  for (const expiry of [preview.expires_at, 'invalid']) {
    const handle = createHandler({
      ...deps,
      now: () => Date.parse(preview.expires_at),
      preview: () =>
        Promise.resolve({ preview: { ...preview, expires_at: expiry }, avatar_path: path }),
    });
    assertEquals((await handle(request())).status, 401);
  }
  assertEquals(signs, []);
});

Deno.test('missing avatar, concurrent deletion and signing outage preserve null-avatar fallback', async () => {
  for (const mode of ['absent', 'deleted', 'throw']) {
    const { deps, signs } = harness();
    const response = await createHandler({
      ...deps,
      preview: () => Promise.resolve({ preview, avatar_path: mode === 'absent' ? null : path }),
      sign: (object, seconds) => {
        signs.push([object, seconds]);
        if (mode === 'throw') throw new Error('FIXTURE-STORAGE-SECRET');
        return Promise.resolve(null);
      },
    })(request());
    assertEquals(response.status, 200);
    assertEquals(await response.json(), preview);
    assertEquals(signs.length, mode === 'absent' ? 0 : 1);
  }
});

Deno.test('only POST body input is accepted, and streamed payloads are size limited', async () => {
  const { deps, reads } = harness();
  const handle = createHandler(deps);
  const get = await handle(new Request('https://fixture.invalid/?p_token=' + token));
  assertEquals(get.status, 405);
  assertEquals(get.headers.get('allow'), 'POST');
  const malformed = new Request('https://fixture.invalid', { method: 'POST', body: '{' });
  assertEquals((await handle(malformed)).status, 400);
  const empty = new Request('https://fixture.invalid', { method: 'POST' });
  assertEquals((await handle(empty)).status, 400);
  assertEquals((await handle(request({ data: 'x'.repeat(1025) }))).status, 413);
  const encoder = new TextEncoder();
  const streamed = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('x'.repeat(600)));
      controller.enqueue(encoder.encode('x'.repeat(600)));
      controller.close();
    },
  });
  assertEquals(
    (await handle(
      new Request('https://fixture.invalid', {
        method: 'POST',
        body: streamed,
      }),
    )).status,
    413,
  );
  assertEquals(reads, []);
});

Deno.test('unexpected DB errors and unsafe paths fail closed without logging tokens or upstream details', async () => {
  const { deps, signs } = harness();
  const original = console.error;
  const logged: unknown[] = [];
  console.error = (...args) => logged.push(args);
  try {
    for (const mode of ['db', 'path']) {
      const response = await createHandler({
        ...deps,
        preview: () => {
          if (mode === 'db') throw new Error('FIXTURE-UPSTREAM-SECRET ' + token);
          return Promise.resolve({ preview, avatar_path: '../other-user/avatar.jpg' });
        },
      })(request());
      assertEquals(response.status, 500);
      assertEquals(await response.json(), {
        error: 'PREVIEW_FAILED',
        message: 'Preview unavailable',
      });
    }
    assertEquals(logged, []);
    assertEquals(signs, []);
  } finally {
    console.error = original;
  }
});

Deno.test('a failing injected handler dependency cannot escape as raw error data', async () => {
  const { deps } = harness();
  // Keep a separate rejected-promise seam (as distinct from synchronous exceptions).
  const failure = () => Promise.reject(new Error('FIXTURE-SECRET'));
  await assertRejects(failure);
  const response = await createHandler({ ...deps, preview: failure })(request());
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: 'PREVIEW_FAILED', message: 'Preview unavailable' });
});
