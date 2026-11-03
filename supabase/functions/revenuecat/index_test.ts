import { assert, assertEquals } from 'jsr:@std/assert@1';
import fixtures from '../../../qa/fixtures/revenuecat-events.json' with { type: 'json' };
import { handle } from './index.ts';
const A = '00000000-0000-4000-a000-00000000a001';
const B = '00000000-0000-4000-a000-00000000a002';
const yes = () => Promise.resolve(true);
const request = (payload: unknown) =>
  new Request('http://test', { method: 'POST', body: JSON.stringify(payload) });
const purchase = fixtures.events.initial_purchase_trial.payload;

for (const [name, fixture] of Object.entries(fixtures.events)) {
  Deno.test(`RevenueCat fixture: ${name}`, async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const admin = {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve({ error: null });
      },
    };
    const lookups: string[] = [];
    const response = await handle(
      request(fixture.payload),
      () => Promise.resolve(name !== 'bad_auth'),
      {
        admin: admin as never,
        now: () => new Date('2026-11-03T12:00:00Z'),
        getEnv: () => 'fixture-rest-key',
        fetch: ((url: string | URL | Request, init?: RequestInit) => {
          const u = String(url);
          lookups.push(u);
          assertEquals(init?.headers, { authorization: 'Bearer fixture-rest-key' });
          const event = fixture.payload.event as unknown as Record<string, unknown>;
          const transfer = name === 'transfer';
          const active = transfer
            ? u.endsWith(B)
            : name !== 'expiration' && name !== 'out_of_order_old_event';
          const product = transfer ? 'yearly_trial' : event.product_id as string;
          const expiry = transfer
            ? '2027-01-01T00:00:00Z'
            : event.expiration_at_ms === null
            ? null
            : new Date(event.expiration_at_ms as number).toISOString();
          return Promise.resolve(Response.json({
            subscriber: {
              entitlements: active
                ? { premium: { product_identifier: product, expires_date: expiry } }
                : {},
              subscriptions: { [product]: { store: transfer ? 'PLAY_STORE' : 'APP_STORE' } },
            },
          }));
        }) as typeof fetch,
      },
    );
    assertEquals(response.status, name === 'bad_auth' ? 401 : 200);
    if (name === 'bad_auth' || name === 'anonymous_user') {
      assertEquals(calls.length, 0);
      return;
    }
    assertEquals(calls.length, 1);
    assertEquals(calls[0].name, 'apply_revenuecat_event');
    assertEquals(calls[0].args.p_event_id, fixture.payload.event.id);
    assertEquals(
      calls[0].args.p_occurred_at,
      new Date(fixture.payload.event.event_timestamp_ms).toISOString(),
    );
    const changes = calls[0].args.p_changes as Record<string, unknown>[];
    if (name === 'transfer') {
      assertEquals(
        lookups.sort(),
        [A, B].map((id) => `https://api.revenuecat.com/v1/subscribers/${id}`).sort(),
      );
      assertEquals(changes.map((c) => [c.user_id, c.is_active]), [[A, false], [B, true]]);
      assertEquals(changes[1].product_id, 'yearly_trial');
      assertEquals(changes[1].store, 'play_store');
    } else {
      assertEquals(changes.length, 1);
      assertEquals(changes[0].user_id, A);
      assertEquals(
        changes[0].is_active,
        name !== 'expiration' && name !== 'out_of_order_old_event',
      );
      const event = fixture.payload.event as unknown as Record<string, unknown>;
      assertEquals(changes[0].product_id, changes[0].is_active ? event.product_id : null);
      assertEquals(changes[0].store, changes[0].is_active ? 'app_store' : null);
      assertEquals(
        changes[0].expires_at,
        event.expiration_at_ms === null || !changes[0].is_active
          ? null
          : new Date(event.expiration_at_ms as number).toISOString(),
      );
    }
  });
}
Deno.test('webhook rejects bad input before database access and ignores unrelated events', async () => {
  const run = (payload: unknown) =>
    handle(request(payload), yes, {
      admin: {
        rpc: () => {
          throw new Error('must not write');
        },
      } as never,
    });
  for (
    const event of [
      null,
      {},
      { ...purchase.event, event_timestamp_ms: 'bad' },
      { ...purchase.event, app_user_id: 'invalid' },
      { ...purchase.event, entitlement_ids: null },
      { ...fixtures.events.transfer.payload.event, transferred_to: 'invalid' },
    ]
  ) {
    assertEquals((await run({ event })).status, 400);
  }
  assertEquals((await run({ event: { ...purchase.event, type: 'TEST' } })).status, 200);
  assertEquals(
    (await run({ event: { ...purchase.event, entitlement_ids: ['unrelated'] } })).status,
    200,
  );
  assertEquals((await handle(new Request('http://test'), yes)).status, 400);
  assertEquals(
    (await handle(new Request('http://test', { method: 'POST', body: '{' }), yes)).status,
    400,
  );
  assertEquals(
    (await handle(request({ event: { ...purchase.event, extra: 'x'.repeat(65536) } }), yes)).status,
    400,
  );
  assertEquals((await handle(request(purchase), () => Promise.resolve(false))).status, 401);
});
Deno.test('database errors and lookup failures return fixed retryable errors without logging payloads', async () => {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.join(' '));
  try {
    for (
      const deps of [
        {
          admin: {
            rpc: () => Promise.resolve({ error: { message: 'PRIVATE purchase body' } }),
          } as never,
        },
        {
          admin: {
            rpc: () => {
              throw new Error('PRIVATE purchase body');
            },
          } as never,
        },
      ]
    ) {
      const response = await handle(request(purchase), yes, {
        ...deps,
        getEnv: () => 'fixture',
        fetch: (() =>
          Promise.resolve(Response.json({ subscriber: { entitlements: {} } }))) as typeof fetch,
      });
      assertEquals(response.status, 500);
      assertEquals(await response.json(), {
        error: 'INTERNAL_ERROR',
        message: 'Webhook processing failed',
      });
    }
    let calls = 0;
    const transfer = fixtures.events.transfer.payload;
    for (const status of [401, 429, 500]) {
      const response = await handle(request(transfer), yes, {
        getEnv: () => 'fixture-rest-key',
        fetch: (() => Promise.resolve(new Response('PRIVATE', { status }))) as typeof fetch,
        admin: {
          rpc: () => {
            calls++;
            return Promise.resolve({ error: null });
          },
        } as never,
      });
      assertEquals(response.status, 500);
    }
    assertEquals((await handle(request(transfer), yes, { getEnv: () => undefined })).status, 500);
    assertEquals(calls, 0);
    assertEquals(lines, []);
  } finally {
    console.log = original;
  }
});
Deno.test('transfer requires complete snapshots and preserves a remaining source entitlement', async () => {
  const transfer = fixtures.events.transfer.payload;
  for (
    const payload of [{}, { subscriber: {} }, { subscriber: { entitlements: { premium: {} } } }]
  ) {
    assertEquals(
      (await handle(request(transfer), yes, {
        getEnv: () => 'fixture',
        fetch: (() => Promise.resolve(Response.json(payload))) as typeof fetch,
      })).status,
      500,
    );
  }
  let written: Record<string, unknown>[] = [];
  const response = await handle(request(transfer), yes, {
    getEnv: () => 'fixture',
    now: () => new Date('2026-11-03T12:00Z'),
    fetch: (() =>
      Promise.resolve(
        Response.json({
          subscriber: {
            entitlements: { premium: { product_identifier: 'lifetime', expires_date: null } },
          },
        }),
      )) as typeof fetch,
    admin: {
      rpc: (_name: string, args: Record<string, unknown>) => {
        written = args.p_changes as Record<string, unknown>[];
        return Promise.resolve({ error: null });
      },
    } as never,
  });
  assertEquals(response.status, 200);
  assert(written.every((r) => r.is_active === true && r.expires_at === null));
});

Deno.test('expiration of one product cannot revoke another active premium product', async () => {
  let change: Record<string, unknown> | undefined;
  const response = await handle(request(fixtures.events.expiration.payload), yes, {
    getEnv: () => 'fixture',
    now: () => new Date('2026-11-03T12:00Z'),
    fetch: (() =>
      Promise.resolve(Response.json({
        subscriber: {
          entitlements: { premium: { product_identifier: 'lifetime', expires_date: null } },
          non_subscriptions: { lifetime: [{ store: 'APP_STORE' }] },
        },
      }))) as typeof fetch,
    admin: {
      rpc: (_name: string, args: Record<string, unknown>) => {
        change = (args.p_changes as Record<string, unknown>[])[0];
        return Promise.resolve({ error: null });
      },
    } as never,
  });
  assertEquals(response.status, 200);
  assertEquals(change?.is_active, true);
  assertEquals(change?.product_id, 'lifetime');
  assertEquals(change?.store, 'app_store');
});
