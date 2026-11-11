// QA-33 part 3: BE-47b, the `offer_ending` push for the day-3 gift is promotional (App Store 4.5.4),
// so it goes only to a partner whose `notification_prefs.tips` is on (CONTRACTS §3). Each person
// turns tips on through their own client (RLS), the service-only due_offer_endings(p_now) picks
// only opted-in partners, a partner with tips off leaves no ledger row (so turning tips on inside
// the window still sends at the next tick), and the real daily-reminder handler delivers it.
// The DB level (window, quiet hours, cap, once per partner, never premium) is pinned by
// supabase/tests/offer-tips.test.mjs and day3-offer.test.mjs; this is the boundary.
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
} from './helpers';
import type { PersonaName } from './personas';
import { startHarness, type Harness } from './purchase-harness';

const MAYA = ID.maya;
const SAM = ID.sam;
const PERSONA_IDS = Object.values(ID);
const MIN = 60_000;
const HOUR = 60 * MIN;
/** No price, currency or percentage in promotional push text (prices only from RevenueCat). */
const PRICE = /[$€£¥]|\d+[.,]\d{2}\b|%/;

let h: Harness;
let couple: string;
/** The gift ends at END; due from END - 2 h, window closes at END - 30 min. */
let END: Date;

/**
 * An instant on a future day at 16:00 UTC: 17:00/18:00 in Berlin (Maya), 11:00/12:00 in New York
 * (Sam), outside both default quiet windows (23:00-07:00) whatever the DST state.
 */
function afternoon(daysAhead: number): Date {
  const d = new Date();
  d.setUTCHours(16, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d;
}

async function due(at: Date) {
  const rows = must(await admin.rpc('due_offer_endings', { p_now: at.toISOString() }), 'due_offer_endings');
  return rows
    .filter((r) => PERSONA_IDS.includes(r.user_id))
    .map((r) => ({ user_id: r.user_id, minutes_left: r.minutes_left }))
    .sort((a, b) => a.user_id.localeCompare(b.user_id));
}
async function ledger(): Promise<string[]> {
  const r = await sql<{ user_id: string }>(
    `select user_id::text from private.offer_reminders where couple_id = $1 order by user_id`,
    [couple],
  );
  return r.map((x) => x.user_id);
}
/** A person switches tips on/off in Settings (their own row, through RLS). */
async function setTips(who: PersonaName, tips: boolean) {
  const rows = must(
    await as(who).from('notification_prefs').update({ tips }).eq('user_id', ID[who]).select('tips'),
    `${who} tips`,
  );
  expect(rows).toEqual([{ tips }]);
}

beforeAll(async () => {
  h = await startHarness();
  await ensureContent();
}, 90_000);
afterAll(async () => {
  await h?.stop();
  for (const id of [MAYA, SAM]) await admin.from('notification_prefs').update({ tips: false }).eq('user_id', id);
  await resetWorld();
});

describe('offer_ending goes only to partners who turned tips on (BE-47b, CONTRACTS §3)', () => {
  beforeEach(async () => {
    await resetWorld();
    await h.reset();
    // Purchase history is person-keyed and survives resetWorld (other files buy as Maya); a
    // never-subscribed pair is the precondition for the day-3 gift (D52).
    await sql('delete from private.premium_history where user_id = any($1::uuid[])', [PERSONA_IDS]);
    ok(await admin.from('push_log').delete().in('user_id', PERSONA_IDS), 'clear push_log');
    for (const id of [MAYA, SAM]) {
      ok(await admin.from('notification_prefs').update({ tips: false }).eq('user_id', id), 'tips off');
    }
    couple = await pair('maya', 'sam');
    // The day-3 gift, earned and opened (the server creates it on the first streak-3 badge and
    // open_offer starts its 12 h clock; here it is set directly at a pinned time).
    END = new Date(afternoon(2).getTime() + 2 * HOUR);
    const opened = new Date(END.getTime() - 12 * HOUR);
    await sql(
      `insert into public.couple_offers(couple_id, kind, earned_at, first_opened_at, expires_at)
       values ($1, 'day3', $2, $2, $3)`,
      [couple, opened.toISOString(), END.toISOString()],
    );
  });

  it('tips default off for both: nothing is due and no ledger row is written', async () => {
    const tips = must(await admin.from('notification_prefs').select('user_id, tips').in('user_id', [MAYA, SAM]), 'prefs');
    expect(tips.every((t) => t.tips === false)).toBe(true);
    const from = new Date(END.getTime() - 2 * HOUR);
    for (let t = from.getTime(); t < END.getTime() - 30 * MIN; t += 15 * MIN) {
      expect(await due(new Date(t))).toEqual([]);
    }
    expect(await ledger()).toEqual([]);
  });

  it('Maya turns tips on: only Maya gets it, once; Sam turning tips on inside the window gets it at the next tick', async () => {
    await setTips('maya', true);
    const first = new Date(END.getTime() - 2 * HOUR);
    expect(await due(first)).toEqual([{ user_id: MAYA, minutes_left: 120 }]);
    expect(await due(new Date(first.getTime() + 15 * MIN))).toEqual([]);
    expect(await ledger()).toEqual([MAYA]);
    await setTips('sam', true);
    expect(await due(new Date(first.getTime() + 30 * MIN))).toEqual([{ user_id: SAM, minutes_left: 90 }]);
    expect(await ledger()).toEqual([MAYA, SAM].sort());
  });

  it('tips turned on after the window closed (30 min before the end): never sent', async () => {
    await setTips('maya', true);
    expect(await due(new Date(END.getTime() - 30 * MIN))).toEqual([]);
    expect(await due(new Date(END.getTime() - 15 * MIN))).toEqual([]);
    expect(await ledger()).toEqual([]);
  });

  it('tips switched off again before the send time: nothing', async () => {
    await setTips('maya', true);
    await setTips('maya', false);
    expect(await due(new Date(END.getTime() - 2 * HOUR))).toEqual([]);
  });

  it('Sam cannot switch tips on for Maya (own row only)', async () => {
    const res = await as('sam').from('notification_prefs').update({ tips: true }).eq('user_id', MAYA).select('user_id');
    expect(res.data ?? []).toEqual([]);
    const maya = must(await admin.from('notification_prefs').select('tips').eq('user_id', MAYA).single(), 'maya');
    expect(maya.tips).toBe(false);
    expect(await due(new Date(END.getTime() - 2 * HOUR))).toEqual([]);
  });

  it('daily-reminder delivers it to the opted-in partner only: channel offer_ending, bonded://today, no price', async () => {
    ok(
      await admin.from('push_tokens').insert([
        { user_id: MAYA, token: 'ExponentPushToken[FIXTURE-qa33-maya]', platform: 'ios' },
        { user_id: SAM, token: 'ExponentPushToken[FIXTURE-qa33-sam]', platform: 'android' },
      ]),
      'tokens',
    );
    await setTips('sam', true);
    await h.setClock(new Date(END.getTime() - 2 * HOUR));
    const res = await h.runDailyReminder();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sent = (await h.state()).sent.filter((m) => m.data.type === 'offer_ending');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'ExponentPushToken[FIXTURE-qa33-sam]',
      channelId: 'offer_ending',
      data: { type: 'offer_ending', url: 'bonded://today' },
    });
    expect(`${sent[0].title} ${sent[0].body}`).not.toMatch(PRICE);
    const log = must(
      await admin.from('push_log').select('user_id, status').eq('type', 'offer_ending').in('user_id', PERSONA_IDS),
      'push_log',
    );
    expect(log).toEqual([{ user_id: SAM, status: 'sent' }]);
  });

  it('users and anon cannot call due_offer_endings', async () => {
    const args = { p_now: new Date().toISOString() };
    expectPermissionDenied(await as('maya').rpc('due_offer_endings', args));
    expectPermissionDenied(await anon.rpc('due_offer_endings', args));
  });
});
