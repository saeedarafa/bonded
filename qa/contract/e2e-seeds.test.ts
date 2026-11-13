// QA-35: the database states the one-device E2E flows of qa/e2e/run-offers.ts start from (D52 day-3
// gift, D46 19d hint) are what the flows expect, proven on the local stack without a device, as
// the personas see them through the app's RPCs. A device run then only fails on the app.
//   gift       free, never subscribed, first 3-day badge now -> get_offer('day3') live and unopened
//   gift-none  same badge, a partner subscribed once -> no gift (D52)
//   hint       streak-11-your-turn with the seed's gift dropped -> no gift; Maya has not answered
// It also pins why the runners need the extra steps: person-keyed premium_history survives the dev
// seed's wipe (no gift after an earlier Premium scenario), and the streak-11 seeds carry a gift.
// QA-48c: the D57 exit/cancel states (run-offers exit-16, exit-premium, exit-gift, cancel) give the
// server answer each flow expects from open_exit_offer. QA-52 (D61, BE-62): paywall_close is retired
// (`trigger_retired`, nothing written) and no day-3 gift after any exit-offer row of either partner.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  answeredToday,
  day3Row,
  EXIT_BASE_SCENARIO,
  exitOfferTriggers,
  prepareExitOffer,
  prepareExitOfferGiftLive,
  prepareExitOfferPremium,
  PREMIUM_SCENARIO,
  dropDay3Gift,
  earnBadgeWithoutGift,
  earnDay3Gift,
  GIFT_BASE_SCENARIO,
  MAYA,
  offerScreenClaims,
  SAM,
  streak3AwardedAt,
} from '../scripts/offer-seeds';
import { applyScenario } from '../scripts/seed-scenario';
import { as, must } from './helpers';

const HOUR = 3_600_000;
const client = new pg.Client({ connectionString: inject('stack').dbUrl });

type Offer = { eligible: boolean; expires_at: string | null; first_opened_at?: string | null; server_now: string };
const getOffer = async (who: 'maya' | 'sam') =>
  must(await as(who).rpc('get_offer', { p_kind: 'day3' }), 'get_offer') as unknown as Offer;

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  // Leave the stack as `supabase db reset` does; drop what these states added to private tables.
  await client.query('delete from private.exit_offers where user_id in ($1, $2)', [MAYA, SAM]);
  await client.query('delete from private.premium_history where user_id in ($1, $2)', [MAYA, SAM]);
  await client.query('delete from private.offer_screens where user_id in ($1, $2)', [MAYA, SAM]);
  await applyScenario(client, 'streak-11-both-answered');
  await client.end();
});

describe('gift: free couple earns its first 3-day badge today (run-offers gift)', () => {
  it('awards streak-3 now and the server holds an unopened day3 gift for both partners', async () => {
    await applyScenario(client, GIFT_BASE_SCENARIO);
    expect(await day3Row(client)).toBeNull();
    await earnDay3Gift(client);

    const awarded = await streak3AwardedAt(client);
    expect(awarded).not.toBeNull();
    expect(Date.now() - new Date(awarded!).getTime()).toBeLessThan(5 * 60_000);
    const row = await day3Row(client);
    expect(row).not.toBeNull();
    expect(row!.first_opened_at).toBeNull();
    expect(row!.expires_at).toBeNull();

    for (const who of ['maya', 'sam'] as const) {
      const offer = await getOffer(who);
      expect(offer.eligible).toBe(true);
      expect(offer.expires_at).toBeNull();
      expect(offer.first_opened_at).toBeNull();
    }
    // Nothing claimed yet: Today's own claim decides whether 14 opens by itself.
    expect(await offerScreenClaims(client, MAYA)).toEqual([]);
  });

  it('what the flow then does: Today claims "gift", the first open starts one shared 12 h clock', async () => {
    expect(must(await as('maya').rpc('claim_offer_screen', { p_screen: 'gift' }), 'claim')).toBe(true);
    const opened = must(await as('maya').rpc('open_offer', { p_kind: 'day3' }), 'open_offer') as unknown as Offer;
    expect(opened.eligible).toBe(true);
    const row = (await day3Row(client))!;
    expect(new Date(row.expires_at!).getTime() - new Date(row.first_opened_at!).getTime()).toBe(12 * HOUR);
    const sam = await getOffer('sam');
    expect(sam.expires_at).not.toBeNull();
    expect(new Date(sam.expires_at!).getTime()).toBe(new Date(row.expires_at!).getTime());
    expect(await offerScreenClaims(client, MAYA)).toEqual(['gift']);
  });

  it('works after an earlier Premium scenario (BE-50: the dev seed wipe clears premium_history)', async () => {
    await applyScenario(client, 'premium-couple');
    await applyScenario(client, GIFT_BASE_SCENARIO);
    // BE-50: without the runner's clean-up the couple no longer counts as "ever subscribed": gift.
    await client.query(
      `update couple_streaks set current = 3, longest = greatest(longest, 3) where couple_id = $1`,
      ['00000000-0000-4000-b000-0000000000c1'],
    );
    expect(await day3Row(client)).not.toBeNull();
    // earnDay3Gift (with its own clean-up) still works too.
    await applyScenario(client, GIFT_BASE_SCENARIO);
    await earnDay3Gift(client);
    expect(await day3Row(client)).not.toBeNull();
    expect((await getOffer('maya')).eligible).toBe(true);
  });
});

describe('gift-none: same badge, a partner subscribed once (run-offers gift-none)', () => {
  it('awards streak-3 now, creates no gift, and neither partner is Premium', async () => {
    await applyScenario(client, GIFT_BASE_SCENARIO);
    await earnBadgeWithoutGift(client);
    expect(await streak3AwardedAt(client)).not.toBeNull();
    expect(await day3Row(client)).toBeNull();
    for (const who of ['maya', 'sam'] as const) {
      expect((await getOffer(who)).eligible).toBe(false);
      // The couple is free today (52b, not Premium UI): the lapsed entitlement is inactive.
      const { data } = await as(who).from('entitlements').select('is_active');
      expect((data ?? []).some((e) => e.is_active)).toBe(false);
    }
    // Opening does nothing for a couple without a gift.
    const opened = must(await as('maya').rpc('open_offer', { p_kind: 'day3' }), 'open_offer') as unknown as Offer;
    expect(opened.eligible).toBe(false);
    expect(await day3Row(client)).toBeNull();
  });
});

describe('hint: free couple on 19 (run-offers hint)', () => {
  it('streak-11 seeds carry a live gift for a never-subscribed couple (why the runners drop it)', async () => {
    await client.query('delete from private.premium_history where user_id in ($1, $2)', [MAYA, SAM]);
    await applyScenario(client, 'streak-11-your-turn');
    expect(await day3Row(client)).not.toBeNull();
    expect((await getOffer('maya')).eligible).toBe(true);
  });

  it('after dropDay3Gift: no gift, Maya free and not answered today', async () => {
    await dropDay3Gift(client);
    expect(await day3Row(client)).toBeNull();
    expect((await getOffer('maya')).eligible).toBe(false);
    expect(await answeredToday(client, MAYA)).toBe(false);
    expect(await answeredToday(client, SAM)).toBe(true);
  });
});

type Exit = { eligible: boolean; first_shown_at: string | null; reason: string | null };
const openExit = async (who: 'maya' | 'sam', trigger: 'paywall_close' | 'cancel') =>
  must(await as(who).rpc('open_exit_offer', { p_trigger: trigger }), 'open_exit_offer') as unknown as Exit;

describe('D61 exit and cancel offers (run-offers exit-16, exit-premium, exit-gift, cancel)', () => {
  it('exit-16 state: free, never subscribed, no gift: × no longer opens an offer (paywall_close retired), nothing written', async () => {
    await applyScenario(client, EXIT_BASE_SCENARIO);
    await prepareExitOffer(client);
    expect(await day3Row(client)).toBeNull();
    expect(await exitOfferTriggers(client, MAYA)).toEqual([]);
    expect(await offerScreenClaims(client, MAYA)).toEqual([]);
    for (let i = 0; i < 2; i++) {
      expect(await openExit('maya', 'paywall_close')).toMatchObject({
        eligible: false,
        first_shown_at: null,
        reason: 'trigger_retired',
      });
    }
    // What the runner checks afterwards: no row and no D52 slot for either partner.
    expect(await exitOfferTriggers(client, MAYA)).toEqual([]);
    expect(await exitOfferTriggers(client, SAM)).toEqual([]);
    expect(await offerScreenClaims(client, MAYA)).toEqual([]);
  });

  it('prepareExitOffer clears a leftover row (the dev seed keeps private.exit_offers; since D61 a row also bars the gift)', async () => {
    await applyScenario(client, EXIT_BASE_SCENARIO);
    await client.query(
      `insert into private.exit_offers(user_id, trigger, first_shown_at) values ($1, 'paywall_close', now() - interval '2 days')
       on conflict do nothing`,
      [MAYA],
    );
    await prepareExitOffer(client);
    expect(await exitOfferTriggers(client, MAYA)).toEqual([]);
  });

  it('exit-premium state: Premium couple: paywall_close retired for both partners, nothing written', async () => {
    await applyScenario(client, PREMIUM_SCENARIO);
    await prepareExitOfferPremium(client);
    expect((await openExit('sam', 'paywall_close')).reason).toBe('trigger_retired');
    expect((await openExit('maya', 'paywall_close')).reason).toBe('trigger_retired');
    expect(await exitOfferTriggers(client, MAYA)).toEqual([]);
    expect(await exitOfferTriggers(client, SAM)).toEqual([]);
  });

  it('exit-gift state: the day-3 gift is live and unopened; paywall_close retired, nothing written, gift untouched', async () => {
    await applyScenario(client, EXIT_BASE_SCENARIO);
    await prepareExitOfferGiftLive(client);
    const gift = await day3Row(client);
    expect(gift).not.toBeNull();
    expect(gift!.first_opened_at).toBeNull();
    // Today claims `gift` first on the device (14 opens by itself).
    expect(must(await as('maya').rpc('claim_offer_screen', { p_screen: 'gift' }), 'claim')).toBe(true);
    expect((await openExit('maya', 'paywall_close')).reason).toBe('trigger_retired');
    expect(await exitOfferTriggers(client, MAYA)).toEqual([]);
    expect(await day3Row(client)).not.toBeNull();
    // The retired call cost nothing: the gift is still live for both.
    expect((await getOffer('maya')).eligible).toBe(true);
    expect((await getOffer('sam')).eligible).toBe(true);
  });

  it('cancel: Maya (own App Store yearly) eligible once; Sam (on her plan) has no subscription', async () => {
    await applyScenario(client, PREMIUM_SCENARIO);
    await prepareExitOfferPremium(client);
    expect((await openExit('sam', 'cancel')).reason).toBe('no_subscription');
    expect((await openExit('maya', 'cancel')).eligible).toBe(true);
    expect((await openExit('maya', 'cancel')).reason).toBe('shown_before');
    expect(await exitOfferTriggers(client, MAYA)).toEqual(['cancel']);
    expect(await offerScreenClaims(client, MAYA)).toEqual(['exit_cancel']);
  });

  // D61 (4): whoever was offered the 30% never gets the day-3 50% gift; a couple where either
  // partner was offered it gets none. The cancel row from the case above survives the dev seed
  // (person-keyed), which is why earnDay3Gift now clears private.exit_offers too.
  for (const who of [MAYA, SAM]) {
    it(`no day-3 gift after an exit offer: ${who === MAYA ? 'Maya' : 'Sam'} has a cancel row, the 3-day badge earns nothing`, async () => {
      await applyScenario(client, GIFT_BASE_SCENARIO);
      await client.query('delete from private.premium_history where user_id in ($1, $2)', [MAYA, SAM]);
      await client.query('delete from private.offer_screens where user_id in ($1, $2)', [MAYA, SAM]);
      await client.query('delete from private.exit_offers where user_id in ($1, $2)', [MAYA, SAM]);
      await client.query(
        `insert into private.exit_offers(user_id, trigger, first_shown_at) values ($1, 'cancel', now() - interval '3 days')`,
        [who],
      );
      // reachThreeDays without earnDay3Gift's clean-up.
      await client.query(
        `update couple_streaks set current = 3, longest = greatest(longest, 3) where couple_id = $1 and current < 3`,
        ['00000000-0000-4000-b000-0000000000c1'],
      );
      expect(await streak3AwardedAt(client)).not.toBeNull();
      expect(await day3Row(client)).toBeNull();
      for (const p of ['maya', 'sam'] as const) expect((await getOffer(p)).eligible).toBe(false);
    });
  }

  it('earnDay3Gift clears a leftover exit-offer row, so the gift state still works after a cancel run', async () => {
    await applyScenario(client, PREMIUM_SCENARIO);
    await prepareExitOfferPremium(client);
    expect((await openExit('maya', 'cancel')).eligible).toBe(true);
    await applyScenario(client, GIFT_BASE_SCENARIO);
    await earnDay3Gift(client);
    expect(await exitOfferTriggers(client, MAYA)).toEqual([]);
    expect(await day3Row(client)).not.toBeNull();
    expect((await getOffer('maya')).eligible).toBe(true);
  });

  it('an earned gift stops being live once either partner is offered the 30%', async () => {
    await applyScenario(client, GIFT_BASE_SCENARIO);
    await earnDay3Gift(client);
    expect((await getOffer('sam')).eligible).toBe(true);
    await client.query(
      `insert into private.exit_offers(user_id, trigger, first_shown_at) values ($1, 'cancel', now())`,
      [SAM],
    );
    for (const p of ['maya', 'sam'] as const) expect((await getOffer(p)).eligible).toBe(false);
    const opened = must(await as('maya').rpc('open_offer', { p_kind: 'day3' }), 'open_offer') as unknown as Offer;
    expect(opened.eligible).toBe(false);
    expect((await day3Row(client))!.first_opened_at).toBeNull();
  });
});
