// BE-61 (PO 2026-11-13): premium is decided by the `premium` entitlement only, never by a
// product id. The store ids (`yearly`, `monthly`, `yearly_day3`, `yearly_exit30`), the
// RevenueCat Test Store ids (`*_v2`) and any future id must all behave the same; another
// entitlement (RevenueCat's sample `bonded_pro`) never grants premium, whatever its product.
import { assertEquals } from 'jsr:@std/assert@1';
import { snapshot } from '../_shared/revenuecat.ts';

const U = '00000000-0000-4000-a000-00000000a061';
const NOW = new Date('2026-11-13T12:00:00Z');
const END = '2027-11-13T12:00:00Z';
const lookup = (body: unknown) => ({
  now: () => NOW,
  getEnv: () => 'fixture-rest-key',
  fetch: (() => Promise.resolve(Response.json(body))) as unknown as typeof fetch,
});
const subscriber = (entitlement: string, product: string, period = 'normal') => ({
  subscriber: {
    entitlements: { [entitlement]: { product_identifier: product, expires_date: END } },
    subscriptions: {
      [product]: {
        store: 'TEST_STORE',
        period_type: period,
        purchase_date: '2026-11-13T11:00:00Z',
      },
    },
  },
});

const ids = [
  'yearly',
  'monthly',
  'yearly_day3',
  'yearly_exit30',
  'yearly_v2',
  'monthly_v2',
  'yearly_day3_v2',
  'yearly_exit30_v2',
  'some_future_product_v3',
];

Deno.test('every product under the premium entitlement grants premium, id stored as sent', async () => {
  for (const id of ids) {
    const change = await snapshot(U, lookup(subscriber('premium', id, 'intro')));
    assertEquals(change.is_active, true, id);
    assertEquals(change.product_id, id, id);
    assertEquals(change.expires_at, new Date(END).toISOString(), id);
    assertEquals(change.store, 'test_store', id);
    assertEquals(change.period_type, 'intro', id);
  }
});

Deno.test('a product under another entitlement never grants premium', async () => {
  for (const id of ['yearly', 'monthly', 'lifetime', 'yearly_v2']) {
    const change = await snapshot(U, lookup(subscriber('bonded_pro', id)));
    assertEquals(change.is_active, false, id);
    assertEquals(change.product_id, null, id);
    assertEquals(change.store, null, id);
  }
});
