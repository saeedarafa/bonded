// BE-48 (D50): app-triggered refresh of the caller's own entitlement after Purchases.logIn.
import { assertEquals } from 'jsr:@std/assert@1';
import { AuthUnavailableError } from '../_shared/auth.ts';
import { handle } from './index.ts';

const A = '00000000-0000-4000-a000-00000000a001';
const NOW = new Date('2026-11-02T12:00:00Z');
const post = (body: unknown = {}) =>
  new Request('http://test', { method: 'POST', body: JSON.stringify(body) });
const premium = {
  subscriber: {
    entitlements: {
      premium: { product_identifier: 'yearly_v2', expires_date: '2026-11-08T10:00:00Z' },
    },
    subscriptions: {
      yearly_v2: {
        store: 'PLAY_STORE',
        period_type: 'trial',
        purchase_date: '2026-11-01T10:00:00Z',
      },
    },
  },
};
const deps = (options: { allowed?: boolean; lookup?: number; dbError?: boolean } = {}) => {
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const lookups: string[] = [];
  return {
    rpcs,
    lookups,
    deps: {
      now: () => NOW,
      getEnv: () => 'fixture-rest-key',
      fetch: ((url: string | URL | Request) => {
        lookups.push(String(url));
        return Promise.resolve(
          options.lookup
            ? new Response('PRIVATE', { status: options.lookup })
            : Response.json(premium),
        );
      }) as typeof fetch,
      admin: {
        rpc: (name: string, args: Record<string, unknown>) => {
          rpcs.push({ name, args });
          if (name === 'claim_revenuecat_sync') {
            return Promise.resolve({ data: options.allowed ?? true, error: null });
          }
          return Promise.resolve({ error: options.dbError ? { message: 'PRIVATE' } : null });
        },
      } as never,
    },
  };
};

Deno.test('refreshes only the JWT user from RevenueCat, ignoring anything in the body', async () => {
  const f = deps();
  const response = await handle(
    post({ user_id: '00000000-0000-4000-a000-00000000a002', is_active: true, premium: true }),
    () => Promise.resolve(A),
    f.deps,
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true, is_active: true });
  assertEquals(f.lookups, [`https://api.revenuecat.com/v1/subscribers/${A}`]);
  // BE-63: the snapshot renews, so a pending cancel_offer push of the caller is dropped.
  assertEquals(f.rpcs.map((r) => r.name), [
    'claim_revenuecat_sync',
    'apply_revenuecat_event',
    'queue_cancel_offer',
  ]);
  assertEquals(f.rpcs[2].args, { p_user: A, p_cancelled: false, p_now: NOW.toISOString() });
  assertEquals(f.rpcs[0].args, { p_user: A, p_now: NOW.toISOString() });
  const apply = f.rpcs[1].args;
  assertEquals(apply.p_event_id, `sync:${A}:${NOW.getTime()}`);
  assertEquals(apply.p_occurred_at, NOW.toISOString());
  const [change] = apply.p_changes as Record<string, unknown>[];
  assertEquals(change.user_id, A);
  assertEquals(change.store, 'play_store');
  assertEquals(change.period_type, 'trial');
});

Deno.test('auth, method and rate limit are checked before RevenueCat is called', async () => {
  for (
    const [request, auth, status, code] of [
      [new Request('http://test'), () => Promise.resolve(A), 405, 'METHOD_NOT_ALLOWED'],
      [post(), () => Promise.resolve(null), 401, 'UNAUTHORIZED'],
      [post(), () => Promise.reject(new Error('x')), 401, 'UNAUTHORIZED'],
      [post(), () => Promise.reject(new AuthUnavailableError()), 503, 'AUTH_UNAVAILABLE'],
    ] as const
  ) {
    const f = deps();
    const response = await handle(request, auth, f.deps);
    assertEquals(response.status, status);
    assertEquals((await response.json()).error, code);
    assertEquals([f.lookups, f.rpcs], [[], []]);
  }
  const limited = deps({ allowed: false });
  const response = await handle(post(), () => Promise.resolve(A), limited.deps);
  assertEquals(response.status, 429);
  assertEquals((await response.json()).error, 'RATE_LIMITED');
  assertEquals(limited.lookups, []);
  assertEquals(limited.rpcs.map((r) => r.name), ['claim_revenuecat_sync']);
});

Deno.test('lookup or database failures return a fixed retryable error and log no data', async () => {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  try {
    for (const options of [{ lookup: 500 }, { lookup: 401 }, { dbError: true }]) {
      const f = deps(options);
      const response = await handle(post(), () => Promise.resolve(A), f.deps);
      assertEquals(response.status, 500);
      assertEquals(await response.json(), {
        error: 'SYNC_FAILED',
        message: 'Could not refresh the subscription',
      });
    }
    const missingKey = deps();
    const response = await handle(post(), () => Promise.resolve(A), {
      ...missingKey.deps,
      getEnv: () => undefined,
    });
    assertEquals(response.status, 500);
    assertEquals(lines.every((l) => !l.includes(A) && !l.includes('PRIVATE')), true);
  } finally {
    console.log = original;
  }
});

Deno.test('BE-63: a snapshot that does not renew never touches the cancel_offer queue', async () => {
  const f = deps();
  const cancelled = structuredClone(premium);
  (cancelled.subscriber.subscriptions.yearly_v2 as Record<string, unknown>)
    .unsubscribe_detected_at = '2026-11-02T11:00:00Z';
  f.deps.fetch = (() => Promise.resolve(Response.json(cancelled))) as typeof fetch;
  const response = await handle(post(), () => Promise.resolve(A), f.deps);
  assertEquals(response.status, 200);
  assertEquals(f.rpcs.map((r) => r.name), ['claim_revenuecat_sync', 'apply_revenuecat_event']);
});
