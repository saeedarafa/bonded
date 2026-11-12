// QA-48 (D57, BE-59): open_exit_offer(p_trigger, p_client_id) at the boundary, as real users
// through supabase-js (CONTRACTS §2 row, §6 "Server gates"). The DB rules at pinned clocks are in
// supabase/tests/exit-offers.test.mjs (backend); this pins what the app sees on the real stack:
// - `paywall_close` and `cancel`: once per person per trigger, ever; per person, not per couple;
//   the two triggers are independent; works without a couple;
// - a retry with the same non-null p_client_id returns the original `eligible: true`; another id,
//   no id, or the partner's id never does (the partner cannot reuse someone else's retry);
// - refusals: `premium` (caller or couple Premium), `not_intro_eligible` (ever subscribed),
//   `gift_live` (the couple's day-3 gift is live, also earned but not opened), `no_subscription`
//   (cancel without an own active App Store entitlement: a covered partner or a Play subscriber),
//   `daily_limit` (D52 slot taken), `unknown_trigger`;
// - a refusal writes nothing (no exit_offers row, no D52 slot), so the offer can come later;
// - `eligible: true` takes the D52 day slot as `exit_<trigger>`;
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

describe('open_exit_offer: once per person per trigger (D57, CONTRACTS §2)', () => {
  beforeEach(clean);

  it('two partners each get their own paywall_close offer once; a later call says shown_before', async () => {
    await pair('maya', 'sam');
    const m1 = await exit('maya', 'paywall_close');
    expect(m1).toMatchObject({ eligible: true, reason: null });
    expect(same(m1.first_shown_at, m1.server_now)).toBe(true);

    const s1 = await exit('sam', 'paywall_close');
    expect(s1).toMatchObject({ eligible: true, reason: null });

    const m2 = await exit('maya', 'paywall_close');
    expect(m2).toMatchObject({ eligible: false, reason: 'shown_before' });
    expect(same(m2.first_shown_at, m1.first_shown_at)).toBe(true);
    const s2 = await exit('sam', 'paywall_close');
    expect(s2).toMatchObject({ eligible: false, reason: 'shown_before' });
    expect(same(s2.first_shown_at, s1.first_shown_at)).toBe(true);

    expect((await rows(MAYA)).map((r) => r.trigger)).toEqual(['paywall_close']);
    expect((await rows(SAM)).map((r) => r.trigger)).toEqual(['paywall_close']);
    // eligible: true counts as shown and takes the D52 day slot.
    expect(await slots(MAYA)).toEqual(['exit_paywall_close']);
    expect(await slots(SAM)).toEqual(['exit_paywall_close']);
  });

  it('a person without a couple can get it', async () => {
    expect(await exit('eve', 'paywall_close')).toMatchObject({ eligible: true, reason: null });
  });

  it('paywall_close does not use up cancel', async () => {
    await entitle(SAM, 'app_store');
    // Sam is Premium now, so paywall_close is refused, but his cancel offer is still there.
    expect(await exit('sam', 'paywall_close')).toMatchObject({
      eligible: false,
      reason: 'premium',
    });
    expect(await exit('sam', 'cancel')).toMatchObject({ eligible: true, reason: null });
    expect(await exit('sam', 'cancel')).toMatchObject({ eligible: false, reason: 'shown_before' });
  });
});

describe('open_exit_offer: p_client_id retry (lost response)', () => {
  beforeEach(clean);

  it('the same client id returns the original eligible answer; another id or none does not', async () => {
    const first = await exit('maya', 'paywall_close', X1);
    expect(first).toMatchObject({ eligible: true, reason: null });
    const retry = await exit('maya', 'paywall_close', X1);
    expect(retry).toMatchObject({ eligible: true, reason: null });
    expect(same(retry.first_shown_at, first.first_shown_at)).toBe(true);

    expect(await exit('maya', 'paywall_close', X2)).toMatchObject({
      eligible: false,
      reason: 'shown_before',
    });
    expect(await exit('maya', 'paywall_close')).toMatchObject({
      eligible: false,
      reason: 'shown_before',
    });

    const r = await rows(MAYA);
    expect(r).toHaveLength(1);
    expect(r[0].client_id).toBe(X1);
    expect(same(r[0].first_shown_at, first.first_shown_at)).toBe(true);
  });

  it('two devices of the same person closing at once: one eligible, the other shown_before, one row', async () => {
    const [a, b] = await Promise.all([
      exit('maya', 'paywall_close', X1),
      exit('maya', 'paywall_close', X2),
    ]);
    expect([a.eligible, b.eligible].sort()).toEqual([false, true]);
    const lost = a.eligible ? b : a;
    const won = a.eligible ? a : b;
    expect(lost.reason).toBe('shown_before');
    expect(same(lost.first_shown_at, won.first_shown_at)).toBe(true);
    expect(await rows(MAYA)).toHaveLength(1);
  });

  it("the partner cannot reuse the other person's client id as a retry", async () => {
    await pair('maya', 'sam');
    const m = await exit('maya', 'paywall_close', X1);
    expect(m.eligible).toBe(true);
    // Sam already saw his own offer (no client id): Maya's id does not reopen it for him.
    const s = await exit('sam', 'paywall_close');
    expect(s.eligible).toBe(true);
    const reuse = await exit('sam', 'paywall_close', X1);
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

describe('open_exit_offer: refusals write nothing (D57)', () => {
  beforeEach(clean);

  async function nothingWritten(user: string) {
    expect(await rows(user)).toEqual([]);
    expect(await slots(user)).toEqual([]);
  }

  it('Premium couple: both partners refused with premium; nothing written', async () => {
    await pair('maya', 'sam');
    await entitle(SAM, 'play_store');
    for (const who of ['maya', 'sam'] as const) {
      const r = await exit(who, 'paywall_close', X1);
      expect(r).toEqual({
        eligible: false,
        first_shown_at: null,
        reason: 'premium',
        server_now: r.server_now,
      });
    }
    await nothingWritten(MAYA);
    await nothingWritten(SAM);
    // Sam's Premium ends: Maya (never subscribed) can now get it; Sam ever subscribed.
    ok(await admin.from('entitlements').delete().eq('user_id', SAM), 'drop entitlement');
    expect(await exit('maya', 'paywall_close')).toMatchObject({ eligible: true, reason: null });
    expect(await exit('sam', 'paywall_close')).toMatchObject({
      eligible: false,
      reason: 'not_intro_eligible',
    });
    await nothingWritten(SAM);
  });

  it('live day-3 gift (earned, not opened yet; or opened and running): gift_live; after it ends, eligible', async () => {
    const couple = await pair('maya', 'sam');
    const earned = new Date(Date.now() - 20 * HOUR).toISOString();
    await sql(
      `insert into public.couple_offers(couple_id, kind, earned_at) values ($1, 'day3', $2)`,
      [couple, earned],
    );
    expect(await exit('maya', 'paywall_close')).toMatchObject({
      eligible: false,
      reason: 'gift_live',
    });
    await nothingWritten(MAYA);

    const setClock = (opened: Date) =>
      sql(
        `update public.couple_offers set first_opened_at = $2, expires_at = $2::timestamptz + interval '12 hours'
         where couple_id = $1 and kind = 'day3'`,
        [couple, opened.toISOString()],
      );
    await setClock(new Date(Date.now() - 1 * HOUR)); // opened, 11 h left
    expect(await exit('sam', 'paywall_close')).toMatchObject({
      eligible: false,
      reason: 'gift_live',
    });
    await nothingWritten(SAM);

    await setClock(new Date(Date.now() - 13 * HOUR)); // ended 1 h ago
    expect(await exit('maya', 'paywall_close')).toMatchObject({ eligible: true, reason: null });
  });

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
    expect(must(await as('maya').rpc('claim_offer_screen', { p_screen: 'day3' }), 'claim')).toBe(
      true,
    );
    expect(await exit('maya', 'paywall_close', X1)).toMatchObject({
      eligible: false,
      reason: 'daily_limit',
    });
    expect(await rows(MAYA)).toEqual([]);
    expect(await slots(MAYA)).toEqual(['day3']);
    // The D52 slot is per local day; freeing it stands in for "tomorrow" (no caller clock).
    await sql('delete from private.offer_screens where user_id = $1', [MAYA]);
    expect(await exit('maya', 'paywall_close', X1)).toMatchObject({ eligible: true, reason: null });
    // And after the exit offer took the slot, the day-3 screen is refused for today.
    expect(must(await as('maya').rpc('claim_offer_screen', { p_screen: 'day3' }), 'claim 2')).toBe(
      false,
    );
  });

  it('unknown trigger: unknown_trigger, nothing written', async () => {
    for (const t of ['', 'Paywall_Close', 'exit30', 'cancel30', 'paywall_close ']) {
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

describe('open_exit_offer: access', () => {
  beforeEach(clean);

  it('anon cannot call it', async () => {
    expectPermissionDenied(await anon.rpc('open_exit_offer', { p_trigger: 'paywall_close' }));
  });

  it('the exit-offer state and the private helper are not reachable through the API', async () => {
    const helper = await loose(as('maya')).rpc('open_exit_offer_at', {
      p_trigger: 'paywall_close',
      p_client_id: null,
      p_now: new Date().toISOString(),
    });
    expect(helper.error).not.toBeNull();
    const table = await loose(as('maya')).from('exit_offers').select('*');
    expect(table.error).not.toBeNull();
    expect(await rows(MAYA)).toEqual([]);
  });
});
