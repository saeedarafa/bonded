// BE-43: voice-cleanup removes what voice_sweep lists, in Storage chunks; counts only in logs.
import { assertEquals } from 'jsr:@std/assert@1';
import { handle } from './index.ts';
import { objectNames } from '../_shared/voice.ts';

const names = (n: number, from = 0) =>
  Array.from(
    { length: n },
    (_, i) =>
      `11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/${from + i}.m4a`,
  );

// A fake database: sweep returns up to p_limit names still "stored"; remove deletes them.
const fakeStore = (
  initial: string[],
  opts: { sweepError?: boolean; removeError?: boolean } = {},
) => {
  const stored = new Set(initial);
  const removes: number[] = [];
  const sweeps: Record<string, unknown>[] = [];
  const buckets: string[] = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      assertEquals(name, 'voice_sweep');
      sweeps.push(args);
      if (opts.sweepError) return Promise.resolve({ data: null, error: { message: 'x' } });
      return Promise.resolve({
        data: [...stored].slice(0, args.p_limit as number),
        error: null,
      });
    },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          buckets.push(bucket);
          removes.push(paths.length);
          if (opts.removeError) return Promise.resolve({ error: { message: 'down' } });
          paths.forEach((p) => stored.delete(p));
          return Promise.resolve({ error: null });
        },
      }),
    },
  };
  return { admin, stored, removes, sweeps, buckets };
};
const run = (admin: unknown, allow = true) =>
  handle(new Request('http://test', { method: 'POST', body: '{}' }), () => Promise.resolve(allow), {
    admin: admin as never,
  });

Deno.test('voice-cleanup rejects a caller without the internal secret', async () => {
  const { admin, sweeps } = fakeStore(names(3));
  const response = await run(admin, false);
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: 'UNAUTHORIZED', message: 'Unauthorized' });
  assertEquals(sweeps.length, 0);
});

Deno.test('voice-cleanup removes every listed object from the voice bucket in chunks of 100', async () => {
  const { admin, stored, removes, sweeps, buckets } = fakeStore(names(730));
  const response = await run(admin);
  assertEquals(await response.json(), { removed: 730 });
  assertEquals(stored.size, 0);
  assertEquals(removes, [100, 100, 100, 100, 100, 100, 100, 30]);
  assertEquals(new Set(buckets), new Set(['voice']));
  // BE-43b: no p_now, so voice_sweep uses the database clock (its default now()).
  assertEquals(sweeps[0], { p_limit: 500 });
  assertEquals(sweeps.every((args) => !('p_now' in args)), true);
});

Deno.test('voice-cleanup is idempotent: a second run removes nothing', async () => {
  const { admin, removes } = fakeStore(names(5));
  assertEquals(await (await run(admin)).json(), { removed: 5 });
  assertEquals(await (await run(admin)).json(), { removed: 0 });
  assertEquals(removes, [5]);
});

Deno.test('voice-cleanup stops after 10 rounds so one run is bounded', async () => {
  const { admin, stored } = fakeStore(names(6000));
  assertEquals(await (await run(admin)).json(), { removed: 5000 });
  assertEquals(stored.size, 1000);
});

Deno.test('voice-cleanup failures return 500 without object names in body or logs', async () => {
  for (const opts of [{ sweepError: true }, { removeError: true }]) {
    const { admin } = fakeStore(names(2), opts);
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(' '));
    let response: Response;
    try {
      response = await run(admin);
    } finally {
      console.log = original;
    }
    assertEquals(response.status, 500);
    const body = await response.text();
    assertEquals(JSON.parse(body), { error: 'INTERNAL_ERROR', message: 'Voice cleanup failed' });
    assertEquals(lines.join('\n').includes('.m4a'), false);
    assertEquals(lines.join('\n').includes('2222'), false);
  }
});

Deno.test('objectNames accepts the PostgREST scalar array and the row-object shape', () => {
  assertEquals(objectNames(['a/b/c.m4a']), ['a/b/c.m4a']);
  assertEquals(objectNames([{ voice_sweep: 'a/b/c.m4a' }]), ['a/b/c.m4a']);
  assertEquals(objectNames(null), []);
  assertEquals(objectNames([null, 3, '']), []);
});
