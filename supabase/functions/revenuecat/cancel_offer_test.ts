// BE-62 (c) / D61 (3): the webhook queues the one `cancel_offer` push only for a customer cancel
// (CANCELLATION + UNSUBSCRIBE) whose canonical RevenueCat snapshot is an App Store trial or
// yearly period that is still running and will not renew. Webhook fields never decide it.
import { assertEquals } from 'jsr:@std/assert@1';
import { handle } from './index.ts';

const A = '00000000-0000-4000-a000-00000000c001';
const NOW = Date.parse('2026-11-20T12:00:00Z');
const day = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

type Sub = {
  store?: string;
  period_type?: string;
  purchase_date?: string;
  expires?: string;
  unsubscribed?: boolean;
};
const run = async (
  event: Record<string, unknown>,
  sub: Sub = {},
  rpcError: (name: string) => boolean = () => false,
) => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const expires = sub.expires ?? iso(NOW + 5 * day);
  const response = await handle(
    new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({
        event: {
          id: `evt-${crypto.randomUUID()}`,
          type: 'CANCELLATION',
          cancel_reason: 'UNSUBSCRIBE',
          event_timestamp_ms: NOW,
          app_user_id: A,
          entitlement_ids: ['premium'],
          // Webhook fields that must NOT matter (the snapshot decides):
          store: 'APP_STORE',
          period_type: 'TRIAL',
          expiration_at_ms: NOW + 100 * day,
          ...event,
        },
      }),
    }),
    () => Promise.resolve(true),
    {
      admin: {
        rpc: (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args });
          return Promise.resolve({ error: rpcError(name) ? { message: 'x' } : null });
        },
      } as never,
      now: () => new Date(NOW),
      getEnv: () => 'fixture-rest-key',
      fetch: (() =>
        Promise.resolve(Response.json({
          subscriber: {
            entitlements: { premium: { product_identifier: 'any_product', expires_date: expires } },
            subscriptions: {
              any_product: {
                store: sub.store ?? 'APP_STORE',
                period_type: sub.period_type ?? 'TRIAL',
                purchase_date: sub.purchase_date ?? iso(NOW - 2 * day),
                expires_date: expires,
                unsubscribe_detected_at: sub.unsubscribed === false ? null : iso(NOW - 1000),
              },
            },
          },
        }))) as typeof fetch,
    },
  );
  return { status: response.status, calls };
};
const queued = (calls: { name: string; args: Record<string, unknown> }[]) =>
  calls.filter((c) => c.name === 'queue_cancel_offer').map((c) => c.args);

Deno.test('trial cancelled in the App Store, still running: queued once after the write', async () => {
  const { status, calls } = await run({});
  assertEquals(status, 200);
  assertEquals(calls.map((c) => c.name), ['apply_revenuecat_event', 'queue_cancel_offer']);
  assertEquals(queued(calls), [{ p_user: A, p_cancelled: true, p_now: iso(NOW) }]);
});

Deno.test('yearly paid period cancelled: queued (yearly told by period length, no product id)', async () => {
  const { calls } = await run({}, {
    period_type: 'NORMAL',
    purchase_date: iso(NOW - 60 * day),
    expires: iso(NOW + 305 * day),
  });
  assertEquals(queued(calls).length, 1);
});

Deno.test('not queued: monthly, intro/prepaid period, Play Store, period ending within the hour, still renewing', async () => {
  // (still renewing → an unqueue call, never a queue)
  const cases: Sub[] = [
    { period_type: 'NORMAL', purchase_date: iso(NOW - 10 * day), expires: iso(NOW + 20 * day) },
    { period_type: 'INTRO' },
    { period_type: 'PREPAID' },
    { store: 'PLAY_STORE' },
    { expires: iso(NOW + 30 * 60 * 1000) },
    { unsubscribed: false },
  ];
  for (const sub of cases) {
    const { status, calls } = await run({}, sub);
    assertEquals(status, 200, JSON.stringify(sub));
    assertEquals(queued(calls).filter((c) => c.p_cancelled), [], JSON.stringify(sub));
  }
});

Deno.test('not queued: refunds, billing errors and other cancel reasons or event types', async () => {
  for (
    const event of [
      { cancel_reason: 'CUSTOMER_SUPPORT' },
      { cancel_reason: 'BILLING_ERROR' },
      { cancel_reason: 'DEVELOPER_INITIATED' },
      { cancel_reason: undefined },
      { type: 'BILLING_ISSUE' },
      { type: 'EXPIRATION' },
    ]
  ) {
    const { calls } = await run(event);
    assertEquals(queued(calls), [], JSON.stringify(event));
  }
});

Deno.test('UNCANCELLATION with auto-renew back on unqueues', async () => {
  const { calls } = await run({ type: 'UNCANCELLATION', cancel_reason: undefined }, {
    unsubscribed: false,
  });
  assertEquals(queued(calls), [{ p_user: A, p_cancelled: false, p_now: iso(NOW) }]);
});

Deno.test('BE-63: any event whose snapshot renews again unqueues (not only UNCANCELLATION)', async () => {
  for (const type of ['RENEWAL', 'PRODUCT_CHANGE', 'INITIAL_PURCHASE', 'UNCANCELLATION']) {
    const { status, calls } = await run({ type, cancel_reason: undefined }, {
      unsubscribed: false,
      period_type: 'NORMAL',
    });
    assertEquals(status, 200, type);
    assertEquals(queued(calls), [{ p_user: A, p_cancelled: false, p_now: iso(NOW) }], type);
  }
  // A CANCELLATION whose canonical snapshot still renews (forged or stale webhook) unqueues too.
  const stale = await run({}, { unsubscribed: false });
  assertEquals(queued(stale.calls), [{ p_user: A, p_cancelled: false, p_now: iso(NOW) }]);
  // Not renewing or no longer active: no unqueue call (the cron drops rows whose period ended).
  const expired = await run({ type: 'EXPIRATION', cancel_reason: undefined }, {
    unsubscribed: false,
    expires: iso(NOW - day),
  });
  assertEquals(queued(expired.calls), []);
});

Deno.test('a failed queue call is a 500 so RevenueCat retries; a failed write never queues', async () => {
  const failedQueue = await run({}, {}, (name) => name === 'queue_cancel_offer');
  assertEquals(failedQueue.status, 500);
  const failedWrite = await run({}, {}, (name) => name === 'apply_revenuecat_event');
  assertEquals(failedWrite.status, 500);
  assertEquals(queued(failedWrite.calls), []);
});
