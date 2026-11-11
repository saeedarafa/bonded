// BE-51 (D54): delete-account also deletes the PostHog person and events, against a fake PostHog.
// A PostHog failure, a missing key or a broken queue never blocks or fails the account deletion,
// and nothing logged carries the user's uuid or the API key.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handle } from './index.ts';
import { deletePostHogPerson, posthogSetup } from '../_shared/posthog.ts';

const USER = '00000000-0000-0000-0000-0000000051aa';
const KEY = 'phx_fixture_personal_key_51';
const ENV: Record<string, string> = {
  POSTHOG_PERSONAL_API_KEY: KEY,
  POSTHOG_PROJECT_ID: '12345',
};
const getEnv = (env: Record<string, string>) => (name: string) => env[name];

type Rpc = { name: string; args: Record<string, unknown> };
const fakeAdmin = (
  opts: { requestError?: boolean; requestThrows?: boolean; deleteError?: object } = {},
) => {
  const calls: string[] = [];
  const rpcs: Rpc[] = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${name}`);
      rpcs.push({ name, args });
      if (name === 'analytics_deletion_request' && opts.requestThrows) {
        throw new Error(`boom ${USER}`);
      }
      if (name === 'analytics_deletion_request' && opts.requestError) {
        return Promise.resolve({ data: null, error: { message: `db ${USER}` } });
      }
      return Promise.resolve({ data: [], error: null });
    },
    auth: {
      admin: {
        deleteUser: (id: string) => {
          calls.push(`delete:${id}`);
          return Promise.resolve({ error: opts.deleteError ?? null });
        },
      },
    },
    storage: { from: () => ({ remove: () => Promise.resolve({ error: null }) }) },
  };
  return { admin, calls, rpcs };
};

type Seen = { url: string; init: RequestInit };
const fakePostHog = (replies: Array<number | 'network'>) => {
  const seen: Seen[] = [];
  const fetch = ((url: string, init: RequestInit) => {
    seen.push({ url, init });
    const reply = replies[Math.min(seen.length - 1, replies.length - 1)];
    if (reply === 'network') return Promise.reject(new TypeError('fixture network down'));
    return Promise.resolve(new Response('{}', { status: reply }));
  }) as typeof globalThis.fetch;
  return { fetch, seen };
};

const captureLogs = async (body: () => Promise<void>): Promise<string[]> => {
  const lines: string[] = [];
  const real = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  try {
    await body();
  } finally {
    console.log = real;
  }
  return lines;
};

const call = (admin: unknown, analytics: Parameters<typeof handle>[3]) =>
  handle(
    new Request('http://test', { method: 'POST' }),
    () => Promise.resolve(USER),
    () => admin as never,
    analytics,
  );
const sleeps: number[] = [];
const sleep = (ms: number) => {
  sleeps.push(ms);
  return Promise.resolve();
};

Deno.test('success: records the request, deletes the Auth user, then the PostHog person with events', async () => {
  const { admin, calls, rpcs } = fakeAdmin();
  const posthog = fakePostHog([202]);
  let response!: Response;
  const logs = await captureLogs(async () => {
    response = await call(admin, { getEnv: getEnv(ENV), fetch: posthog.fetch, sleep });
  });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true });
  assertEquals(calls, [
    'rpc:voice_objects_of_user',
    'rpc:analytics_deletion_request',
    `delete:${USER}`,
    'rpc:analytics_deletion_result',
  ]);
  assertEquals(rpcs[1].args, { p_user: USER });
  assertEquals(rpcs[2].args, { p_user: USER, p_ok: true, p_status: 202 });
  assertEquals(posthog.seen.length, 1);
  const { url, init } = posthog.seen[0];
  assertEquals(url, 'https://eu.posthog.com/api/projects/12345/persons/bulk_delete/');
  assertEquals(init.method, 'POST');
  assertEquals(new Headers(init.headers).get('authorization'), `Bearer ${KEY}`);
  assertEquals(JSON.parse(String(init.body)), { distinct_ids: [USER], delete_events: true });
  assert(logs.some((l) => l.includes('delete_account.analytics_deleted')));
  for (const line of logs) assert(!line.includes(USER) && !line.includes(KEY), line);
});

Deno.test('5xx then success: retried inline with backoff, queue row cleared', async () => {
  sleeps.length = 0;
  const { admin, rpcs } = fakeAdmin();
  const posthog = fakePostHog([503, 'network', 200]);
  const response = await call(admin, { getEnv: getEnv(ENV), fetch: posthog.fetch, sleep });
  assertEquals(response.status, 200);
  assertEquals(posthog.seen.length, 3);
  assertEquals(sleeps, [250, 1000]);
  assertEquals(rpcs.at(-1)?.args, { p_user: USER, p_ok: true, p_status: 200 });
});

Deno.test('PostHog keeps failing: account still deleted, row rescheduled for the hourly retry', async () => {
  for (const replies of [[500, 502, 503], ['network' as const], [429]]) {
    const { admin, calls, rpcs } = fakeAdmin();
    const posthog = fakePostHog(replies);
    let response!: Response;
    const logs = await captureLogs(async () => {
      response = await call(admin, { getEnv: getEnv(ENV), fetch: posthog.fetch, sleep });
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { ok: true });
    assert(calls.includes(`delete:${USER}`));
    assertEquals(posthog.seen.length, 3);
    const last = rpcs.at(-1)!;
    assertEquals(last.name, 'analytics_deletion_result');
    assertEquals(last.args.p_ok, false);
    assert(logs.some((l) => l.includes('delete_account.analytics_failed')));
    for (const line of logs) assert(!line.includes(USER) && !line.includes(KEY), line);
  }
});

Deno.test('a 4xx (bad key) is not retried inline; the row waits for the hourly run', async () => {
  const { admin, rpcs } = fakeAdmin();
  const posthog = fakePostHog([401]);
  assertEquals(
    (await call(admin, { getEnv: getEnv(ENV), fetch: posthog.fetch, sleep })).status,
    200,
  );
  assertEquals(posthog.seen.length, 1);
  assertEquals(rpcs.at(-1)?.args, { p_user: USER, p_ok: false, p_status: 401 });
});

Deno.test('missing key or project id: skipped with a log line, no PostHog call, deletion succeeds', async () => {
  for (
    const env of <Record<string, string>[]> [
      {},
      { POSTHOG_PERSONAL_API_KEY: KEY },
      { POSTHOG_PROJECT_ID: '12345' },
      { ...ENV, POSTHOG_API_HOST: 'http://eu.posthog.com' },
      { ...ENV, POSTHOG_PROJECT_ID: '12/../../x' },
    ]
  ) {
    const { admin, calls } = fakeAdmin();
    const posthog = fakePostHog([200]);
    let response!: Response;
    const logs = await captureLogs(async () => {
      response = await call(admin, { getEnv: getEnv(env), fetch: posthog.fetch, sleep });
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { ok: true });
    assertEquals(posthog.seen.length, 0);
    // The request row stays queued so the hourly run deletes it once the secrets are set.
    assertEquals(calls, [
      'rpc:voice_objects_of_user',
      'rpc:analytics_deletion_request',
      `delete:${USER}`,
    ]);
    assert(logs.some((l) => l.includes('delete_account.analytics_skipped')));
    for (const line of logs) assert(!line.includes(USER) && !line.includes(KEY), line);
  }
});

Deno.test('queue unavailable (error or throw): never blocks, PostHog is still tried', async () => {
  for (const opts of [{ requestError: true }, { requestThrows: true }]) {
    const { admin, calls } = fakeAdmin(opts);
    const posthog = fakePostHog([200]);
    let response!: Response;
    const logs = await captureLogs(async () => {
      response = await call(admin, { getEnv: getEnv(ENV), fetch: posthog.fetch, sleep });
    });
    assertEquals(response.status, 200);
    assert(calls.includes(`delete:${USER}`));
    assertEquals(posthog.seen.length, 1);
    assert(logs.some((l) => l.includes('delete_account.analytics_request_failed')));
    for (const line of logs) assert(!line.includes(USER), line);
  }
});

Deno.test('a failed Auth delete makes no PostHog call (the app retries the whole deletion)', async () => {
  const { admin } = fakeAdmin({ deleteError: { status: 500 } });
  const posthog = fakePostHog([200]);
  const response = await call(admin, { getEnv: getEnv(ENV), fetch: posthog.fetch, sleep });
  assertEquals(response.status, 500);
  assertEquals(posthog.seen.length, 0);
});

Deno.test('a retry after the Auth user is gone (404) still deletes the PostHog person', async () => {
  const { admin } = fakeAdmin({ deleteError: { status: 404 } });
  const posthog = fakePostHog([202]);
  assertEquals(
    (await call(admin, { getEnv: getEnv(ENV), fetch: posthog.fetch, sleep })).status,
    200,
  );
  assertEquals(posthog.seen.length, 1);
});

Deno.test('a hanging PostHog is cut off by the per-attempt timeout', async () => {
  const setup = posthogSetup(getEnv(ENV));
  const hanging = ((_url: string, init: RequestInit) =>
    new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('timeout', 'TimeoutError')));
    })) as typeof fetch;
  const outcome = await deletePostHogPerson(setup.config!, USER, {
    fetch: hanging,
    sleep,
    timeoutMs: 20,
  });
  assertEquals(outcome, { ok: false, status: 0, attempts: 3 });
});

Deno.test('posthogSetup: EU default host, US host, anything else refused', () => {
  assertEquals(posthogSetup(getEnv(ENV)).config?.host, 'https://eu.posthog.com');
  assertEquals(
    posthogSetup(getEnv({ ...ENV, POSTHOG_API_HOST: 'https://eu.posthog.com/' })).config?.host,
    'https://eu.posthog.com',
  );
  assertEquals(
    posthogSetup(getEnv({ ...ENV, POSTHOG_API_HOST: 'https://us.posthog.com' })).config?.host,
    'https://us.posthog.com',
  );
  for (
    const host of [
      'not a url',
      'http://eu.posthog.com',
      'https://eu.i.posthog.com',
      'https://posthog.example.com',
      'https://eu.posthog.com.example.com',
      'https://eu.posthog.com:8443',
    ]
  ) {
    assertEquals(
      posthogSetup(getEnv({ ...ENV, POSTHOG_API_HOST: host })).skip,
      'misconfigured',
      host,
    );
  }
});

Deno.test('a PostHog 404 (wrong project, host or path) is a failure, not retried inline', async () => {
  const posthog = fakePostHog([404]);
  const outcome = await deletePostHogPerson(posthogSetup(getEnv(ENV)).config!, USER, {
    fetch: posthog.fetch,
    sleep,
  });
  assertEquals(outcome, { ok: false, status: 404, attempts: 1 });

  // Through delete-account: the queue row stays (p_ok false) and backs off; only the status is logged.
  const { admin, rpcs } = fakeAdmin();
  const again = fakePostHog([404]);
  let response!: Response;
  const logs = await captureLogs(async () => {
    response = await call(admin, { getEnv: getEnv(ENV), fetch: again.fetch, sleep });
  });
  assertEquals(response.status, 200);
  assertEquals(again.seen.length, 1);
  assertEquals(rpcs.at(-1)?.args, { p_user: USER, p_ok: false, p_status: 404 });
  for (const line of logs) assert(!line.includes(USER) && !line.includes(KEY), line);
});

Deno.test('the PostHog call refuses redirects, so the key never follows one', async () => {
  const posthog = fakePostHog([202]);
  await deletePostHogPerson(posthogSetup(getEnv(ENV)).config!, USER, {
    fetch: posthog.fetch,
    sleep,
  });
  assertEquals(posthog.seen[0].init.redirect, 'error');
});
