// QA-48 (D57, BE-59), QA-52 (D61, BE-62): open_exit_offer(p_trigger, p_client_id) at the boundary,
// as real users through supabase-js (CONTRACTS §2 row, §6 "Server gates"). The DB rules at pinned
// clocks are in supabase/tests/exit-offers.test.mjs, exit-offer-retired.test.mjs and
// day3-exit-bar.test.mjs (backend); this pins what the app sees on the real stack:
// - D61: `paywall_close` is retired: every caller, in every state, gets
//   `{eligible: false, first_shown_at: null, reason: 'trigger_retired'}`; nothing is written and no
//   D52 day slot is taken; a historical `paywall_close` row stays (and `cancel` stays independent);
// - `cancel`: once per person, ever; per person, not per couple; works without a couple;
// - a retry with the same non-null p_client_id returns the original `eligible: true`; another id,
//   no id, or the partner's id never does (the partner cannot reuse someone else's retry);
// - refusals: `no_subscription` (cancel without an own active App Store entitlement: a covered
//   partner or a Play subscriber), `daily_limit` (D52 slot taken), `unknown_trigger`;
// - a refusal writes nothing (no exit_offers row, no D52 slot), so the offer can come later;
// - `eligible: true` takes the D52 day slot as `exit_cancel`;
// - D61 (4): whoever was offered the 30% (any exit-offer row of either current partner, either
//   trigger) never gets the day-3 50% gift: not earned, and an earned one stops being live;
// - anon cannot call it; the state table is not reachable through the API.
// The RPC has no caller clock, so it runs at the stack's now(); every assertion is relative to the
// returned server_now. Needs the local stack (CI: db-reset job runs qa/ci/contract.sh).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ID,
  admin,
  anon,
  as,
  expectPermissionDenied,
  loose,
  must,
  ok,
  pair,
  resetWorld,
  sql,
} from './helpers';
import type { PersonaName } from './personas';

const MAYA = ID.maya;
const SAM = ID.sam;
const EVE = ID.eve;
const PERSONA_IDS = Object.values(ID);
const HOUR = 3_600_000;
const X1 = '11111111-1111-4111-8111-111111111148';
const X2 = '22222222-2222-4222-8222-222222222248';

type Exit = {
  eligible: boolean;
  first_shown_at: string | null;
  reason: string | null;
  server_now: string;
};

async function exit(who: PersonaName, trigger: string, clientId?: string): Promise<Exit> {
  const args = clientId ? { p_trigger: trigger, p_client_id: clientId } : { p_trigger: trigger };
  const res = must(
    await as(who).rpc('open_exit_offer', args),
    `${who} open_exit_offer(${trigger})`,
  );
  return res as unknown as Exit;
}

/** The person's exit-offer rows (private schema: test read only). */
async function rows(user: string) {
  return sql<{ trigger: string; first_shown_at: Date; client_id: string | null }>(
    `select trigger, first_shown_at, client_id::text from private.exit_offers where user_id = $1 order by trigger`,
    [user],
  );
}
/** The person's D52 offer-screen slots. */
async function slots(user: string): Promise<string[]> {
  const r = await sql<{ screen: string }>(
    `select screen from private.offer_screens where user_id = $1 order by screen`,
    [user],
  );
  return r.map((x) => x.screen);
}
const same = (a: string | Date | null, b: string | null) =>
  a !== null && b !== null && new Date(a).getTime() === Date.parse(b);

async function entitle(who: string, store: 'app_store' | 'play_store', product = 'yearly_trial') {
  ok(
    await admin.from('entitlements').upsert({
      user_id: who,
      is_active: true,
      product_id: product,
      store,
      expires_at: new Date(Date.now() + 30 * 24 * HOUR).toISOString(),
    }),
    `entitle ${who}`,
  );
}

async function clean() {
  await resetWorld();
  // Person-keyed state that survives resetWorld (the entitlements trigger writes premium_history).
  await sql('delete from private.exit_offers where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql('delete from private.offer_screens where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql('delete from private.premium_history where user_id = any($1::uuid[])', [PERSONA_IDS]);
}

beforeAll(clean, 90_000);
afterAll(clean);

async function nothingWritten(user: string) {
  expect(await rows(user)).toEqual([]);
  expect(await slots(user)).toEqual([]);
}

/** The exact D61 answer for the retired trigger. */
function expectRetired(r: Exit) {
  expect(r).toEqual({
    eligible: false,
    first_shown_at: null,
    reason: 'trigger_retired',
    server_now: r.server_now,
  });
  expect(Number.isFinite(Date.parse(r.server_now))).toBe(true);
}

/** A live, unopened day-3 gift for the couple (earned 20 h ago). */
async function giftEarned(couple: string) {
  await sql(
    `insert into public.couple_offers(couple_id, kind, earned_at) values ($1, 'day3', $2)`,
    [couple, new Date(Date.now() - 20 * HOUR).toISOString()],
  );
}
/** An exit-offer row as an earlier build (paywall_close) or the cancel path left it. */
async function offered(user: string, trigger: 'paywall_close' | 'cancel', clientId?: string) {
  await sql(
    `insert into private.exit_offers(user_id, trigger, first_shown_at, client_id) values ($1, $2, $3, $4)`,
    [user, trigger, new Date(Date.now() - 48 * HOUR).toISOString(), clientId ?? null],
  );
}

describe('open_exit_offer: paywall_close is retired (D61, BE-62 (a))', () => {
  beforeEach(clean);

  it('free, never subscribed, with or without a couple, with or without a client id: trigger_retired, nothing written', async () => {
    expectRetired(await exit('eve', 'paywall_close'));
    await pair('maya', 'sam');
    expectRetired(await exit('maya', 'paywall_close'));
    expectRetired(await exit('maya', 'paywall_close', X1));
    // Asking again is the same answer (never shown_before: there is nothing to have been shown).
    expectRetired(await exit('maya', 'paywall_close', X1));
    expectRetired(await exit('sam', 'paywall_close', X2));
    await nothingWritten(EVE);
    await nothingWritten(MAYA);
    await nothingWritten(SAM);
  });

  it('every former refusal state also answers trigger_retired (Premium, ever subscribed, gift live, daily_limit)', async () => {
    const couple = await pair('maya', 'sam');
    await giftEarned(couple);
    expectRetired(await exit('maya', 'paywall_close')); // was gift_live
    expect(must(await as('maya').rpc('claim_offer_screen', { p_screen: 'gift' }), 'claim')).toBe(
      true,
    );
    expectRetired(await exit('maya', 'paywall_close')); // was daily_limit
    expect(await slots(MAYA)).toEqual(['gift']);
    await entitle(SAM, 'play_store');
    expectRetired(await exit('sam', 'paywall_close')); // was premium
    ok(await admin.from('entitlements').delete().eq('user_id', SAM), 'drop entitlement');
    expectRetired(await exit('sam', 'paywall_close')); // was not_intro_eligible
    expect(await rows(MAYA)).toEqual([]);
    await nothingWritten(SAM);
  });

  it('takes no D52 day slot: the day-3 screen can still be claimed afterwards', async () => {
    expectRetired(await exit('maya', 'paywall_close', X1));
    expect(must(await as('maya').rpc('claim_offer_screen', { p_screen: 'day3' }), 'claim')).toBe(
      true,
    );
    expect(await slots(MAYA)).toEqual(['day3']);
  });

  it('two devices closing at once: both trigger_retired, no row', async () => {
    const [a, b] = await Promise.all([
      exit('maya', 'paywall_close', X1),
      exit('maya', 'paywall_close', X2),
    ]);
    expectRetired(a);
    expectRetired(b);
    await nothingWritten(MAYA);
  });

  it('a historical paywall_close row stays: no retry answer from it, and cancel is still independent', async () => {
    await offered(SAM, 'paywall_close', X1);
    const before = await rows(SAM);
    // The same client id as the old row does not replay its eligible answer.
    expectRetired(await exit('sam', 'paywall_close', X1));
    expectRetired(await exit('sam', 'paywall_close'));
    expect(await rows(SAM)).toEqual(before);
    await entitle(SAM, 'app_store');
    expect(await exit('sam', 'cancel')).toMatchObject({ eligible: true, reason: null });
    expect((await rows(SAM)).map((r) => r.trigger)).toEqual(['cancel', 'paywall_close']);
    expect(await slots(SAM)).toEqual(['exit_cancel']);
  });
});

describe('open_exit_offer cancel: once per person, ever (D57, D61)', () => {
  beforeEach(clean);

  it('two partners with their own App Store subscriptions each get it once; a later call says shown_before', async () => {
    await pair('maya', 'sam');
    await entitle(MAYA, 'app_store');
    await entitle(SAM, 'app_store');
    const m1 = await exit('maya', 'cancel');
    expect(m1).toMatchObject({ eligible: true, reason: null });
    expect(same(m1.first_shown_at, m1.server_now)).toBe(true);

    const s1 = await exit('sam', 'cancel');
    expect(s1).toMatchObject({ eligible: true, reason: null });

    const m2 = await exit('maya', 'cancel');
    expect(m2).toMatchObject({ eligible: false, reason: 'shown_before' });
    expect(same(m2.first_shown_at, m1.first_shown_at)).toBe(true);
    const s2 = await exit('sam', 'cancel');
    expect(s2).toMatchObject({ eligible: false, reason: 'shown_before' });
    expect(same(s2.first_shown_at, s1.first_shown_at)).toBe(true);

    expect((await rows(MAYA)).map((r) => r.trigger)).toEqual(['cancel']);
    expect((await rows(SAM)).map((r) => r.trigger)).toEqual(['cancel']);
    // eligible: true counts as shown and takes the D52 day slot.
    expect(await slots(MAYA)).toEqual(['exit_cancel']);
    expect(await slots(SAM)).toEqual(['exit_cancel']);
  });

  it('a person without a couple can get it', async () => {
    await entitle(EVE, 'app_store');
    expect(await exit('eve', 'cancel')).toMatchObject({ eligible: true, reason: null });
  });
});

describe('open_exit_offer cancel: p_client_id retry (lost response)', () => {
  beforeEach(clean);

  it('the same client id returns the original eligible answer; another id or none does not', async () => {
    await entitle(MAYA, 'app_store');
    const first = await exit('maya', 'cancel', X1);
    expect(first).toMatchObject({ eligible: true, reason: null });
    const retry = await exit('maya', 'cancel', X1);
    expect(retry).toMatchObject({ eligible: true, reason: null });
    expect(same(retry.first_shown_at, first.first_shown_at)).toBe(true);

    expect(await exit('maya', 'cancel', X2)).toMatchObject({
      eligible: false,
      reason: 'shown_before',
    });
    expect(await exit('maya', 'cancel')).toMatchObject({
      eligible: false,
      reason: 'shown_before',
    });

    const r = await rows(MAYA);
    expect(r).toHaveLength(1);
    expect(r[0].client_id).toBe(X1);
    expect(same(r[0].first_shown_at, first.first_shown_at)).toBe(true);
  });

  it('two devices of the same person at once: one eligible, the other shown_before, one row', async () => {
    await entitle(MAYA, 'app_store');
    const [a, b] = await Promise.all([exit('maya', 'cancel', X1), exit('maya', 'cancel', X2)]);
    expect([a.eligible, b.eligible].sort()).toEqual([false, true]);
    const lost = a.eligible ? b : a;
    const won = a.eligible ? a : b;
    expect(lost.reason).toBe('shown_before');
    expect(same(lost.first_shown_at, won.first_shown_at)).toBe(true);
    expect(await rows(MAYA)).toHaveLength(1);
  });

  it("the partner cannot reuse the other person's client id as a retry", async () => {
    await pair('maya', 'sam');
    await entitle(MAYA, 'app_store');
    await entitle(SAM, 'app_store');
    const m = await exit('maya', 'cancel', X1);
    expect(m.eligible).toBe(true);
    // Sam already saw his own offer (no client id): Maya's id does not reopen it for him.
    const s = await exit('sam', 'cancel');
    expect(s.eligible).toBe(true);
    const reuse = await exit('sam', 'cancel', X1);
    expect(reuse).toMatchObject({ eligible: false, reason: 'shown_before' });
    expect(same(reuse.first_shown_at, s.first_shown_at)).toBe(true);
    // And Maya's row is untouched by Sam's calls.
    const r = await rows(MAYA);
    expect(r).toHaveLength(1);
    expect(r[0].client_id).toBe(X1);
    expect(same(r[0].first_shown_at, m.first_shown_at)).toBe(true);
    expect((await rows(SAM))[0].client_id).toBeNull();
  });
});

describe('open_exit_offer cancel: refusals write nothing (D57)', () => {
  beforeEach(clean);

  it('cancel needs an own active App Store entitlement: covered partner and Play subscriber refused', async () => {
    await pair('maya', 'sam');
    await entitle(SAM, 'app_store');
    await entitle(EVE, 'play_store');
    // Maya is Premium through Sam's purchase: no own subscription, no promotional offer.
    expect(await exit('maya', 'cancel')).toMatchObject({
      eligible: false,
      reason: 'no_subscription',
    });
    expect(await exit('eve', 'cancel')).toMatchObject({
      eligible: false,
      reason: 'no_subscription',
    });
    expect(await exit('finn', 'cancel')).toMatchObject({
      eligible: false,
      reason: 'no_subscription',
    });
    await nothingWritten(MAYA);
    await nothingWritten(EVE);
    await nothingWritten(ID.finn);
    expect(await exit('sam', 'cancel')).toMatchObject({ eligible: true, reason: null });
    expect(await slots(SAM)).toEqual(['exit_cancel']);
  });

  it("daily_limit: another offer screen took today's slot; refused, and eligible once the slot is free", async () => {
    await entitle(MAYA, 'app_store');
    expect(must(await as('maya').rpc('claim_offer_screen', { p_screen: 'day3' }), 'claim')).toBe(
      true,
    );
    expect(await exit('maya', 'cancel', X1)).toMatchObject({
      eligible: false,
      reason: 'daily_limit',
    });
    expect(await rows(MAYA)).toEqual([]);
    expect(await slots(MAYA)).toEqual(['day3']);
    // The D52 slot is per local day; freeing it stands in for "tomorrow" (no caller clock).
    await sql('delete from private.offer_screens where user_id = $1', [MAYA]);
    expect(await exit('maya', 'cancel', X1)).toMatchObject({ eligible: true, reason: null });
    // And after the exit offer took the slot, the day-3 screen is refused for today.
    expect(must(await as('maya').rpc('claim_offer_screen', { p_screen: 'day3' }), 'claim 2')).toBe(
      false,
    );
  });

  it('unknown trigger: unknown_trigger, nothing written', async () => {
    for (const t of ['', 'Paywall_Close', 'exit30', 'cancel30', 'paywall_close ', 'Cancel']) {
      const r = await exit('maya', t, X1);
      expect(r).toEqual({
        eligible: false,
        first_shown_at: null,
        reason: 'unknown_trigger',
        server_now: r.server_now,
      });
    }
    await nothingWritten(MAYA);
  });
});

type Offer = {
  eligible: boolean;
  expires_at: string | null;
  first_opened_at: string | null;
  server_now: string;
};
const getOffer = async (who: PersonaName) =>
  must(await as(who).rpc('get_offer', { p_kind: 'day3' }), `${who} get_offer`) as unknown as Offer;
const day3Rows = (couple: string) =>
  sql<{ first_opened_at: Date | null }>(
    `select first_opened_at from public.couple_offers where couple_id = $1 and kind = 'day3'`,
    [couple],
  );
/** The couple's first 3-day badge now: BE-47's badge trigger creates the day-3 row when allowed. */
const earnBadge = (couple: string) =>
  sql(
    `insert into public.badge_awards(badge_slug, couple_id, awarded_at) values ('streak-3', $1, now())
     on conflict do nothing`,
    [couple],
  );

describe('day-3 gift: never after a 30% exit offer, either partner (D61 (4), BE-62 (b))', () => {
  beforeEach(clean);

  it('control: a free, never-offered couple earns the gift on its first 3-day badge', async () => {
    const couple = await pair('maya', 'sam');
    await earnBadge(couple);
    expect(await day3Rows(couple)).toHaveLength(1);
    expect((await getOffer('maya')).eligible).toBe(true);
    expect((await getOffer('sam')).eligible).toBe(true);
  });

  for (const [who, trigger] of [
    ['maya', 'cancel'],
    ['sam', 'cancel'],
    ['maya', 'paywall_close'],
    ['sam', 'paywall_close'],
  ] as const) {
    it(`${who} has a ${trigger} row: the badge earns no gift, neither partner sees one, open_offer starts nothing`, async () => {
      const couple = await pair('maya', 'sam');
      await offered(ID[who], trigger);
      await earnBadge(couple);
      expect(await day3Rows(couple)).toEqual([]);
      for (const p of ['maya', 'sam'] as const) {
        expect(await getOffer(p)).toMatchObject({ eligible: false, expires_at: null });
      }
      const opened = must(
        await as('maya').rpc('open_offer', { p_kind: 'day3' }),
        'open_offer',
      ) as unknown as Offer;
      expect(opened.eligible).toBe(false);
      expect(await day3Rows(couple)).toEqual([]);
    });
  }

  it('an earned, unopened gift stops being live once a partner is offered the 30%; open_offer starts no clock', async () => {
    const couple = await pair('maya', 'sam');
    await giftEarned(couple);
    expect((await getOffer('maya')).eligible).toBe(true);
    await offered(SAM, 'cancel');
    for (const p of ['maya', 'sam'] as const) {
      expect((await getOffer(p)).eligible).toBe(false);
    }
    const opened = must(
      await as('maya').rpc('open_offer', { p_kind: 'day3' }),
      'open_offer',
    ) as unknown as Offer;
    expect(opened.eligible).toBe(false);
    expect(opened.expires_at).toBeNull();
    expect((await day3Rows(couple))[0].first_opened_at).toBeNull();
  });

  it('an opened, running gift also ends for both partners', async () => {
    const couple = await pair('maya', 'sam');
    await giftEarned(couple);
    expect(
      (must(await as('sam').rpc('open_offer', { p_kind: 'day3' }), 'open') as unknown as Offer)
        .eligible,
    ).toBe(true);
    await offered(MAYA, 'cancel');
    for (const p of ['maya', 'sam'] as const) {
      expect((await getOffer(p)).eligible).toBe(false);
    }
  });

  it('the retired paywall_close call itself writes no row, so it never costs the couple its gift', async () => {
    const couple = await pair('maya', 'sam');
    expectRetired(await exit('maya', 'paywall_close'));
    expectRetired(await exit('sam', 'paywall_close'));
    await earnBadge(couple);
    expect(await day3Rows(couple)).toHaveLength(1);
    expect((await getOffer('maya')).eligible).toBe(true);
  });

  it('a cancel offer through the RPC bars the gift once the subscription lapses (with premium_history cleared)', async () => {
    const couple = await pair('maya', 'sam');
    await entitle(MAYA, 'app_store');
    expect(await exit('maya', 'cancel')).toMatchObject({ eligible: true, reason: null });
    ok(await admin.from('entitlements').delete().eq('user_id', MAYA), 'drop entitlement');
    // Isolate the exit-offer bar from the "ever subscribed" bar (both apply in real life).
    await sql('delete from private.premium_history where user_id = any($1::uuid[])', [PERSONA_IDS]);
    await earnBadge(couple);
    expect(await day3Rows(couple)).toEqual([]);
    expect((await getOffer('sam')).eligible).toBe(false);
  });
});

describe('open_exit_offer: access', () => {
  beforeEach(clean);

  it('anon cannot call it', async () => {
    expectPermissionDenied(await anon.rpc('open_exit_offer', { p_trigger: 'paywall_close' }));
    expectPermissionDenied(await anon.rpc('open_exit_offer', { p_trigger: 'cancel' }));
  });

  it('the exit-offer state and the private helper are not reachable through the API', async () => {
    const helper = await loose(as('maya')).rpc('open_exit_offer_at', {
      p_trigger: 'cancel',
      p_client_id: null,
      p_now: new Date().toISOString(),
    });
    expect(helper.error).not.toBeNull();
    const table = await loose(as('maya')).from('exit_offers').select('*');
    expect(table.error).not.toBeNull();
    expect(await rows(MAYA)).toEqual([]);
  });
});
