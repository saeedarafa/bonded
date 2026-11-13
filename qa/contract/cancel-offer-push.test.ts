// QA-52 (D61 (3), BE-62 (c); CONTRACTS §2 `open_exit_offer`, §3 `cancel_offer`, §5, §6): the store-side
// cancel push across the boundary. The real revenuecat webhook handler (canonical snapshot from the
// faked RevenueCat REST API) queues the offer through the service-only `queue_cancel_offer`; the real
// daily-reminder handler sends it through `due_cancel_offers`. Pinned here:
// - a customer cancel (CANCELLATION + UNSUBSCRIBE) of a running App Store trial or yearly plan sends
//   exactly one `cancel_offer` push: approved copy with the partner's first name, channel
//   `cancel_offer`, url `bonded://subscription/offer`, no price; it records the offer (a `cancel`
//   exit-offer row), so it is once per person, ever, and the first in-app `open_exit_offer('cancel')`
//   after it answers eligible with the push time, then shown_before;
// - never after the period ended (or within its last hour), never for a refund / billing / developer
//   cancel, a Play subscription, a monthly plan, someone already offered in-app; UNCANCELLATION
//   unqueues; tips off waits (promotional), quiet hours wait;
// - the offer bars the couple's day-3 gift (D61 (4));
// - users and anon cannot call the service-only RPCs.
// Clocks: the harness clock for the handlers (webhook lookups and daily-reminder); open_exit_offer has
// no caller clock, so the subscription is set to run well past the real now.
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
  PRICE,
  resetWorld,
  sql,
} from './helpers';
import { startHarness, type Harness, type Subscriber } from './purchase-harness';

const MAYA = ID.maya;
const SAM = ID.sam;
const PERSONA_IDS = Object.values(ID);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BERLIN = 'Europe/Berlin'; // Maya (qa/fixtures/personas.json)
const TOKEN_MAYA = 'ExponentPushToken[FIXTURE-qa52-maya]';

/** The UTC instant on day `days` from today (UTC) when the local time in `tz` is hour:00. */
function localAt(days: number, hour: number, tz: string): Date {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + days);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let off = -14 * 60; off <= 14 * 60; off += 15) {
    const d = new Date(base.getTime() + (hour * 60 - off) * MIN);
    if (fmt.format(d) === `${String(hour).padStart(2, '0')}:00`) return d;
  }
  throw new Error(`no ${hour}:00 in ${tz}`);
}

/** RevenueCat v1 snapshot: Maya's own `premium` subscription, auto-renew off unless `renewing`. */
function snapshot(opts: {
  start: Date;
  expires: Date;
  period?: 'TRIAL' | 'NORMAL';
  store?: 'APP_STORE' | 'PLAY_STORE';
  renewing?: boolean;
}): Subscriber {
  const product = 'any_product_qa52';
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
        store: opts.store ?? 'APP_STORE',
        period_type: opts.period ?? 'TRIAL',
        purchase_date: opts.start.toISOString(),
        expires_date: opts.expires.toISOString(),
        unsubscribe_detected_at: opts.renewing ? null : opts.start.toISOString(),
        billing_issues_detected_at: null,
      },
    },
    non_subscriptions: {},
  };
}

let seq = 0;
function event(type: string, at: Date, over: Record<string, unknown> = {}) {
  seq += 1;
  return {
    api_version: '1.0',
    event: {
      id: `qa52-${type}-${seq}-${Date.now()}`,
      type,
      app_user_id: MAYA,
      original_app_user_id: MAYA,
      aliases: [MAYA],
      product_id: 'any_product_qa52',
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

async function deliver(payload: unknown, clock: Date) {
  await h.setClock(clock);
  const mark = await h.mark();
  const res = await h.webhook(payload);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await h.drain(mark);
}
/** Runs daily-reminder at `clock`; returns the cancel_offer pushes sent so far. */
async function tick(clock: Date) {
  await h.setClock(clock);
  const res = await h.runDailyReminder();
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (await h.state()).sent.filter((m) => m.data.type === 'cancel_offer');
}
const queued = async () =>
  (
    await sql<{ user_id: string }>(
      'select user_id from private.cancel_offer_queue where user_id = any($1::uuid[])',
      [PERSONA_IDS],
    )
  ).map((r) => r.user_id);
const exitRows = async (user: string) =>
  sql<{ trigger: string; source: string; first_shown_at: Date; opened_at: Date | null }>(
    'select trigger, source, first_shown_at, opened_at from private.exit_offers where user_id = $1',
    [user],
  );
async function setTips(tips: boolean) {
  must(
    await as('maya').from('notification_prefs').update({ tips }).eq('user_id', MAYA).select('tips'),
    'tips',
  );
}

/**
 * Maya (paired with Sam, tips on, one device) on an App Store plan from `start` to `expires`,
 * cancelled in the store at `cancelAt` (the webhook writes her entitlement from the snapshot).
 */
async function cancelledInStore(o: {
  start: Date;
  expires: Date;
  cancelAt: Date;
  period?: 'TRIAL' | 'NORMAL';
  store?: 'APP_STORE' | 'PLAY_STORE';
  reason?: string;
}) {
  await h.setSubscriber(MAYA, snapshot(o));
  await deliver(
    event('CANCELLATION', o.cancelAt, {
      cancel_reason: o.reason ?? 'UNSUBSCRIBE',
      period_type: o.period ?? 'TRIAL',
      store: o.store ?? 'APP_STORE',
    }),
    new Date(o.cancelAt.getTime() + MIN),
  );
}

async function cleanSlate() {
  await resetWorld();
  await sql(`delete from private.revenuecat_events where event_id like 'qa52-%'`);
  await sql('delete from private.subscription_trials where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql('delete from private.cancel_offer_queue where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql('delete from private.exit_offers where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql('delete from private.offer_screens where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql('delete from private.premium_history where user_id = any($1::uuid[])', [PERSONA_IDS]);
  ok(await admin.from('push_log').delete().in('user_id', PERSONA_IDS), 'clear push_log');
  await h.reset();
  await pair('maya', 'sam');
  ok(
    await admin.from('push_tokens').insert([{ user_id: MAYA, token: TOKEN_MAYA, platform: 'ios' }]),
    'token',
  );
  await setTips(true);
}

beforeAll(async () => {
  h = await startHarness();
  await ensureContent();
}, 90_000);
afterAll(async () => {
  await sql('delete from private.cancel_offer_queue where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql('delete from private.exit_offers where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await h?.stop();
  await resetWorld();
});

// Send time: tomorrow 11:00 in Berlin (outside the default 23:00-07:00 quiet hours).
const SEND = () => localAt(1, 11, BERLIN);

describe('cancel_offer push after a store-side cancel (D61 (3), BE-62 (c))', () => {
  beforeEach(cleanSlate, 90_000);

  it('trial cancelled in the App Store: one push with the approved copy, recorded as the offer', async () => {
    const send = SEND();
    await cancelledInStore({
      start: new Date(send.getTime() - 2 * DAY),
      expires: new Date(send.getTime() + 5 * DAY),
      cancelAt: new Date(send.getTime() - HOUR),
    });
    expect(await queued()).toEqual([MAYA]);
    const sent = await tick(send);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: TOKEN_MAYA,
      // PO-approved copy (D61, 2026-11-13); {partner} = Sam's first name.
      title: 'Before you go: 30% off',
      body: 'Keep Premium with Sam for 30% less your first year. Yours until your plan ends.',
      channelId: 'cancel_offer',
      data: { type: 'cancel_offer', url: 'bonded://subscription/offer' },
    });
    expect(`${sent[0].title} ${sent[0].body}`).not.toMatch(PRICE);
    expect(Object.keys(sent[0].data).sort()).toEqual(['type', 'url']);
    const rows = await exitRows(MAYA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trigger: 'cancel', source: 'push', opened_at: null });
    expect(rows[0].first_shown_at.getTime()).toBe(send.getTime());
    expect(await queued()).toEqual([]);
    const log = must(
      await admin.from('push_log').select('user_id, status').eq('type', 'cancel_offer').in('user_id', PERSONA_IDS),
      'push_log',
    );
    expect(log).toEqual([{ user_id: MAYA, status: 'sent' }]);
    // Next ticks and a replayed cancel: nothing more, ever.
    expect(await tick(new Date(send.getTime() + 15 * MIN))).toHaveLength(1);
    await cancelledInStore({
      start: new Date(send.getTime() - 2 * DAY),
      expires: new Date(send.getTime() + 5 * DAY),
      cancelAt: new Date(send.getTime() + HOUR),
    });
    expect(await queued()).toEqual([]);
    expect(await tick(new Date(send.getTime() + 2 * HOUR))).toHaveLength(1);
  });

  it('the push tap opens the offer once: eligible with the push time, then shown_before', async () => {
    const send = SEND();
    await cancelledInStore({
      start: new Date(send.getTime() - 2 * DAY),
      expires: new Date(send.getTime() + 5 * DAY),
      cancelAt: new Date(send.getTime() - HOUR),
    });
    expect(await tick(send)).toHaveLength(1);
    const first = must(
      await as('maya').rpc('open_exit_offer', { p_trigger: 'cancel', p_client_id: '52525252-5252-4252-8252-525252525252' }),
      'open',
    ) as unknown as { eligible: boolean; first_shown_at: string; reason: string | null };
    expect(first).toMatchObject({ eligible: true, reason: null });
    expect(Date.parse(first.first_shown_at)).toBe(send.getTime());
    const again = must(await as('maya').rpc('open_exit_offer', { p_trigger: 'cancel' }), 'again') as unknown as {
      reason: string;
    };
    expect(again.reason).toBe('shown_before');
    expect((await exitRows(MAYA))[0].opened_at).not.toBeNull();
  });

  it('a yearly plan cancelled in the store gets it too; a monthly plan does not', async () => {
    const send = SEND();
    await cancelledInStore({
      period: 'NORMAL',
      start: new Date(send.getTime() - 30 * DAY),
      expires: new Date(send.getTime() + 335 * DAY),
      cancelAt: new Date(send.getTime() - HOUR),
    });
    expect(await queued()).toEqual([MAYA]);
    await sql('delete from private.cancel_offer_queue where user_id = $1', [MAYA]);
    await cancelledInStore({
      period: 'NORMAL',
      start: new Date(send.getTime() - 10 * DAY),
      expires: new Date(send.getTime() + 20 * DAY),
      cancelAt: new Date(send.getTime() - HOUR),
    });
    expect(await queued()).toEqual([]);
    expect(await tick(send)).toEqual([]);
  });

  it('never after the period ended: a queued cancel is dropped once the plan has under an hour left', async () => {
    const send = SEND();
    const expires = new Date(send.getTime() + 30 * MIN);
    await cancelledInStore({
      start: new Date(send.getTime() - 7 * DAY),
      expires: new Date(send.getTime() + 2 * DAY),
      cancelAt: new Date(send.getTime() - 2 * DAY),
    });
    expect(await queued()).toEqual([MAYA]);
    // Tips off: it waits (promotional), and the plan runs out meanwhile.
    await setTips(false);
    expect(await tick(new Date(send.getTime() - DAY))).toEqual([]);
    expect(await queued()).toEqual([MAYA]);
    await sql('update public.entitlements set expires_at = $2 where user_id = $1', [MAYA, expires.toISOString()]);
    await setTips(true);
    expect(await tick(send)).toEqual([]);
    expect(await tick(new Date(expires.getTime() + HOUR))).toEqual([]);
    expect(await queued()).toEqual([]);
    expect(await exitRows(MAYA)).toEqual([]);
  });

  it('tips off waits; quiet hours wait; then exactly one push', async () => {
    const send = SEND();
    await cancelledInStore({
      start: new Date(send.getTime() - 2 * DAY),
      expires: new Date(send.getTime() + 5 * DAY),
      cancelAt: new Date(send.getTime() - HOUR),
    });
    await setTips(false);
    expect(await tick(send)).toEqual([]);
    expect(await exitRows(MAYA)).toEqual([]);
    await setTips(true);
    expect(await tick(localAt(2, 3, BERLIN))).toEqual([]); // 03:00 Berlin: quiet hours
    expect(await queued()).toEqual([MAYA]);
    expect(await tick(localAt(2, 8, BERLIN))).toHaveLength(1);
  });

  it('no push for a refund, billing or developer cancel, a Play subscription, or someone offered in-app', async () => {
    const send = SEND();
    const plan = {
      start: new Date(send.getTime() - 2 * DAY),
      expires: new Date(send.getTime() + 5 * DAY),
      cancelAt: new Date(send.getTime() - HOUR),
    };
    for (const reason of ['CUSTOMER_SUPPORT', 'BILLING_ERROR', 'DEVELOPER_INITIATED']) {
      await cancelledInStore({ ...plan, reason });
      expect({ reason, queued: await queued() }).toEqual({ reason, queued: [] });
    }
    await cancelledInStore({ ...plan, store: 'PLAY_STORE' });
    expect(await queued()).toEqual([]);
    // Offered in-app first (Manage subscription), then cancelled in the store: no push.
    await cancelledInStore({ ...plan, cancelAt: new Date(send.getTime() - 3 * HOUR), reason: 'CUSTOMER_SUPPORT' });
    expect(
      (must(await as('maya').rpc('open_exit_offer', { p_trigger: 'cancel' }), 'in-app') as unknown as { eligible: boolean })
        .eligible,
    ).toBe(true);
    await cancelledInStore(plan);
    expect(await queued()).toEqual([]);
    expect(await tick(send)).toEqual([]);
  });

  it('UNCANCELLATION (auto-renew back on) unqueues it', async () => {
    const send = SEND();
    const plan = { start: new Date(send.getTime() - 2 * DAY), expires: new Date(send.getTime() + 5 * DAY) };
    await cancelledInStore({ ...plan, cancelAt: new Date(send.getTime() - 2 * HOUR) });
    expect(await queued()).toEqual([MAYA]);
    await h.setSubscriber(MAYA, snapshot({ ...plan, renewing: true }));
    await deliver(event('UNCANCELLATION', new Date(send.getTime() - HOUR)), new Date(send.getTime() - HOUR + MIN));
    expect(await queued()).toEqual([]);
    expect(await tick(send)).toEqual([]);
  });

  it("the push bars the couple's day-3 gift (one discount per person, D61 (4))", async () => {
    const send = SEND();
    await cancelledInStore({
      start: new Date(send.getTime() - 2 * DAY),
      expires: new Date(send.getTime() + 5 * DAY),
      cancelAt: new Date(send.getTime() - HOUR),
    });
    expect(await tick(send)).toHaveLength(1);
    // Maya's plan ends and her purchase history is cleared, to isolate the exit-offer bar.
    ok(await admin.from('entitlements').delete().eq('user_id', MAYA), 'drop entitlement');
    await sql('delete from private.premium_history where user_id = any($1::uuid[])', [PERSONA_IDS]);
    const couple = must(
      await admin.from('couple_members').select('couple_id').eq('user_id', SAM).is('left_at', null).single(),
      'couple',
    ).couple_id;
    await sql(
      `insert into public.badge_awards(badge_slug, couple_id, awarded_at) values ('streak-3', $1, now()) on conflict do nothing`,
      [couple],
    );
    const offer = must(await as('sam').rpc('get_offer', { p_kind: 'day3' }), 'get_offer') as unknown as {
      eligible: boolean;
    };
    expect(offer.eligible).toBe(false);
  });

  it('users and anon cannot call queue_cancel_offer or due_cancel_offers', async () => {
    const now = new Date().toISOString();
    for (const client of [as('maya'), anon]) {
      expectPermissionDenied(
        await client.rpc('queue_cancel_offer', { p_user: MAYA, p_cancelled: true, p_now: now }),
      );
      expectPermissionDenied(await client.rpc('due_cancel_offers', { p_now: now }));
    }
    expect(await queued()).toEqual([]);
  });
});
