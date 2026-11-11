// QA-06: purchases across the boundary (CONTRACTS §6, BE-18, BE-08 partner_premium, D29).
// The real `revenuecat` and `notify` handlers run over HTTP in qa/functions/purchase_harness.ts
// against this local stack; only RevenueCat's REST API and Expo delivery are faked. Every event
// is a payload from qa/fixtures/revenuecat-events.json (ids and timestamps as in the fixture
// unless a case says otherwise). What RevenueCat answers for the subscriber is set per case,
// relative to the real clock, because the database judges `expires_at` with its own now().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ID,
  admin,
  as,
  ensureContent,
  expectCode,
  expectPermissionDenied,
  loose,
  must,
  ok,
  pair,
  resetWorld,
  sql,
} from './helpers';
import type { PersonaName } from './personas';
import { startHarness, WEBHOOK_SECRET, type Harness, type Subscriber } from './purchase-harness';

type Fixture = { payload: { api_version: string; event: Record<string, unknown> } };
const fixtures = JSON.parse(
  fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'fixtures',
      'revenuecat-events.json',
    ),
    'utf8',
  ),
).events as Record<string, Fixture>;

/** The bug that kept the database's push dispatch from authenticating (BE-08; fixed by BE-37). */
const PUSH_BUG = '#126';
const MAYA = ID.maya; // the fixtures' app_user_id (a001)
const SAM = ID.sam; // the fixtures' transfer target (a002)
const PERSONA_IDS = Object.values(ID);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A fixture payload, deep-copied, with event fields overridden. */
function event(name: string, over: Record<string, unknown> = {}) {
  const f = fixtures[name];
  if (!f) throw new Error(`fixture ${name} missing`);
  const copy = structuredClone(f.payload);
  Object.assign(copy.event, over);
  return copy;
}
const ts = (name: string) => new Date(fixtures[name].payload.event.event_timestamp_ms as number);

/** RevenueCat v1 subscriber with an active `premium` entitlement. */
function premium(opts: {
  expires: Date | null;
  product?: string;
  store?: string;
  grace?: Date | null;
  nonRenewing?: boolean;
}): Subscriber {
  const product = opts.product ?? 'yearly_trial';
  const store = opts.store ?? 'APP_STORE';
  return {
    entitlements: {
      premium: {
        product_identifier: product,
        expires_date: opts.expires?.toISOString() ?? null,
        grace_period_expires_date: opts.grace?.toISOString() ?? null,
      },
    },
    subscriptions: opts.nonRenewing ? {} : { [product]: { store } },
    non_subscriptions: opts.nonRenewing ? { [product]: [{ store }] } : {},
  };
}
const NO_PREMIUM: Subscriber = { entitlements: {}, subscriptions: {} };

const iso = (d: Date | null) => (d === null ? null : d.toISOString());
async function row(user: string) {
  const r = must(await admin.from('entitlements').select('*').eq('user_id', user), 'read row');
  return r[0] ?? null;
}
async function rowAt(user: string) {
  const r = await row(user);
  return (
    r && {
      ...r,
      expires_at: r.expires_at && new Date(r.expires_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    }
  );
}
async function ledger(id: string): Promise<number> {
  return (
    await sql<{ n: number }>(
      'select count(*)::int n from private.revenuecat_events where event_id = $1',
      [id],
    )
  )[0].n;
}
async function couplePremium(user: string): Promise<boolean> {
  const r = await sql<{ p: boolean | null }>(
    `select private.is_couple_premium(m.couple_id) p from public.couple_members m
       join public.couples c on c.id = m.couple_id
      where m.user_id = $1 and m.left_at is null and c.status = 'active'`,
    [user],
  );
  return r[0]?.p ?? false;
}

/**
 * Premium as the app computes it (CONTRACTS §6): the entitlements rows `who` can read, for
 * themselves and their **current** partner, active and unexpired at check time.
 */
async function appPremium(who: PersonaName): Promise<{ mine: boolean; partner: boolean }> {
  const me = ID[who];
  const members = must(
    await admin
      .from('couple_members')
      .select('couple_id, user_id, left_at, couples!inner(status)')
      .is('left_at', null)
      .eq('couples.status', 'active'),
    'members',
  );
  const mine = members.find((m) => m.user_id === me);
  const partnerId =
    members.find((m) => mine && m.couple_id === mine.couple_id && m.user_id !== me)?.user_id ??
    null;
  const rows = must(await as(who).from('entitlements').select('*'), `${who} entitlements`);
  const live = (id: string | null) =>
    rows.some(
      (r) =>
        id !== null &&
        r.user_id === id &&
        r.is_active &&
        (r.expires_at === null || Date.parse(r.expires_at) > Date.now()),
    );
  return { mine: live(me), partner: live(partnerId) };
}

let h: Harness;
let Q: Awaited<ReturnType<typeof ensureContent>>;

async function cleanSlate() {
  await resetWorld();
  await sql(
    `delete from private.revenuecat_events where event_id like 'fixture-%' or event_id like 'qa06-%'`,
  );
  ok(await admin.from('push_log').delete().in('user_id', PERSONA_IDS), 'clear push_log');
  await h.reset();
}

/** Sends a webhook and waits for any push it dispatched to be handled. */
async function deliver(payload: unknown, expectStatus = 200) {
  const mark = await h.mark();
  const res = await h.webhook(payload);
  expect(res.status, JSON.stringify(res.body)).toBe(expectStatus);
  await h.drain(mark);
  return res;
}
/**
 * BE-48b (CONTRACTS §6): the webhook stamps its write with max(event time, lookup time), because
 * every write is a fresh canonical snapshot. To keep `updated_at` exact, each delivery freezes the
 * handler's lookup clock at a strictly increasing real time (the snapshot's `is_active` is judged
 * against the same clock, so it stays real), or at `at` when a case needs a given lookup time.
 * Returns the stamp the row must carry if the write is applied.
 */
let lastLookup = 0;
async function deliverStamped(payload: { event: Record<string, unknown> }, at?: Date) {
  const lookup = at ?? new Date(Math.max(Date.now(), lastLookup + 1));
  lastLookup = Math.max(lastLookup, lookup.getTime());
  await h.setClock(lookup);
  const res = await deliver(payload);
  const stamp = new Date(Math.max(payload.event.event_timestamp_ms as number, lookup.getTime()));
  return { res, lookup, stamp: stamp.toISOString() };
}
const premiumDispatches = async () =>
  (await h.state()).dispatches.filter((d) => d.type === 'partner_premium');
const premiumLog = async () =>
  must(
    await admin
      .from('push_log')
      .select('user_id, status')
      .eq('type', 'partner_premium')
      .in('user_id', PERSONA_IDS),
    'push_log',
  );
const premiumSent = async () =>
  (await h.state()).sent.filter((m) => m.data.type === 'partner_premium');
/** notify's answers to the database's own partner_premium requests (not h.replay), in order. */
const premiumDelivered = async () =>
  (await h.state()).results
    .filter((r) => !r.replay && r.type === 'partner_premium')
    .map(({ status, body }) => ({ status, body }));
const SENT = { status: 200, body: { sent: 1, suppressed: 0 } };
const SUPPRESSED = { status: 200, body: { sent: 0, suppressed: 1 } };

beforeAll(async () => {
  h = await startHarness();
  Q = await ensureContent();
}, 90_000);
afterAll(async () => {
  await h?.stop();
  await resetWorld();
});

// ───────────────────────────── 1. Webhook contract ─────────────────────────────

describe('revenuecat webhook over HTTP: one case per fixture event (BE-18)', () => {
  beforeEach(cleanSlate);

  it('INITIAL_PURCHASE (trial): active row with product, lower-case store, expiry, max(event, lookup) time', async () => {
    const expires = new Date(Date.now() + 7 * DAY);
    await h.setSubscriber(MAYA, premium({ expires }));
    const { res, lookup, stamp } = await deliverStamped(event('initial_purchase_trial'));
    expect(res.body).toEqual({ ok: true });
    // The fixture event (2026-11-02) is older than the lookup: the lookup time wins (BE-48b).
    expect(lookup.getTime()).toBeGreaterThan(ts('initial_purchase_trial').getTime());
    expect(await rowAt(MAYA)).toEqual({
      user_id: MAYA,
      is_active: true,
      product_id: 'yearly_trial',
      store: 'app_store',
      expires_at: iso(expires),
      updated_at: stamp,
    });
    expect(stamp).toBe(iso(lookup));
    expect(await ledger('fixture-initial_purchase-1')).toBe(1);
    const { lookups } = await h.state();
    expect(lookups).toEqual([{ user: MAYA, authorized: true }]);
  });

  it('RENEWAL: moves expires_at and updated_at forward', async () => {
    await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() + 7 * DAY) }));
    const first = await deliverStamped(event('initial_purchase_trial'));
    const renewed = new Date(Date.now() + 365 * DAY);
    await h.setSubscriber(MAYA, premium({ expires: renewed }));
    const { stamp } = await deliverStamped(event('renewal'));
    expect(Date.parse(stamp)).toBeGreaterThan(Date.parse(first.stamp));
    expect(await rowAt(MAYA)).toMatchObject({
      is_active: true,
      product_id: 'yearly_trial',
      expires_at: iso(renewed),
      updated_at: stamp,
    });
  });

  it('PRODUCT_CHANGE: a deferred change keeps the current product until RevenueCat moves it', async () => {
    const expires = new Date(Date.now() + 7 * DAY);
    await h.setSubscriber(MAYA, premium({ expires }));
    await deliverStamped(event('initial_purchase_trial'));
    // The fixture asks for yearly_trial -> monthly; RevenueCat still reports yearly_trial.
    const { stamp } = await deliverStamped(event('product_change'));
    expect(await rowAt(MAYA)).toMatchObject({
      is_active: true,
      product_id: 'yearly_trial',
      expires_at: iso(expires),
      updated_at: stamp,
    });
  });

  it('CANCELLATION: stays premium until the end of the paid period', async () => {
    const expires = new Date(Date.now() + 5 * DAY);
    await h.setSubscriber(MAYA, premium({ expires }));
    await deliverStamped(event('initial_purchase_trial'));
    const { stamp } = await deliverStamped(event('cancellation'));
    expect(await rowAt(MAYA)).toMatchObject({
      is_active: true,
      expires_at: iso(expires),
      updated_at: stamp,
    });
  });

  it('UNCANCELLATION: active', async () => {
    const expires = new Date(Date.now() + 5 * DAY);
    await h.setSubscriber(MAYA, premium({ expires }));
    await deliverStamped(event('cancellation'));
    const { stamp } = await deliverStamped(event('uncancellation'));
    expect(await rowAt(MAYA)).toMatchObject({
      is_active: true,
      expires_at: iso(expires),
      updated_at: stamp,
    });
  });

  it('BILLING_ISSUE: paid period over, grace keeps premium; expires_at is the grace end', async () => {
    const paid = new Date(Date.now() - HOUR);
    const grace = new Date(Date.now() + 16 * DAY);
    await h.setSubscriber(MAYA, premium({ expires: paid, grace }));
    const { stamp } = await deliverStamped(event('billing_issue'));
    expect(await rowAt(MAYA)).toMatchObject({
      is_active: true,
      expires_at: iso(grace),
      updated_at: stamp,
    });
  });

  it('EXPIRATION: inactive, product/store/expiry cleared', async () => {
    await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() + DAY) }));
    await deliverStamped(event('renewal'));
    await h.setSubscriber(MAYA, NO_PREMIUM);
    const { stamp } = await deliverStamped(event('expiration'));
    expect(await rowAt(MAYA)).toEqual({
      user_id: MAYA,
      is_active: false,
      product_id: null,
      store: null,
      expires_at: null,
      updated_at: stamp,
    });
  });

  it('NON_RENEWING_PURCHASE (lifetime): active with no expiry', async () => {
    await h.setSubscriber(MAYA, premium({ expires: null, product: 'lifetime', nonRenewing: true }));
    await deliver(event('non_renewing'));
    expect(await rowAt(MAYA)).toMatchObject({
      is_active: true,
      product_id: 'lifetime',
      store: 'app_store',
      expires_at: null,
    });
  });

  it('TRANSFER: both sides refreshed (Maya loses it, Sam gets it on Play)', async () => {
    await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() + 7 * DAY) }));
    await deliver(event('initial_purchase_trial'));
    const expires = new Date(Date.now() + 30 * DAY);
    await h.reset(); // forget the purchase's lookup
    await h.setSubscriber(MAYA, NO_PREMIUM);
    await h.setSubscriber(SAM, premium({ expires, store: 'PLAY_STORE' }));
    const { stamp } = await deliverStamped(event('transfer'));
    expect(await rowAt(MAYA)).toMatchObject({ is_active: false, updated_at: stamp });
    expect(await rowAt(SAM)).toMatchObject({
      is_active: true,
      product_id: 'yearly_trial',
      store: 'play_store',
      expires_at: iso(expires),
      updated_at: stamp,
    });
    const users = (await h.state()).lookups.map((l) => l.user).sort();
    expect(users).toEqual([MAYA, SAM].sort());
  });

  it('TRANSFER with only anonymous ids: 200, no lookup, no write', async () => {
    const res = await deliver(
      event('transfer', {
        id: 'qa06-transfer-anon',
        transferred_from: ['$RCAnonymousID:x1'],
        transferred_to: ['$RCAnonymousID:x2'],
      }),
    );
    expect(res.body).toEqual({ ok: true });
    expect((await h.state()).lookups).toEqual([]);
    expect(await ledger('qa06-transfer-anon')).toBe(0);
  });
});

describe('revenuecat webhook: idempotency and ordering', () => {
  beforeEach(cleanSlate);

  it('the same event id twice has one effect (duplicate_delivery)', async () => {
    const expires = new Date(Date.now() + 7 * DAY);
    await h.setSubscriber(MAYA, premium({ expires }));
    await deliver(event('initial_purchase_trial'));
    const first = await rowAt(MAYA);
    // RevenueCat now says something else; a redelivery must still change nothing.
    await h.setSubscriber(MAYA, NO_PREMIUM);
    const again = await deliver(event('duplicate_delivery'));
    expect(again.body).toEqual({ ok: true });
    expect(await rowAt(MAYA)).toEqual(first);
    expect(await ledger('fixture-initial_purchase-1')).toBe(1);
  });

  it('the same id with a newer timestamp is still a duplicate', async () => {
    await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() + 7 * DAY) }));
    await deliver(event('initial_purchase_trial'));
    const first = await rowAt(MAYA);
    await h.setSubscriber(MAYA, NO_PREMIUM);
    await deliver(
      event('initial_purchase_trial', { event_timestamp_ms: ts('expiration').getTime() }),
    );
    expect(await rowAt(MAYA)).toEqual(first);
  });

  // BE-48b: a write is stamped max(event time, lookup time), so ordering protects against a
  // snapshot that was looked up before the stored one (concurrent deliveries), not against an old
  // event time: a late event triggers a fresh lookup, and that canonical snapshot is applied.
  it('an older EXPIRATION arriving after a RENEWAL writes the current snapshot: still premium (out_of_order_old_event)', async () => {
    const renewed = new Date(Date.now() + 365 * DAY);
    await h.setSubscriber(MAYA, premium({ expires: renewed }));
    const first = await deliverStamped(event('renewal'));
    const { stamp } = await deliverStamped(event('out_of_order_old_event'));
    expect(Date.parse(stamp)).toBeGreaterThan(Date.parse(first.stamp));
    expect(await rowAt(MAYA)).toMatchObject({
      is_active: true,
      expires_at: iso(renewed),
      updated_at: stamp,
    });
    expect(await ledger('fixture-old-1')).toBe(1); // recorded, so a redelivery is a no-op too
  });

  it('a late refund/cancel with an old event time after a newer write is applied (BE-48b)', async () => {
    await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() + 365 * DAY) }));
    const first = await deliverStamped(event('renewal'));
    // e.g. a revenuecat-sync stamped with its lookup time, then a refund webhook whose event
    // time is older than that stamp: RevenueCat now reports no premium, and that wins.
    await h.setSubscriber(MAYA, NO_PREMIUM);
    const { stamp } = await deliverStamped(event('out_of_order_old_event'));
    expect(ts('out_of_order_old_event').getTime()).toBeLessThan(Date.parse(first.stamp));
    expect(await rowAt(MAYA)).toEqual({
      user_id: MAYA,
      is_active: false,
      product_id: null,
      store: null,
      expires_at: null,
      updated_at: stamp,
    });
  });

  it('a snapshot looked up before the stored one is ignored (concurrent deliveries)', async () => {
    const renewed = new Date(Date.now() + 365 * DAY);
    await h.setSubscriber(MAYA, premium({ expires: renewed }));
    const newer = await deliverStamped(event('renewal'));
    await h.setSubscriber(MAYA, NO_PREMIUM);
    // Looked up a minute before the stored write, committed after it.
    await deliverStamped(
      event('out_of_order_old_event'),
      new Date(newer.lookup.getTime() - 60_000),
    );
    expect(await rowAt(MAYA)).toMatchObject({
      is_active: true,
      expires_at: iso(renewed),
      updated_at: newer.stamp,
    });
    expect(await ledger('fixture-old-1')).toBe(1);
  });

  it('a write with the same stamp as the stored row is ignored (lookup time)', async () => {
    const expires = new Date(Date.now() + 7 * DAY);
    await h.setSubscriber(MAYA, premium({ expires }));
    const first = await deliverStamped(event('initial_purchase_trial'));
    await h.setSubscriber(MAYA, NO_PREMIUM);
    await deliverStamped(
      event('expiration', {
        id: 'qa06-same-ts',
        event_timestamp_ms: ts('initial_purchase_trial').getTime(),
      }),
      first.lookup,
    );
    expect(await rowAt(MAYA)).toMatchObject({
      is_active: true,
      expires_at: iso(expires),
      updated_at: first.stamp,
    });
  });

  it('an event time later than the lookup is the stamp; the same event time again is ignored', async () => {
    const expires = new Date(Date.now() + 7 * DAY);
    const later = Date.now() + HOUR;
    await h.setSubscriber(MAYA, premium({ expires }));
    const first = await deliverStamped(
      event('initial_purchase_trial', { id: 'qa06-later-1', event_timestamp_ms: later }),
    );
    expect(first.stamp).toBe(new Date(later).toISOString());
    await h.setSubscriber(MAYA, NO_PREMIUM);
    await deliverStamped(event('expiration', { id: 'qa06-later-2', event_timestamp_ms: later }));
    expect(await rowAt(MAYA)).toMatchObject({
      is_active: true,
      expires_at: iso(expires),
      updated_at: first.stamp,
    });
  });

  it('a failed RevenueCat lookup is a retryable 500 with no write; the retry applies', async () => {
    await h.failLookup(MAYA, 503);
    const res = await deliver(event('initial_purchase_trial'), 500);
    expect(res.body).toEqual({ error: 'INTERNAL_ERROR', message: 'Webhook processing failed' });
    expect(await row(MAYA)).toBeNull();
    expect(await ledger('fixture-initial_purchase-1')).toBe(0);
    await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() + 7 * DAY) }));
    await deliver(event('initial_purchase_trial'));
    expect(await rowAt(MAYA)).toMatchObject({ is_active: true });
  });

  it('a malformed RevenueCat answer is a 500 with no write', async () => {
    await h.setSubscriber(MAYA, { entitlements: { premium: 'yes' } });
    await deliver(event('initial_purchase_trial'), 500);
    expect(await row(MAYA)).toBeNull();
    expect(await ledger('fixture-initial_purchase-1')).toBe(0);
  });
});

describe('revenuecat webhook: auth, input and unknown users', () => {
  beforeEach(cleanSlate);

  it.each([
    [
      'the fixture bad_auth header',
      (fixtures.bad_auth as unknown as { headers: { Authorization: string } }).headers
        .Authorization,
    ],
    ['no Authorization header', null],
    ['an empty header', ''],
    ['the secret without Bearer', WEBHOOK_SECRET],
    ['Basic with the secret', `Basic ${WEBHOOK_SECRET}`],
    ['a longer secret', `Bearer ${WEBHOOK_SECRET}x`],
  ])('%s: 401 before any lookup or write', async (_label, auth) => {
    await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() + 7 * DAY) }));
    const res = await h.webhook(event('bad_auth'), auth);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHORIZED', message: 'Unauthorized' });
    expect((await h.state()).lookups).toEqual([]);
    expect(await row(MAYA)).toBeNull();
    expect(await ledger('fixture-initial_purchase-1')).toBe(0);
  });

  it('the anonymous_user fixture: 200, no lookup, no write', async () => {
    const res = await deliver(event('anonymous_user'));
    expect(res.body).toEqual({ ok: true });
    expect((await h.state()).lookups).toEqual([]);
    expect(await ledger('fixture-anon-1')).toBe(0);
  });

  it('an unknown (deleted) user id: 200, recorded, no entitlements row is created', async () => {
    const ghost = '00000000-0000-4000-a000-0000000ffff1';
    await h.setSubscriber(ghost, premium({ expires: new Date(Date.now() + 7 * DAY) }));
    await deliver(
      event('initial_purchase_trial', {
        id: 'qa06-ghost',
        app_user_id: ghost,
        original_app_user_id: ghost,
        aliases: [ghost],
      }),
    );
    expect(await row(ghost)).toBeNull();
    expect(await ledger('qa06-ghost')).toBe(1);
  });

  it('a non-UUID app_user_id (not our id scheme) is a 400 with no lookup', async () => {
    const res = await deliver(
      event('initial_purchase_trial', { id: 'qa06-custom-id', app_user_id: 'maya@example.test' }),
      400,
    );
    expect(res.body).toEqual({ error: 'BAD_REQUEST', message: 'Invalid webhook' });
    expect((await h.state()).lookups).toEqual([]);
  });

  it('an unrelated entitlement and an unsupported type: 200, no lookup, no write', async () => {
    await deliver(
      event('initial_purchase_trial', { id: 'qa06-other-ent', entitlement_ids: ['other'] }),
    );
    await deliver(
      event('initial_purchase_trial', { id: 'qa06-paused', type: 'SUBSCRIPTION_PAUSED' }),
    );
    await deliver(event('initial_purchase_trial', { id: 'qa06-test', type: 'TEST' }));
    expect((await h.state()).lookups).toEqual([]);
    expect(await row(MAYA)).toBeNull();
  });

  it('bad bodies are 400: not JSON, no event, no id, a body over 64 KiB, GET', async () => {
    const bad = async (init: { method?: string; rawBody?: string }) => {
      const res = await h.webhook(null, undefined, init);
      expect(res.status, JSON.stringify(init).slice(0, 60)).toBe(400);
      expect(res.body).toEqual({ error: 'BAD_REQUEST', message: 'Invalid webhook' });
    };
    await bad({ rawBody: 'not json' });
    await bad({ rawBody: '{}' });
    await bad({ rawBody: JSON.stringify(event('initial_purchase_trial', { id: '' })) });
    const big = event('initial_purchase_trial', { id: 'qa06-big', pad: 'x'.repeat(70_000) });
    await bad({ rawBody: JSON.stringify(big) });
    await bad({ method: 'GET' });
    expect((await h.state()).lookups).toEqual([]);
    expect(await row(MAYA)).toBeNull();
  });

  it('users cannot write entitlements or call apply_revenuecat_event themselves', async () => {
    expectPermissionDenied(
      await loose(as('maya')).rpc('apply_revenuecat_event', {
        p_event_id: 'qa06-self',
        p_occurred_at: new Date().toISOString(),
        p_changes: [
          { user_id: MAYA, is_active: true, product_id: 'x', store: 'x', expires_at: null },
        ],
      }),
    );
    const ins = await loose(as('maya'))
      .from('entitlements')
      .insert({ user_id: MAYA, is_active: true });
    expect(ins.error).not.toBeNull();
    expect(await row(MAYA)).toBeNull();
  });
});

// ───────────────────────────── 2. Partner premium (D29) ─────────────────────────────

/** 17:00Z = 12:00 in New York (Sam) and 18:00 in Berlin (Maya): outside quiet hours. */
const DAYTIME = new Date('2026-11-10T17:00:00Z');
/** 09:00Z = 04:00 in New York: inside Sam's default quiet hours (23:00-07:00). */
const NIGHT_NY = new Date('2026-11-10T09:00:00Z');
const SAM_TOKEN = 'ExponentPushToken[FIXTURE-QA06-SAM]';
const MAYA_TOKEN = 'ExponentPushToken[FIXTURE-QA06-MAYA]';

async function pairedWithTokens() {
  const mark = await h.mark();
  await pair('maya', 'sam');
  ok(
    await admin.from('push_tokens').upsert(
      [
        { user_id: SAM, token: SAM_TOKEN, platform: 'ios' },
        { user_id: MAYA, token: MAYA_TOKEN, platform: 'android' },
      ],
      { onConflict: 'token' },
    ),
    'tokens',
  );
  await h.drain(mark); // pairing dispatched partner_joined; start counting after it
  await h.reset();
  await h.setClock(DAYTIME);
}
const mayaBuys = async (id = 'fixture-initial_purchase-1', over: Record<string, unknown> = {}) => {
  await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() + 7 * DAY) }));
  return deliver(event('initial_purchase_trial', { id, ...over }));
};

describe('partner premium: the current partner is premium by the server rules (D29)', () => {
  beforeEach(async () => {
    await cleanSlate();
    await pairedWithTokens();
  });

  it("before: Sam is not premium and a premium pack is PREMIUM_REQUIRED; after Maya's purchase he is", async () => {
    expect(await appPremium('sam')).toEqual({ mine: false, partner: false });
    expectCode(
      await as('sam').rpc('start_pack_question', { p_question: Q.premium }),
      'PREMIUM_REQUIRED',
    );
    await mayaBuys();
    expect(await appPremium('sam')).toEqual({ mine: false, partner: true });
    expect(await appPremium('maya')).toEqual({ mine: true, partner: false });
    expect(await couplePremium(SAM)).toBe(true);
    must(
      await as('sam').rpc('start_pack_question', { p_question: Q.premium }),
      'Sam opens a premium pack question',
    );
  });

  it('partner_premium is dispatched once: the couple, Maya as actor, the ledger record', async () => {
    await mayaBuys();
    const d = await premiumDispatches();
    expect(d).toHaveLength(1);
    const [{ couple_id }] = must(
      await admin.from('couple_members').select('couple_id').eq('user_id', SAM).is('left_at', null),
      'couple',
    );
    const [{ record_id }] = await sql<{ record_id: string }>(
      'select record_id::text from private.revenuecat_events where event_id = $1',
      ['fixture-initial_purchase-1'],
    );
    expect(d[0]).toMatchObject({
      type: 'partner_premium',
      record_id,
      couple_id,
      couple_question_id: null,
      actor_user_id: MAYA,
    });
  });

  // The database's dispatch (dispatch_notify -> pg_net) reaches notify authenticated: the secret
  // in the Authorization header, nothing in the query string (#126, fixed by BE-37).
  it(`the database's notify request authenticates and is delivered (${PUSH_BUG})`, async () => {
    await mayaBuys();
    const [d] = await premiumDispatches();
    expect(d._transport).toEqual({
      authorization_header: true,
      bearer_matches: true,
      query_keys: [],
    });
    expect(await premiumDelivered()).toEqual([SENT]);
    expect(await premiumSent()).toHaveLength(1);
  });

  it('notify delivers it to Sam only, with the approved copy and the packs link', async () => {
    await mayaBuys();
    const [d] = await premiumDispatches();
    // The database's own request, not a replay.
    expect(await premiumDelivered()).toEqual([SENT]);
    expect(await premiumSent()).toEqual([
      {
        to: SAM_TOKEN,
        title: "You're both Premium",
        body: "Maya's plan covers you too. Every pack is open.",
        sound: 'default',
        channelId: 'partner_premium',
        data: { type: 'partner_premium', url: 'bonded://packs' },
      },
    ]);
    expect(await premiumLog()).toEqual([{ user_id: SAM, status: 'sent' }]);
    // The same dispatch again (a retry) is claimed once: no second push.
    expect(await h.replay(d)).toEqual(SUPPRESSED);
    expect(await premiumSent()).toHaveLength(1);
    expect(await premiumLog()).toEqual([{ user_id: SAM, status: 'sent' }]);
  });

  it('redelivery, renewal, cancellation and uncancellation do not dispatch again', async () => {
    await mayaBuys();
    await deliver(event('duplicate_delivery'));
    await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() + 365 * DAY) }));
    await deliver(event('renewal'));
    await deliver(event('cancellation'));
    await deliver(event('uncancellation'));
    expect(await premiumDispatches()).toHaveLength(1);
  });

  it('already premium (Sam has his own plan): Maya buying dispatches nothing', async () => {
    await h.setSubscriber(SAM, premium({ expires: new Date(Date.now() + 30 * DAY) }));
    await deliver(
      event('initial_purchase_trial', {
        id: 'qa06-sam-own',
        app_user_id: SAM,
        original_app_user_id: SAM,
        aliases: [SAM],
      }),
    );
    const first = await premiumDispatches();
    expect(first).toHaveLength(1); // Sam's own purchase covers Maya: she is told
    expect(first[0].actor_user_id).toBe(SAM);
    await mayaBuys();
    expect(await premiumDispatches()).toHaveLength(1);
  });

  it('a transfer inside a premium couple does not push', async () => {
    await mayaBuys();
    await h.setSubscriber(MAYA, NO_PREMIUM);
    await h.setSubscriber(SAM, premium({ expires: new Date(Date.now() + 30 * DAY) }));
    await deliver(event('transfer'));
    expect(await couplePremium(SAM)).toBe(true);
    expect(await premiumDispatches()).toHaveLength(1);
  });

  it('expiry is respected: an active row whose expires_at has passed grants nothing', async () => {
    // RevenueCat's last word was "active until an hour ago" (no EXPIRATION delivered yet).
    await h.setClock(new Date(Date.now() - 2 * HOUR));
    await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() - HOUR) }));
    await deliver(event('initial_purchase_trial'));
    expect(await rowAt(MAYA)).toMatchObject({ is_active: true });
    expect(await appPremium('sam')).toEqual({ mine: false, partner: false });
    expect(await couplePremium(SAM)).toBe(false);
    expectCode(
      await as('sam').rpc('start_pack_question', { p_question: Q.premium }),
      'PREMIUM_REQUIRED',
    );
    expect(await premiumDispatches()).toEqual([]);
  });

  it('EXPIRATION ends it for the partner too', async () => {
    await mayaBuys();
    await h.setSubscriber(MAYA, NO_PREMIUM);
    await deliver(event('expiration'));
    expect(await appPremium('sam')).toEqual({ mine: false, partner: false });
    expect(await couplePremium(SAM)).toBe(false);
  });

  it('billing grace keeps the partner premium', async () => {
    await h.setSubscriber(
      MAYA,
      premium({ expires: new Date(Date.now() - HOUR), grace: new Date(Date.now() + 10 * DAY) }),
    );
    await deliver(event('billing_issue'));
    expect(await appPremium('sam')).toEqual({ mine: false, partner: true });
    expect(await couplePremium(SAM)).toBe(true);
  });

  it('a former partner is not covered: Sam unpairs and pairs with Lea', async () => {
    await mayaBuys();
    ok(await as('sam').rpc('unpair'), 'sam unpairs');
    await pair('sam', 'lea');
    await h.reset();
    await h.setClock(DAYTIME);
    // Maya's row may stay readable to Sam for a while (recent partner); it must not count.
    expect(await appPremium('sam')).toEqual({ mine: false, partner: false });
    expect(await appPremium('lea')).toEqual({ mine: false, partner: false });
    expect(await couplePremium(SAM)).toBe(false);
    expectCode(
      await as('sam').rpc('start_pack_question', { p_question: Q.premium }),
      'PREMIUM_REQUIRED',
    );
    // A later renewal of Maya's plan tells nobody.
    await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() + 365 * DAY) }));
    await deliver(event('renewal'));
    expect(await premiumDispatches()).toEqual([]);
  });
});

describe('partner premium push: quiet hours and caps (notifications.json)', () => {
  // Every result here is notify's answer to the database's own request (pg_net), not a replay.
  beforeEach(async () => {
    await cleanSlate();
    await pairedWithTokens();
  });

  it("inside Sam's quiet hours: suppressed before a claim, and a redelivery does not dispatch it again", async () => {
    await h.setClock(NIGHT_NY);
    await mayaBuys();
    expect(await premiumDispatches()).toHaveLength(1);
    expect(await premiumDelivered()).toEqual([SUPPRESSED]);
    expect(await premiumSent()).toEqual([]);
    expect(await premiumLog()).toEqual([]);
    await h.setClock(DAYTIME);
    await deliver(event('duplicate_delivery'));
    expect(await premiumDispatches()).toHaveLength(1);
    expect(await couplePremium(SAM)).toBe(true); // the entitlement is not lost
  });

  it('one partner_premium a day: expire and buy again the same day, the second is suppressed', async () => {
    await mayaBuys();
    expect(await premiumDelivered()).toEqual([SENT]);
    expect(await premiumLog()).toEqual([{ user_id: SAM, status: 'sent' }]);
    await h.setSubscriber(MAYA, NO_PREMIUM);
    await deliver(event('expiration'));
    expect(await couplePremium(SAM)).toBe(false);
    await h.setSubscriber(MAYA, premium({ expires: new Date(Date.now() + 30 * DAY) }));
    await deliver(
      event('initial_purchase_trial', {
        id: 'qa06-rebuy',
        event_timestamp_ms: ts('expiration').getTime() + HOUR,
      }),
    );
    expect(await couplePremium(SAM)).toBe(true);
    expect(await premiumDispatches()).toHaveLength(2); // the couple did go free -> premium again
    expect(await premiumDelivered()).toEqual([SENT, SUPPRESSED]);
    expect(await premiumSent()).toHaveLength(1);
    expect(await premiumLog()).toEqual([{ user_id: SAM, status: 'sent' }]);
  });

  it('four pushes already today: the daily cap suppresses partner_premium', async () => {
    ok(
      await admin.from('push_log').insert(
        (['partner_answered', 'both_answered', 'nudge', 'partner_joined'] as const).map((type) => ({
          user_id: SAM,
          type,
          record_id: crypto.randomUUID(),
          local_date: '2026-11-10', // DAYTIME in New York
          status: 'sent',
        })),
      ),
      'four earlier pushes',
    );
    await mayaBuys();
    expect(await premiumDispatches()).toHaveLength(1);
    expect(await premiumDelivered()).toEqual([SUPPRESSED]);
    expect(await premiumSent()).toEqual([]);
  });
});

describe('database dispatch transport: the secret travels as a header (#126, BE-37)', () => {
  beforeEach(async () => {
    await cleanSlate();
  });

  it('private.dispatch_daily_reminders() sends one POST with the bearer header and no query string', async () => {
    const mark = await h.mark();
    await sql('select private.dispatch_daily_reminders()');
    await h.drain(mark);
    expect((await h.state()).reminders).toEqual([
      { method: 'POST', authorization_header: true, bearer_matches: true, query_keys: [] },
    ]);
    // pg_net recorded one answered request, a 200 from the harness.
    const r = await sql<{ status_code: number }>(
      'select status_code from net._http_response where id > $1',
      [mark],
    );
    expect(r).toEqual([{ status_code: 200 }]);
  });
});
