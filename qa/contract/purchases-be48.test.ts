// QA-33 part 3: BE-48 (D50, purchase on P3 before sign-in) across the boundary, CONTRACTS §3/§6.
//   1. The revenuecat webhook resolves the Supabase user from app_user_id, original_app_user_id
//      and aliases; each UUID gets only its own canonical snapshot; anonymous-only events and
//      TRANSFERs write nothing; ids are used exactly as sent, and only the canonical lower-case uid
//      names an account (BE-48c, #167).
//   2. revenuecat-sync (user JWT, own entitlement only): auth, method, the per-user 30 s limit and
//      the BE-48b global cap of 120 lookups per UTC minute (a global refusal leaves the caller's
//      30 s slot alone), failures, and partner_premium when a sync makes the couple premium.
//   3. trial_ending: private trial state from the snapshot, service-only due_trial_endings
//      (start + 4 days or end - 2 days, 24 h window, quiet hours, once per trial, cancelled /
//      billing issue / converted trials skipped) and the push from the real daily-reminder handler.
// The real revenuecat, revenuecat-sync, notify and daily-reminder handlers run in
// qa/functions/purchase_harness.ts; only RevenueCat's REST API and Expo delivery are faked.
// Clocks are explicit: the harness clock for the handlers, p_now for the service-only RPCs.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ID,
  admin,
  anon,
  as,
  ensureContent,
  expectPermissionDenied,
  must,
  ok,
  pair,
  resetWorld,
  sql,
  tokenOf,
} from './helpers';
import { startHarness, type Harness, type Subscriber } from './purchase-harness';

const MAYA = ID.maya;
const SAM = ID.sam;
const PERSONA_IDS = Object.values(ID);
const ANON = '$RCAnonymousID:qa33fixture000000000000000001';
const ANON2 = '$RCAnonymousID:qa33fixture000000000000000002';
const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const PRODUCT = 'yearly_trial';
/** Prices and currencies that must never be in trial/offer push text (prices only from RevenueCat). */
const PRICE = /[$€£¥]|\d+[.,]\d{2}\b|%/;

/** RevenueCat v1 subscriber with an active (or expired) `premium` entitlement. */
function premium(opts: {
  expires: Date;
  period?: 'TRIAL' | 'NORMAL' | 'INTRO';
  start?: Date;
  unsubscribed?: Date;
  billingIssue?: Date;
  product?: string;
}): Subscriber {
  const product = opts.product ?? PRODUCT;
  return {
    entitlements: {
      premium: {
        product_identifier: product,
        expires_date: opts.expires.toISOString(),
        grace_period_expires_date: null,
      },
    },
    subscriptions: {
      [product]: {
        store: 'APP_STORE',
        period_type: opts.period ?? 'NORMAL',
        purchase_date: (opts.start ?? new Date()).toISOString(),
        unsubscribe_detected_at: opts.unsubscribed?.toISOString() ?? null,
        billing_issues_detected_at: opts.billingIssue?.toISOString() ?? null,
      },
    },
    non_subscriptions: {},
  };
}
const NO_PREMIUM: Subscriber = { entitlements: {}, subscriptions: {} };

let seq = 0;
/** A webhook event (RevenueCat v1 shape); ids are qa33-… so cleanSlate can drop them. */
function event(type: string, at: Date, over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    api_version: '1.0',
    event: {
      id: `qa33-${type}-${seq}-${Date.now()}`,
      type,
      app_user_id: MAYA,
      original_app_user_id: MAYA,
      aliases: [MAYA],
      product_id: PRODUCT,
      entitlement_ids: ['premium'],
      period_type: 'TRIAL',
      event_timestamp_ms: at.getTime(),
      environment: 'SANDBOX',
      store: 'APP_STORE',
      ...over,
    },
  };
}

let h: Harness;

async function row(user: string) {
  const r = must(await admin.from('entitlements').select('*').eq('user_id', user), 'read row');
  return r[0] ?? null;
}
async function trial(user: string) {
  const r = await sql<{ started_at: Date; ends_at: Date; will_renew: boolean }>(
    'select started_at, ends_at, will_renew from private.subscription_trials where user_id = $1',
    [user],
  );
  return r[0]
    ? {
        started_at: r[0].started_at.toISOString(),
        ends_at: r[0].ends_at.toISOString(),
        will_renew: r[0].will_renew,
      }
    : null;
}
const lookups = async () => (await h.state()).lookups;

/** Webhook at a pinned lookup clock; waits for any push it dispatched. */
async function deliver(payload: unknown, clock: Date, expectStatus = 200) {
  await h.setClock(clock);
  const mark = await h.mark();
  const res = await h.webhook(payload);
  expect(res.status, JSON.stringify(res.body)).toBe(expectStatus);
  await h.drain(mark);
  return res;
}
/** revenuecat-sync as a persona at a pinned clock; waits for any push it dispatched. */
async function syncAs(who: 'maya' | 'sam' | 'lea', clock: Date, body?: string) {
  await h.setClock(clock);
  const mark = await h.mark();
  const res = await h.sync(tokenOf(who), body === undefined ? {} : { body });
  await h.drain(mark);
  return res;
}

async function cleanSlate() {
  await resetWorld();
  await sql(`delete from private.revenuecat_events where event_id like 'qa33-%' or event_id like 'sync:%'`);
  await sql('delete from private.revenuecat_syncs where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql('delete from private.revenuecat_sync_minutes');
  await sql('delete from private.subscription_trials where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql('delete from private.trial_reminders where user_id = any($1::uuid[])', [PERSONA_IDS]);
  ok(await admin.from('push_log').delete().in('user_id', PERSONA_IDS), 'clear push_log');
  await h.reset();
}

beforeAll(async () => {
  h = await startHarness();
  await ensureContent();
}, 90_000);
afterAll(async () => {
  await h?.stop();
  await resetWorld();
});

// ───────────────────────────── 1. Webhook: aliases ─────────────────────────────

describe('revenuecat webhook resolves the account from aliases (BE-48, CONTRACTS §6)', () => {
  beforeEach(cleanSlate);

  it('bought on P3 as an anonymous id, then logIn: the event lands on the uid in aliases', async () => {
    const now = new Date();
    await h.setSubscriber(MAYA, premium({ expires: new Date(now.getTime() + 30 * DAY) }));
    await deliver(
      event('INITIAL_PURCHASE', now, {
        app_user_id: ANON,
        original_app_user_id: ANON,
        aliases: [ANON, MAYA],
      }),
      new Date(now.getTime() + SEC),
    );
    expect(await lookups()).toEqual([{ user: MAYA, authorized: true }]);
    expect(await row(MAYA)).toMatchObject({ is_active: true, product_id: PRODUCT, store: 'app_store' });
  });

  it('original_app_user_id alone is enough (no aliases field)', async () => {
    const now = new Date();
    await h.setSubscriber(MAYA, premium({ expires: new Date(now.getTime() + 30 * DAY) }));
    const payload = event('RENEWAL', now, { app_user_id: ANON, original_app_user_id: MAYA });
    delete (payload.event as Record<string, unknown>).aliases;
    await deliver(payload, new Date(now.getTime() + SEC));
    expect((await lookups()).map((l) => l.user)).toEqual([MAYA]);
    expect((await row(MAYA))?.is_active).toBe(true);
  });

  it("a second uuid in aliases gets only its own snapshot, never the buyer's premium", async () => {
    const now = new Date();
    await h.setSubscriber(MAYA, premium({ expires: new Date(now.getTime() + 30 * DAY) }));
    await h.setSubscriber(SAM, NO_PREMIUM);
    await deliver(event('INITIAL_PURCHASE', now, { aliases: [MAYA, SAM] }), new Date(now.getTime() + SEC));
    expect((await lookups()).map((l) => l.user).sort()).toEqual([MAYA, SAM].sort());
    expect((await row(MAYA))?.is_active).toBe(true);
    const sam = await row(SAM);
    expect(sam === null || sam.is_active === false).toBe(true);
  });

  it('anonymous ids only (bought, not signed in yet): 200, no lookup, no write', async () => {
    const now = new Date();
    const res = await deliver(
      event('INITIAL_PURCHASE', now, { app_user_id: ANON, original_app_user_id: ANON2, aliases: [ANON, ANON2] }),
      now,
    );
    expect(res.body).toEqual({ ok: true });
    expect(await lookups()).toEqual([]);
    expect(await row(MAYA)).toBeNull();
  });

  it('legacy SUBSCRIBER_ALIAS (no entitlement_ids) refreshes every uuid it names', async () => {
    const now = new Date();
    await h.setSubscriber(MAYA, premium({ expires: new Date(now.getTime() + 30 * DAY) }));
    const payload = event('SUBSCRIBER_ALIAS', now, { app_user_id: ANON, original_app_user_id: ANON, aliases: [ANON, MAYA] });
    delete (payload.event as Record<string, unknown>).entitlement_ids;
    await deliver(payload, new Date(now.getTime() + SEC));
    expect((await lookups()).map((l) => l.user)).toEqual([MAYA]);
    expect((await row(MAYA))?.is_active).toBe(true);
  });

  it('TRANSFER from an anonymous id to a signed-in uid: only the uid is looked up and written', async () => {
    const now = new Date();
    await h.setSubscriber(MAYA, premium({ expires: new Date(now.getTime() + 30 * DAY) }));
    await deliver(
      event('TRANSFER', now, { transferred_from: [ANON], transferred_to: [MAYA], entitlement_ids: [] }),
      new Date(now.getTime() + SEC),
    );
    expect((await lookups()).map((l) => l.user)).toEqual([MAYA]);
    expect((await row(MAYA))?.is_active).toBe(true);
  });

  it('bad id lists are 400 with no lookup: aliases not an array, 51 aliases, 11 uuids, a non-string', async () => {
    const now = new Date();
    const uuids = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-a000-0000000b${String(i).padStart(4, '0')}`);
    for (const over of [
      { aliases: MAYA },
      { aliases: Array.from({ length: 51 }, (_, i) => `$RCAnonymousID:qa33-${i}`) },
      { aliases: uuids },
      { aliases: [MAYA, 42] },
      { original_app_user_id: 42 },
    ]) {
      const res = await h.webhook(event('RENEWAL', now, over));
      expect(res.status, JSON.stringify(over).slice(0, 60)).toBe(400);
    }
    expect(await lookups()).toEqual([]);
  });

  // #167 (sev:4), fixed by BE-48c: only the canonical lower-case uid names an account. Any other
  // spelling is a foreign id like an anonymous one: never looked up, never written.
  it('ids are used exactly as sent: an upper-case variant of a uid is not that account (#167, BE-48c)', async () => {
    const now = new Date();
    await h.setSubscriber(MAYA, premium({ expires: new Date(now.getTime() + 30 * DAY) }));
    await deliver(event('INITIAL_PURCHASE', now), new Date(now.getTime() + SEC));
    const before = await row(MAYA);
    expect(before?.is_active).toBe(true);
    await h.reset(); // forget the purchase's lookup
    await h.setSubscriber(MAYA, NO_PREMIUM); // a lookup of Maya would now revoke: it must not happen
    const upper = MAYA.toUpperCase();
    const mixed = MAYA.replace('a', 'A');
    expect(mixed).not.toBe(MAYA);
    const later = new Date(now.getTime() + MIN);
    for (const id of [upper, mixed]) {
      const res = await deliver(
        event('EXPIRATION', later, { app_user_id: id, original_app_user_id: id, aliases: [id] }),
        new Date(later.getTime() + SEC),
      );
      expect(res.body).toEqual({ ok: true });
    }
    expect(await lookups()).toEqual([]);
    expect(await row(MAYA)).toEqual(before);
  });

  it('TRANSFER naming an upper-case spelling of a uid: that id is ignored, only the canonical uid is looked up (#167, BE-48c)', async () => {
    const now = new Date();
    await h.setSubscriber(MAYA, premium({ expires: new Date(now.getTime() + 30 * DAY) }));
    await deliver(event('INITIAL_PURCHASE', now), new Date(now.getTime() + SEC));
    const before = await row(MAYA);
    expect(before?.is_active).toBe(true);
    await h.reset();
    await h.setSubscriber(MAYA, NO_PREMIUM);
    const samExpires = new Date(now.getTime() + 30 * DAY);
    await h.setSubscriber(SAM, premium({ expires: samExpires }));
    const later = new Date(now.getTime() + MIN);
    await deliver(
      event('TRANSFER', later, {
        app_user_id: undefined,
        original_app_user_id: undefined,
        aliases: undefined,
        transferred_from: [MAYA.toUpperCase()],
        transferred_to: [SAM],
        entitlement_ids: [],
      }),
      new Date(later.getTime() + SEC),
    );
    expect((await lookups()).map((l) => l.user)).toEqual([SAM]);
    expect(await row(MAYA)).toEqual(before); // Maya stays active
    expect(await row(SAM)).toMatchObject({ is_active: true, product_id: PRODUCT });
    // Upper-case on both sides: nothing to look up, nothing written.
    await h.reset();
    const res = await deliver(
      event('TRANSFER', later, {
        app_user_id: undefined,
        original_app_user_id: undefined,
        aliases: undefined,
        transferred_from: [MAYA.toUpperCase()],
        transferred_to: [SAM.toUpperCase()],
        entitlement_ids: [],
      }),
      new Date(later.getTime() + 2 * SEC),
    );
    expect(res.body).toEqual({ ok: true });
    expect(await lookups()).toEqual([]);
    expect(await row(MAYA)).toEqual(before);
  });

  it('apply_revenuecat_event (service role) rejects a non-canonical user_id with INVALID_WEBHOOK and does not consume the event id (BE-48c)', async () => {
    const id = `qa33-rpc-upper-${Date.now()}`;
    const change = (user_id: string) => ({
      user_id,
      is_active: false,
      product_id: null,
      store: null,
      expires_at: null,
    });
    const bad = await admin.rpc('apply_revenuecat_event', {
      p_event_id: id,
      p_occurred_at: new Date().toISOString(),
      p_changes: [change(MAYA.toUpperCase())],
    });
    expect(bad.error?.message).toContain('INVALID_WEBHOOK');
    const n = async () =>
      (await sql<{ n: number }>('select count(*)::int n from private.revenuecat_events where event_id = $1', [id]))[0].n;
    expect(await n()).toBe(0);
    // The same id with the canonical spelling is then accepted.
    ok(
      await admin.rpc('apply_revenuecat_event', {
        p_event_id: id,
        p_occurred_at: new Date().toISOString(),
        p_changes: [change(MAYA)],
      }),
      'canonical apply',
    );
    expect(await n()).toBe(1);
  });
});

// ───────────────────────────── 2. revenuecat-sync ─────────────────────────────

/** A clock at the start of a UTC minute, a few minutes from now (a fresh global-cap bucket). */
function minuteStart(offsetMinutes: number): Date {
  const d = new Date(Date.now() + offsetMinutes * MIN);
  d.setUTCSeconds(0, 0);
  return d;
}
async function minuteCalls(at: Date): Promise<number | null> {
  const r = await sql<{ calls: number }>(
    `select calls from private.revenuecat_sync_minutes where minute = date_trunc('minute', $1::timestamptz)`,
    [at.toISOString()],
  );
  return r[0]?.calls ?? null;
}
async function lastSync(user: string): Promise<string | null> {
  const r = await sql<{ last_at: Date }>('select last_at from private.revenuecat_syncs where user_id = $1', [user]);
  return r[0]?.last_at.toISOString() ?? null;
}

describe('revenuecat-sync: the signed-in app refreshes its own entitlement (BE-48, CONTRACTS §3)', () => {
  beforeEach(cleanSlate);

  it('refreshes only the caller from RevenueCat; anything in the body is ignored', async () => {
    const t = minuteStart(2);
    await h.setSubscriber(SAM, premium({ expires: new Date(t.getTime() + 30 * DAY) }));
    await h.setSubscriber(MAYA, premium({ expires: new Date(t.getTime() + 30 * DAY) }));
    const res = await syncAs('sam', t, JSON.stringify({ user_id: MAYA, is_active: true, app_user_id: MAYA }));
    expect(res).toEqual({ status: 200, body: { ok: true, is_active: true } });
    expect(await lookups()).toEqual([{ user: SAM, authorized: true }]);
    expect(await row(SAM)).toMatchObject({ is_active: true, product_id: PRODUCT });
    expect(await row(MAYA)).toBeNull();
    // The app reads it back through RLS (refetch entitlements after the 200).
    const mine = must(await as('sam').from('entitlements').select('user_id, is_active'), 'sam reads');
    expect(mine).toEqual([{ user_id: SAM, is_active: true }]);
  });

  it('nothing bought: 200 with is_active false and an inactive row', async () => {
    const t = minuteStart(2);
    const res = await syncAs('sam', t);
    expect(res).toEqual({ status: 200, body: { ok: true, is_active: false } });
    expect((await row(SAM))?.is_active ?? false).toBe(false);
  });

  it('401 UNAUTHORIZED without a valid user JWT, 405 for GET; no lookup, no slot used', async () => {
    await h.setClock(minuteStart(2));
    for (const token of [null, 'not-a-jwt', `${tokenOf('sam')}x`]) {
      const res = await h.sync(token);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: 'UNAUTHORIZED' });
    }
    const get = await h.sync(tokenOf('sam'), { method: 'GET' });
    expect(get.status).toBe(405);
    expect(get.body).toMatchObject({ error: 'METHOD_NOT_ALLOWED' });
    expect(await lookups()).toEqual([]);
    expect(await lastSync(SAM)).toBeNull();
  });

  it('one lookup per user per 30 s: 429 RATE_LIMITED inside, allowed again at 30 s; per user', async () => {
    const t = minuteStart(2);
    expect((await syncAs('sam', t)).status).toBe(200);
    const again = await syncAs('sam', new Date(t.getTime() + 29 * SEC));
    expect(again.status).toBe(429);
    expect(again.body).toMatchObject({ error: 'RATE_LIMITED' });
    // Another user is not limited by Sam's slot.
    expect((await syncAs('maya', new Date(t.getTime() + 29 * SEC))).status).toBe(200);
    expect((await syncAs('sam', new Date(t.getTime() + 30 * SEC))).status).toBe(200);
    expect((await lookups()).map((l) => l.user)).toEqual([SAM, MAYA, SAM]);
  });

  it('global cap (BE-48b): the 121st lookup in a UTC minute is 429, without using the caller\'s 30 s slot', async () => {
    const t = minuteStart(3);
    // 120 lookups already happened this minute (other accounts): only per-minute counts are stored.
    await sql(
      `insert into private.revenuecat_sync_minutes(minute, calls) values (date_trunc('minute', $1::timestamptz), 120)`,
      [t.toISOString()],
    );
    const refused = await syncAs('sam', new Date(t.getTime() + 10 * SEC));
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ error: 'RATE_LIMITED' });
    expect(await lookups()).toEqual([]);
    expect(await lastSync(SAM)).toBeNull();
    expect(await minuteCalls(t)).toBe(120);
    // The next minute has room, and Sam's own slot was never taken: allowed at once.
    const next = new Date(t.getTime() + MIN);
    expect((await syncAs('sam', next)).status).toBe(200);
    expect(await minuteCalls(next)).toBe(1);
    expect(await lastSync(SAM)).toBe(next.toISOString());
  });

  it('global cap boundary: the 120th lookup of the minute passes, the next caller is refused', async () => {
    const t = minuteStart(3);
    await sql(
      `insert into private.revenuecat_sync_minutes(minute, calls) values (date_trunc('minute', $1::timestamptz), 119)`,
      [t.toISOString()],
    );
    expect((await syncAs('maya', new Date(t.getTime() + SEC))).status).toBe(200);
    expect(await minuteCalls(t)).toBe(120);
    expect((await syncAs('sam', new Date(t.getTime() + 2 * SEC))).status).toBe(429);
    expect((await lookups()).map((l) => l.user)).toEqual([MAYA]);
  });

  it('a per-user refusal does not use a global slot', async () => {
    const t = minuteStart(3);
    expect((await syncAs('sam', t)).status).toBe(200);
    expect((await syncAs('sam', new Date(t.getTime() + 5 * SEC))).status).toBe(429);
    expect(await minuteCalls(t)).toBe(1);
  });

  it('a failed RevenueCat lookup is 500 SYNC_FAILED with no write; a retry after 30 s applies it', async () => {
    const t = minuteStart(2);
    await h.failLookup(SAM, 503);
    const failed = await syncAs('sam', t);
    expect(failed.status).toBe(500);
    expect(failed.body).toMatchObject({ error: 'SYNC_FAILED' });
    expect(await row(SAM)).toBeNull();
    await h.setSubscriber(SAM, premium({ expires: new Date(t.getTime() + 30 * DAY) }));
    expect((await syncAs('sam', new Date(t.getTime() + 30 * SEC))).body).toEqual({ ok: true, is_active: true });
    expect((await row(SAM))?.is_active).toBe(true);
  });

  it('a sync that makes a paired couple premium sends partner_premium once, with the caller as actor', async () => {
    await pair('maya', 'sam');
    const t = minuteStart(2);
    await h.setSubscriber(MAYA, premium({ expires: new Date(t.getTime() + 30 * DAY) }));
    expect((await syncAs('maya', t)).status).toBe(200);
    const again = new Date(t.getTime() + 31 * SEC);
    expect((await syncAs('maya', again)).status).toBe(200);
    const dispatches = (await h.state()).dispatches.filter((d) => d.type === 'partner_premium');
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].actor_user_id).toBe(MAYA);
  });

  it('users and anon cannot call claim_revenuecat_sync or take a slot for someone else', async () => {
    const args = { p_user: SAM, p_now: new Date().toISOString() };
    expectPermissionDenied(await as('maya').rpc('claim_revenuecat_sync', args));
    expectPermissionDenied(await anon.rpc('claim_revenuecat_sync', args));
    expect(await lastSync(SAM)).toBeNull();
  });
});

// ───────────────────────────── 3. trial_ending ─────────────────────────────

/** The UTC instant on day `days` from today (UTC) when the local time in `tz` is hour:minute. */
function localAt(days: number, hour: number, tz: string, minute = 0): Date {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + days);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let off = -14 * 60; off <= 14 * 60; off += 15) {
    const d = new Date(base.getTime() + (hour * 60 + minute - off) * MIN);
    if (fmt.format(d) === `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`) return d;
  }
  throw new Error(`no ${hour}:${minute} in ${tz}`);
}
const BERLIN = 'Europe/Berlin'; // Maya (qa/fixtures/personas.json)

async function due(at: Date) {
  const rows = must(await admin.rpc('due_trial_endings', { p_now: at.toISOString() }), 'due_trial_endings');
  return rows.filter((r) => PERSONA_IDS.includes(r.user_id)).map((r) => ({ user_id: r.user_id, days_left: r.days_left }));
}
/** Maya starts a 7-day store trial at `start` (RevenueCat event + canonical snapshot). */
async function startTrial(start: Date, days = 7) {
  await h.setSubscriber(MAYA, premium({ expires: new Date(start.getTime() + days * DAY), period: 'TRIAL', start }));
  await deliver(event('INITIAL_PURCHASE', start), new Date(start.getTime() + MIN));
}

describe('trial_ending: day 5 of a store trial (BE-48, CONTRACTS §3/§6)', () => {
  beforeEach(cleanSlate);

  it('the trial is kept privately: Sam reads Maya\'s entitlement but nothing about the trial', async () => {
    await pair('maya', 'sam');
    const start = new Date(localAt(5, 11, BERLIN).getTime() - 4 * DAY);
    await startTrial(start);
    expect(await trial(MAYA)).toEqual({
      started_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 7 * DAY).toISOString(),
      will_renew: true,
    });
    const seen = must(await as('sam').from('entitlements').select('*').eq('user_id', MAYA), 'sam reads maya');
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]).filter((k) => /trial|period|renew|unsub|billing/i.test(k))).toEqual([]);
  });

  it('due at trial start + 4 days, once per trial, with 3 whole days left', async () => {
    const dueAt = localAt(5, 11, BERLIN);
    const start = new Date(dueAt.getTime() - 4 * DAY);
    await startTrial(start);
    expect(await due(new Date(dueAt.getTime() - 15 * MIN))).toEqual([]);
    expect(await due(dueAt)).toEqual([{ user_id: MAYA, days_left: 3 }]);
    expect(await due(dueAt)).toEqual([]);
    expect(await due(new Date(dueAt.getTime() + 15 * MIN))).toEqual([]);
  });

  it('a shorter (3-day) trial: due 2 days before it ends', async () => {
    const dueAt = localAt(3, 11, BERLIN);
    const start = new Date(dueAt.getTime() - DAY);
    await startTrial(start, 3);
    expect(await due(new Date(dueAt.getTime() - 15 * MIN))).toEqual([]);
    expect(await due(dueAt)).toEqual([{ user_id: MAYA, days_left: 2 }]);
  });

  it("inside Maya's quiet hours it waits for the first tick after them", async () => {
    // Default quiet hours 23:00-07:00 in the profile timezone (CONTRACTS §2 notification_prefs).
    const dueAt = localAt(5, 6, BERLIN);
    await startTrial(new Date(dueAt.getTime() - 4 * DAY));
    expect(await due(dueAt)).toEqual([]);
    expect(await due(new Date(dueAt.getTime() + 45 * MIN))).toEqual([]);
    expect(await due(localAt(5, 7, BERLIN))).toEqual([{ user_id: MAYA, days_left: 3 }]);
  });

  it('the window closes 24 h after the send time: never sent late', async () => {
    const dueAt = localAt(5, 11, BERLIN);
    await startTrial(new Date(dueAt.getTime() - 4 * DAY));
    expect(await due(new Date(dueAt.getTime() + DAY))).toEqual([]);
  });

  it('a cancelled trial (unsubscribe detected) gets no reminder', async () => {
    const dueAt = localAt(5, 11, BERLIN);
    const start = new Date(dueAt.getTime() - 4 * DAY);
    await startTrial(start);
    const cancelAt = new Date(start.getTime() + DAY);
    await h.setSubscriber(
      MAYA,
      premium({ expires: new Date(start.getTime() + 7 * DAY), period: 'TRIAL', start, unsubscribed: cancelAt }),
    );
    await deliver(event('CANCELLATION', cancelAt), new Date(cancelAt.getTime() + MIN));
    expect((await trial(MAYA))?.will_renew).toBe(false);
    expect((await row(MAYA))?.is_active).toBe(true);
    expect(await due(dueAt)).toEqual([]);
  });

  it('a billing issue: no reminder', async () => {
    const dueAt = localAt(5, 11, BERLIN);
    const start = new Date(dueAt.getTime() - 4 * DAY);
    await startTrial(start);
    const issueAt = new Date(start.getTime() + 2 * DAY);
    await h.setSubscriber(
      MAYA,
      premium({ expires: new Date(start.getTime() + 7 * DAY), period: 'TRIAL', start, billingIssue: issueAt }),
    );
    await deliver(event('BILLING_ISSUE', issueAt), new Date(issueAt.getTime() + MIN));
    expect(await due(dueAt)).toEqual([]);
  });

  it('converted early (a paid period now) or expired: the trial is cleared, no reminder', async () => {
    const dueAt = localAt(5, 11, BERLIN);
    const start = new Date(dueAt.getTime() - 4 * DAY);
    await startTrial(start);
    const paidAt = new Date(start.getTime() + 2 * DAY);
    await h.setSubscriber(
      MAYA,
      premium({ expires: new Date(paidAt.getTime() + 365 * DAY), period: 'NORMAL', start: paidAt }),
    );
    await deliver(event('RENEWAL', paidAt, { period_type: 'NORMAL' }), new Date(paidAt.getTime() + MIN));
    expect(await trial(MAYA)).toBeNull();
    expect(await due(dueAt)).toEqual([]);
  });

  it('transferred away to another account: cleared on the source, no reminder', async () => {
    const dueAt = localAt(5, 11, BERLIN);
    const start = new Date(dueAt.getTime() - 4 * DAY);
    await startTrial(start);
    const moveAt = new Date(start.getTime() + DAY);
    await h.setSubscriber(MAYA, NO_PREMIUM);
    await h.setSubscriber(SAM, premium({ expires: new Date(start.getTime() + 7 * DAY), period: 'TRIAL', start }));
    await deliver(
      event('TRANSFER', moveAt, { transferred_from: [MAYA], transferred_to: [SAM], entitlement_ids: [] }),
      new Date(moveAt.getTime() + MIN),
    );
    expect(await trial(MAYA)).toBeNull();
    expect((await due(dueAt)).map((r) => r.user_id)).not.toContain(MAYA);
  });

  it('daily-reminder sends it to Maya only: channel trial_ending, bonded://today, no price; tips off does not matter', async () => {
    await pair('maya', 'sam');
    const dueAt = localAt(5, 11, BERLIN);
    await startTrial(new Date(dueAt.getTime() - 4 * DAY));
    ok(
      await admin.from('push_tokens').insert([
        { user_id: MAYA, token: 'ExponentPushToken[FIXTURE-qa33-maya]', platform: 'ios' },
        { user_id: SAM, token: 'ExponentPushToken[FIXTURE-qa33-sam]', platform: 'ios' },
      ]),
      'tokens',
    );
    const prefs = must(await admin.from('notification_prefs').select('tips').eq('user_id', MAYA).single(), 'prefs');
    expect(prefs.tips).toBe(false); // transactional: no toggle (BE-47b keeps trial_ending ungated)
    await h.setClock(dueAt);
    const res = await h.runDailyReminder();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sent = (await h.state()).sent.filter((m) => m.data.type === 'trial_ending');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'ExponentPushToken[FIXTURE-qa33-maya]',
      channelId: 'trial_ending',
      data: { type: 'trial_ending', url: 'bonded://today' },
    });
    expect(`${sent[0].title} ${sent[0].body}`).not.toMatch(PRICE);
    const log = must(
      await admin.from('push_log').select('user_id, status').eq('type', 'trial_ending').in('user_id', PERSONA_IDS),
      'push_log',
    );
    expect(log).toEqual([{ user_id: MAYA, status: 'sent' }]);
    // The next tick sends nothing more.
    await h.setClock(new Date(dueAt.getTime() + 15 * MIN));
    expect((await h.runDailyReminder()).status).toBe(200);
    expect((await h.state()).sent.filter((m) => m.data.type === 'trial_ending')).toHaveLength(1);
  });

  it('users and anon cannot call due_trial_endings', async () => {
    const args = { p_now: new Date().toISOString() };
    expectPermissionDenied(await as('maya').rpc('due_trial_endings', args));
    expectPermissionDenied(await anon.rpc('due_trial_endings', args));
  });
});
