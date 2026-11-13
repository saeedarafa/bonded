// BE-48 (D50): purchases made on P3 before sign-in (anonymous RevenueCat id), then logIn(uid).
import { assertEquals } from 'jsr:@std/assert@1';
import { handle } from './index.ts';

const A = '00000000-0000-4000-a000-00000000a001';
const B = '00000000-0000-4000-a000-00000000a002';
const ANON = '$RCAnonymousID:7f3c0b9e2d4a4c1f';
const yes = () => Promise.resolve(true);
const START = '2026-11-01T10:00:00Z';
const END = '2026-11-08T10:00:00Z';
const event = (fields: Record<string, unknown>) => ({
  event: {
    id: `evt-${crypto.randomUUID()}`,
    type: 'INITIAL_PURCHASE',
    event_timestamp_ms: Date.parse(START),
    product_id: 'yearly_v2',
    period_type: 'TRIAL',
    entitlement_ids: ['premium'],
    app_user_id: ANON,
    original_app_user_id: ANON,
    aliases: [ANON],
    ...fields,
  },
});
type Subscriber = Record<string, unknown>;
const trialSubscriber = (extra: Record<string, unknown> = {}): Subscriber => ({
  entitlements: { premium: { product_identifier: 'yearly_v2', expires_date: END } },
  subscriptions: {
    yearly_v2: {
      store: 'APP_STORE',
      period_type: 'trial',
      purchase_date: START,
      expires_date: END,
      unsubscribe_detected_at: null,
      billing_issues_detected_at: null,
      ...extra,
    },
  },
});
// Canonical state per id: only A bought; B and anything else has no premium.
const run = async (
  payload: unknown,
  subscribers: Record<string, Subscriber> = { [A]: trialSubscriber() },
) => {
  const lookups: string[] = [];
  const calls: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  try {
    const response = await handle(
      new Request('http://test', { method: 'POST', body: JSON.stringify(payload) }),
      yes,
      {
        getEnv: () => 'fixture-rest-key',
        now: () => new Date('2026-11-02T12:00:00Z'),
        fetch: ((url: string | URL | Request) => {
          const id = decodeURIComponent(String(url).split('/').at(-1)!);
          lookups.push(id);
          return Promise.resolve(
            Response.json({ subscriber: subscribers[id] ?? { entitlements: {} } }),
          );
        }) as typeof fetch,
        admin: {
          rpc: (name: string, args: Record<string, unknown>) => {
            // BE-63: the cancel_offer unqueue after a renewing snapshot is not an entitlement write.
            if (name !== 'queue_cancel_offer') calls.push(args);
            return Promise.resolve({ error: null });
          },
        } as never,
      },
    );
    return { status: response.status, lookups, calls, lines };
  } finally {
    console.log = original;
  }
};
const changes = (calls: Record<string, unknown>[]) =>
  calls[0].p_changes as Record<string, unknown>[];

Deno.test('anonymous purchase delivered after logIn lands on the aliased user only', async () => {
  for (
    const fields of [
      { aliases: [ANON, A] },
      { original_app_user_id: A },
      { app_user_id: A, aliases: [ANON, A] },
      { app_user_id: A, original_app_user_id: ANON, aliases: [ANON, A, A] },
    ]
  ) {
    const r = await run(event(fields));
    assertEquals(r.status, 200);
    assertEquals(r.lookups, [A], JSON.stringify(fields));
    assertEquals(r.calls.length, 1);
    const [change] = changes(r.calls);
    assertEquals(change, {
      user_id: A,
      is_active: true,
      product_id: 'yearly_v2',
      store: 'app_store',
      expires_at: new Date(END).toISOString(),
      period_type: 'trial',
      period_started_at: new Date(START).toISOString(),
      will_renew: true,
    });
  }
});

Deno.test('anonymous-only events (no logIn yet) are acknowledged without lookup or write', async () => {
  for (
    const fields of [
      {},
      { aliases: [ANON, '$RCAnonymousID:other'] },
      { original_app_user_id: null, aliases: undefined },
      { type: 'RENEWAL' },
      { type: 'EXPIRATION' },
    ]
  ) {
    const r = await run(event(fields));
    assertEquals(r.status, 200);
    assertEquals(r.lookups, []);
    assertEquals(r.calls, []);
    assertEquals(r.lines, [JSON.stringify({ event: 'revenuecat.anonymous_ignored' })]);
  }
});

Deno.test('every named identified id gets only its own canonical state', async () => {
  // A second UUID in aliases (e.g. a partner who shared the device) is refreshed from its own
  // subscriber record and stays free; it never inherits A's purchase.
  const r = await run(event({ aliases: [ANON, A, B] }));
  assertEquals(r.status, 200);
  assertEquals(r.lookups.sort(), [A, B].sort());
  const byUser = Object.fromEntries(changes(r.calls).map((c) => [c.user_id, c]));
  assertEquals(byUser[A].is_active, true);
  assertEquals(byUser[B], {
    user_id: B,
    is_active: false,
    product_id: null,
    store: null,
    expires_at: null,
    period_type: null,
    period_started_at: null,
    will_renew: false,
  });
});

Deno.test('alias resolution logs only a count, never ids, products or payloads', async () => {
  const r = await run(event({ aliases: [ANON, A] }));
  assertEquals(r.lines, [JSON.stringify({ event: 'revenuecat.alias_resolved', users: 1 })]);
});

Deno.test('malformed identity fields are rejected before any lookup', async () => {
  for (
    const fields of [
      { app_user_id: 'not-a-user', aliases: [A] },
      { app_user_id: 42 },
      { app_user_id: null, aliases: [A] },
      { original_app_user_id: 7 },
      { aliases: A },
      { aliases: [ANON, 3] },
      { aliases: Array.from({ length: 51 }, () => ANON) },
      {
        aliases: Array.from(
          { length: 11 },
          (_, i) => `00000000-0000-4000-a000-0000000000${String(i).padStart(2, '0')}`,
        ),
      },
    ]
  ) {
    const r = await run(event(fields));
    assertEquals(r.status, 400, JSON.stringify(fields));
    assertEquals(r.lookups, []);
    assertEquals(r.calls, []);
  }
});

Deno.test('TRANSFER from the anonymous id to the signed-in user refreshes only the user', async () => {
  const transfer = (from: unknown, to: unknown) =>
    event({
      type: 'TRANSFER',
      app_user_id: undefined,
      entitlement_ids: undefined,
      transferred_from: from,
      transferred_to: to,
    });
  let r = await run(transfer([ANON], [A]));
  assertEquals(r.status, 200);
  assertEquals(r.lookups, [A]);
  assertEquals(changes(r.calls).map((c) => [c.user_id, c.is_active]), [[A, true]]);
  // From one account to another (restore on a new account): both sides refreshed.
  r = await run(transfer([B, ANON], [A]), { [A]: trialSubscriber() });
  assertEquals(r.lookups.sort(), [A, B].sort());
  assertEquals(
    Object.fromEntries(changes(r.calls).map((c) => [c.user_id, c.is_active])),
    { [A]: true, [B]: false },
  );
  // Anonymous on both sides: nothing to attach.
  r = await run(transfer([ANON], ['$RCAnonymousID:other']));
  assertEquals([r.status, r.lookups, r.calls], [200, [], []]);
  r = await run(transfer([ANON], 'nope'));
  assertEquals([r.status, r.calls], [400, []]);
});

Deno.test('legacy SUBSCRIBER_ALIAS refreshes the identified id without entitlement_ids', async () => {
  const r = await run(
    event({ type: 'SUBSCRIBER_ALIAS', entitlement_ids: undefined, aliases: [ANON, A] }),
  );
  assertEquals(r.status, 200);
  assertEquals(r.lookups, [A]);
  assertEquals(changes(r.calls)[0].is_active, true);
});

Deno.test('trial metadata: cancelled, billing issue, malformed and non-trial snapshots', async () => {
  const cases: [Subscriber, Record<string, unknown>][] = [
    [trialSubscriber({ unsubscribe_detected_at: '2026-11-02T08:00:00Z' }), {
      period_type: 'trial',
      will_renew: false,
    }],
    [trialSubscriber({ billing_issues_detected_at: '2026-11-02T08:00:00Z' }), {
      will_renew: false,
    }],
    [trialSubscriber({ purchase_date: 'garbage' }), {
      is_active: true,
      period_started_at: null,
    }],
    [trialSubscriber({ period_type: 'mystery' }), { is_active: true, period_type: null }],
    [trialSubscriber({ period_type: 'NORMAL' }), { period_type: 'normal' }],
    [{
      entitlements: { premium: { product_identifier: 'lifetime', expires_date: null } },
      non_subscriptions: { lifetime: [{ store: 'APP_STORE', purchase_date: START }] },
    }, { is_active: true, period_type: null, period_started_at: null, will_renew: false }],
  ];
  for (const [subscriber, expected] of cases) {
    const r = await run(event({ app_user_id: A, aliases: [A] }), { [A]: subscriber });
    assertEquals(r.status, 200);
    const [change] = changes(r.calls);
    for (const [key, value] of Object.entries(expected)) {
      assertEquals(change[key], value, `${key} for ${JSON.stringify(subscriber)}`);
    }
  }
});

// BE-48c (#167): an upper-case spelling of a uid is a different RevenueCat subscriber, but the
// database would case-fold it onto the real account. Every non-canonical spelling is ignored like
// a foreign id: no lookup, no write.
Deno.test('non-canonical (upper/mixed-case) uids are ignored: no lookup, no write', async () => {
  const UPPER = A.toUpperCase();
  const MIXED = A.slice(0, 30) + A.slice(30).toUpperCase();
  for (
    const fields of [
      { aliases: [ANON, UPPER] },
      { original_app_user_id: UPPER },
      { app_user_id: UPPER, original_app_user_id: UPPER, aliases: [UPPER] },
      { app_user_id: MIXED, original_app_user_id: MIXED, aliases: [MIXED] },
      { type: 'EXPIRATION', app_user_id: UPPER, original_app_user_id: UPPER, aliases: [UPPER] },
      { type: 'SUBSCRIBER_ALIAS', entitlement_ids: undefined, aliases: [ANON, UPPER] },
      {
        type: 'TRANSFER',
        entitlement_ids: [],
        transferred_from: [UPPER],
        transferred_to: [ANON],
      },
      { type: 'TRANSFER', entitlement_ids: [], transferred_from: [ANON], transferred_to: [MIXED] },
    ]
  ) {
    const r = await run(event(fields), { [UPPER]: {}, [MIXED]: {}, [A]: trialSubscriber() });
    assertEquals(r.status, 200, JSON.stringify(fields));
    assertEquals(r.lookups, [], JSON.stringify(fields));
    assertEquals(r.calls, [], JSON.stringify(fields));
    assertEquals(r.lines, [JSON.stringify({ event: 'revenuecat.anonymous_ignored' })]);
  }
});

Deno.test('a canonical uid next to its upper-case spelling: only the canonical one is refreshed', async () => {
  const UPPER = A.toUpperCase();
  for (
    const fields of [
      { app_user_id: UPPER, original_app_user_id: A, aliases: [UPPER, A] },
      { type: 'TRANSFER', entitlement_ids: [], transferred_from: [UPPER], transferred_to: [A] },
    ]
  ) {
    const r = await run(event(fields));
    assertEquals(r.status, 200);
    assertEquals(r.lookups, [A]);
    assertEquals(changes(r.calls).map((c) => c.user_id), [A]);
  }
});
