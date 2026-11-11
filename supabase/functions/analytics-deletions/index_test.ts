// BE-51 (D54): the hourly retry of PostHog person deletions, against a fake PostHog.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { BATCH, handle } from './index.ts';

const KEY = 'phx_fixture_personal_key_51';
const ENV: Record<string, string> = { POSTHOG_PERSONAL_API_KEY: KEY, POSTHOG_PROJECT_ID: '12345' };
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const fakeAdmin = (batches: string[][], opts: { claimError?: boolean } = {}) => {
  const results: Record<string, unknown>[] = [];
  let claims = 0;
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === 'analytics_deletions_due') {
        claims++;
        if (opts.claimError) return Promise.resolve({ data: null, error: { message: 'db' } });
        return Promise.resolve({ data: batches.shift() ?? [], error: null });
      }
      results.push(args);
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { admin, results, claims: () => claims };
};
const fakeFetch = (
  status: (url: string, body: { distinct_ids: string[] }) => number | 'network',
) => {
  const seen: string[] = [];
  const fetch = ((url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    seen.push(body.distinct_ids[0]);
    const s = status(url, body);
    if (s === 'network') return Promise.reject(new TypeError('down'));
    return Promise.resolve(new Response(null, { status: s }));
  }) as typeof globalThis.fetch;
  return { fetch, seen };
};
const sleep = () => Promise.resolve();
const request = () => new Request('http://test', { method: 'POST' });
const yes = () => Promise.resolve(true);

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

Deno.test('rejects a caller without the internal secret', async () => {
  const response = await handle(request(), () => Promise.resolve(false), {});
  assertEquals(response.status, 401);
});

Deno.test('drains due rows: success removes, a 5xx is retried once then rescheduled', async () => {
  const { admin, results } = fakeAdmin([[id(1), id(2)]]);
  const attempts: Record<string, number> = {};
  const posthog = fakeFetch((_url, body) => {
    const who = body.distinct_ids[0];
    attempts[who] = (attempts[who] ?? 0) + 1;
    return who === id(1) ? 202 : 503;
  });
  let response!: Response;
  const logs = await captureLogs(async () => {
    response = await handle(request(), yes, {
      admin,
      getEnv: (n) => ENV[n],
      fetch: posthog.fetch,
      sleep,
    });
  });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { deleted: 1, failed: 1 });
  assertEquals(attempts, { [id(1)]: 1, [id(2)]: 2 });
  assertEquals(results, [
    { p_user: id(1), p_ok: true, p_status: 202 },
    { p_user: id(2), p_ok: false, p_status: 503 },
  ]);
  for (const line of logs) {
    assert(!line.includes(id(1)) && !line.includes(id(2)) && !line.includes(KEY));
  }
});

Deno.test('a PostHog 404 keeps the row: one attempt, rescheduled, not counted as deleted', async () => {
  const { admin, results } = fakeAdmin([[id(3)]]);
  const posthog = fakeFetch(() => 404);
  const response = await handle(request(), yes, {
    admin,
    getEnv: (n) => ENV[n],
    fetch: posthog.fetch,
    sleep,
  });
  assertEquals(await response.json(), { deleted: 0, failed: 1 });
  assertEquals(posthog.seen.length, 1);
  assertEquals(results, [{ p_user: id(3), p_ok: false, p_status: 404 }]);
});

Deno.test('a full batch claims again; a short batch stops', async () => {
  const full = Array.from({ length: BATCH }, (_, i) => id(i + 1));
  const { admin, claims } = fakeAdmin([full, [id(999)]]);
  const posthog = fakeFetch(() => 200);
  const response = await handle(request(), yes, {
    admin,
    getEnv: (n) => ENV[n],
    fetch: posthog.fetch,
    sleep,
  });
  assertEquals(await response.json(), { deleted: BATCH + 1, failed: 0 });
  assertEquals(claims(), 2);
});

Deno.test('missing key: skipped with a log line, nothing claimed', async () => {
  const { admin, claims } = fakeAdmin([[id(1)]]);
  const posthog = fakeFetch(() => 200);
  let response!: Response;
  const logs = await captureLogs(async () => {
    response = await handle(request(), yes, {
      admin,
      getEnv: () => undefined,
      fetch: posthog.fetch,
    });
  });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { deleted: 0, failed: 0, skipped: 'not_configured' });
  assertEquals(claims(), 0);
  assertEquals(posthog.seen.length, 0);
  assert(logs.some((l) => l.includes('analytics_deletions.skipped')));
});

Deno.test('claim error is a 500 without data; rows stay for the next run', async () => {
  const { admin } = fakeAdmin([], { claimError: true });
  const response = await handle(request(), yes, {
    admin,
    getEnv: (n) => ENV[n],
    fetch: fakeFetch(() => 200).fetch,
  });
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: 'INTERNAL_ERROR',
    message: 'Analytics deletion failed',
  });
});

Deno.test('setof uuid rows from PostgREST in object form are accepted too', async () => {
  const { admin, results } = fakeAdmin([[{ analytics_deletions_due: id(7) } as unknown as string]]);
  const response = await handle(request(), yes, {
    admin,
    getEnv: (n) => ENV[n],
    fetch: fakeFetch(() => 200).fetch,
    sleep,
  });
  assertEquals(await response.json(), { deleted: 1, failed: 0 });
  assertEquals(results, [{ p_user: id(7), p_ok: true, p_status: 200 }]);
});
