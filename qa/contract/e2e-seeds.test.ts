// QA-35: the database states the one-device E2E flows of qa/e2e/run-offers.ts start from (D52 day-3
// gift, D46 19d hint) are what the flows expect, proven on the local stack without a device, as
// the personas see them through the app's RPCs. A device run then only fails on the app.
//   gift       free, never subscribed, first 3-day badge now -> get_offer('day3') live and unopened
//   gift-none  same badge, a partner subscribed once -> no gift (D52)
//   hint       streak-11-your-turn with the seed's gift dropped -> no gift; Maya has not answered
// It also pins why the runners need the extra steps: person-keyed premium_history survives the dev
// seed's wipe (no gift after an earlier Premium scenario), and the streak-11 seeds carry a gift.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  answeredToday,
  day3Row,
  dropDay3Gift,
  earnBadgeWithoutGift,
  earnDay3Gift,
  GIFT_BASE_SCENARIO,
  MAYA,
  offerScreenClaims,
  SAM,
  streak3AwardedAt,
} from '../e2e/offer-seeds';
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

  it('works after an earlier Premium scenario (premium_history survives the dev seed wipe)', async () => {
    await applyScenario(client, 'premium-couple');
    await applyScenario(client, GIFT_BASE_SCENARIO);
    // Without the runner's clean-up the couple counts as "ever subscribed": no gift.
    await client.query(
      `update couple_streaks set current = 3, longest = greatest(longest, 3) where couple_id = $1`,
      ['00000000-0000-4000-b000-0000000000c1'],
    );
    expect(await day3Row(client)).toBeNull();
    // earnDay3Gift clears it first.
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
