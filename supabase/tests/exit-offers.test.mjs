// BE-59 / D57: exit offers (`paywall_close`, `cancel`). Once per person per trigger ever, two users
// independent, idempotent retry with the client id, never for a Premium couple or a person who
// already subscribed/trialled, never while the couple's day-3 gift is live, cancel only with an own
// active App Store subscription, the D52 one-offer-per-day slot, refusals write nothing, access,
// delete cascade.
import assert from 'node:assert/strict';
import { createDb, defaultMigrations } from './pglite-supabase.mjs';
import { contentSql } from '../scripts/content-sql.mjs';

const db = await createDb(defaultMigrations());
await db.exec(contentSql());
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const id = (n) => `00000000-0000-4000-a000-0000000059${String(n).padStart(2, '0')}`;
const users = Array.from({ length: 30 }, (_, i) => id(i + 1));
const [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T] = users;
const run = async (role, uid, sql, params = []) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const fails = async (role, uid, sql, params) => {
  try { await run(role, uid, sql, params); return ''; } catch (e) { return e.message; }
};
// Pinned clock through the private body (as the definer wrapper would call it).
const exit = async (uid, trigger, time, client = null) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  return (await db.query(`select private.open_exit_offer_at($1, $2, $3) j`, [trigger, client, time])).rows[0].j;
};
const hours = (iso, h) => new Date(Date.parse(iso) + h * 3600 * 1000).toISOString();
const same = (a, b) => a !== null && b !== null && Date.parse(a) === Date.parse(b);
const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating') c`)).rows[0].c;
  const invite = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [invite.c, invite.t]);
  return couple;
};
const entitle = (uid, active, store, expires, at = '2026-11-01T00:00:00Z', product = 'yearly_v2') =>
  db.query(`insert into entitlements(user_id,is_active,product_id,store,expires_at,updated_at)
    values ($1,$2,$3,$4,$5,$6)
    on conflict (user_id) do update set is_active=excluded.is_active, product_id=excluded.product_id,
      store=excluded.store, expires_at=excluded.expires_at, updated_at=excluded.updated_at`,
  [uid, active, product, store, expires, at]);
const rows = async (uid) =>
  (await db.query(`select trigger, first_shown_at, client_id from private.exit_offers where user_id=$1 order by trigger`, [uid])).rows;
const T0 = '2026-11-20T15:00:00Z';
const X1 = '11111111-1111-4111-8111-111111111111';
const X2 = '22222222-2222-4222-8222-222222222222';

try {
  await db.query(`insert into auth.users(id) values ${users.map((_, i) => `($${i + 1})`).join()}`, users);

  // ─── paywall_close: once per person, ever ───
  const ab = await pair(A, B);
  const first = await exit(A, 'paywall_close', T0);
  ok(first.eligible === true && same(first.first_shown_at, T0) && first.reason === null,
    'free never-subscribed person: first paywall close is eligible and records first_shown_at');
  const again = await exit(A, 'paywall_close', hours(T0, 0.01));
  ok(again.eligible === false && again.reason === 'shown_before' && same(again.first_shown_at, T0),
    'second call: not eligible, same first_shown_at, reason shown_before');
  ok(!(await exit(A, 'paywall_close', hours(T0, 24 * 400))).eligible, 'still not eligible a year later (ever)');
  ok((await rows(A)).length === 1, 'exactly one row for the person');
  const partner = await exit(B, 'paywall_close', T0);
  ok(partner.eligible === true, 'the partner has their own exit offer (per person, not per couple)');
  ok((await exit(A, 'cancel', T0)).reason === 'no_subscription', 'paywall_close does not consume cancel (and vice versa)');

  // ─── idempotent retry with the client id ───
  await pair(C, D);
  const c1 = await exit(C, 'paywall_close', T0, X1);
  const c2 = await exit(C, 'paywall_close', hours(T0, 0.001), X1);
  ok(c1.eligible && c2.eligible && same(c2.first_shown_at, c1.first_shown_at),
    'a retry with the same client_id gets the same eligible answer (lost response)');
  ok((await exit(C, 'paywall_close', T0, X2)).reason === 'shown_before', 'another client_id: shown_before');
  ok((await exit(C, 'paywall_close', T0)).reason === 'shown_before', 'no client_id: shown_before');
  ok((await exit(D, 'paywall_close', T0, X1)).eligible, "the partner using the same client_id is not a retry of C's call");

  // ─── solo person (signed in, not paired yet) ───
  ok((await exit(E, 'paywall_close', T0)).eligible, 'a person without a couple can get the paywall exit offer');

  // ─── Premium couple ───
  const fg = await pair(F, G);
  await entitle(G, true, 'app_store', hours(T0, 240));
  const fPrem = await exit(F, 'paywall_close', T0);
  ok(!fPrem.eligible && fPrem.reason === 'premium' && fPrem.first_shown_at === null,
    "never for a Premium couple (partner's subscription)");
  ok((await exit(G, 'paywall_close', T0)).reason === 'premium', 'never for the paying member');
  ok((await rows(F)).length === 0, 'a refusal writes nothing');
  await entitle(G, true, 'app_store', hours(T0, -1));
  ok((await exit(F, 'paywall_close', T0)).eligible,
    "after the partner's premium expired, F (never subscribed) can still get it once");
  ok((await exit(G, 'paywall_close', T0)).reason === 'not_intro_eligible',
    'G, who subscribed before, is not intro eligible');
  await entitle(H, true, null, null, T0, 'lifetime');
  ok((await exit(H, 'paywall_close', T0)).reason === 'premium', 'solo person with own premium (no expiry): premium');

  // ─── own purchase history (store intro eligibility) ───
  await entitle(I, false, 'app_store', '2026-01-08T00:00:00Z', '2026-01-01T00:00:00Z');
  ok((await exit(I, 'paywall_close', T0)).reason === 'not_intro_eligible', 'expired past trial/subscription: not_intro_eligible');
  ok((await rows(I)).length === 0, 'not_intro_eligible writes nothing');

  // ─── live day-3 gift ───
  const jk = await pair(J, K);
  await db.query(`insert into badge_awards(badge_slug, couple_id, awarded_at) values ('streak-3',$1,$2)`, [jk, T0]);
  const gift = (await db.query(`select * from couple_offers where couple_id=$1 and kind='day3'`, [jk])).rows[0];
  ok(gift && gift.expires_at === null, 'fixture: the couple earned an unopened day-3 gift');
  ok((await exit(J, 'paywall_close', hours(T0, 1))).reason === 'gift_live', 'unopened earned gift counts as live: gift_live');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [K]);
  await db.query(`select private.open_offer_at('day3', $1)`, [hours(T0, 2)]);
  ok((await exit(K, 'paywall_close', hours(T0, 13))).reason === 'gift_live', 'opened gift inside its 12 h: gift_live');
  ok((await rows(J)).length === 0 && (await rows(K)).length === 0, 'gift_live writes nothing');
  ok((await exit(K, 'paywall_close', hours(T0, 14.01))).eligible, 'after the gift ended: eligible');

  // ─── cancel: own active App Store subscription only ───
  const lm = await pair(L, M);
  await entitle(L, true, 'app_store', hours(T0, 300));
  const l1 = await exit(L, 'cancel', T0);
  ok(l1.eligible && same(l1.first_shown_at, T0), 'own active App Store subscriber: cancel offer eligible');
  ok((await exit(L, 'cancel', hours(T0, 48))).reason === 'shown_before', 'cancel offer once per person ever');
  ok((await exit(M, 'cancel', T0)).reason === 'no_subscription', 'the covered partner (no own subscription) is not eligible');
  ok((await exit(L, 'paywall_close', T0)).reason === 'premium', 'a subscriber never gets the paywall exit offer');
  await entitle(N, true, 'play_store', hours(T0, 300));
  ok((await exit(N, 'cancel', T0)).reason === 'no_subscription', 'Play subscription: no in-app cancel offer in v1');
  await entitle(O, true, 'app_store', hours(T0, -0.001));
  ok((await exit(O, 'cancel', T0)).reason === 'no_subscription', 'expired App Store subscription: no cancel offer');
  ok((await exit(P, 'cancel', T0)).reason === 'no_subscription', 'never subscribed: no cancel offer');
  ok((await rows(N)).length + (await rows(O)).length + (await rows(P)).length === 0, 'cancel refusals write nothing');

  // ─── D52: one full-screen offer per person per day ───
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [Q]);
  ok((await db.query(`select private.claim_offer_screen_at('paywall', $1) c`, [T0])).rows[0].c, 'fixture: Q saw an auto paywall today');
  const q1 = await exit(Q, 'paywall_close', hours(T0, 0.1));
  ok(q1.reason === 'daily_limit' && (await rows(Q)).length === 0, 'second full-screen offer the same day: daily_limit, not consumed');
  ok((await exit(Q, 'paywall_close', hours(T0, 24))).eligible, 'next local day: eligible');
  ok((await db.query(`select screen from private.offer_screens where user_id=$1 order by local_date desc limit 1`, [Q])).rows[0].screen
    === 'exit_paywall_close', 'the exit offer takes the day slot as exit_paywall_close');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [Q]);
  ok(!(await db.query(`select private.claim_offer_screen_at('gift', $1) c`, [hours(T0, 24.1)])).rows[0].c,
    'after the exit offer, no other full-screen offer that day');

  // ─── bad input ───
  for (const t of ['exit_paywall', 'PAYWALL_CLOSE', '', null]) {
    const r = await exit(R, t, T0);
    ok(r.eligible === false && r.reason === 'unknown_trigger', `trigger ${JSON.stringify(t)}: unknown_trigger`);
  }
  ok((await exit(R, 'paywall_close', 'infinity')).reason === 'unknown_trigger', 'infinite clock refused');
  ok((await rows(R)).length === 0, 'bad input writes nothing');

  // BE-62 (D61): `paywall_close` is retired in the public RPC (exit-offer-retired.test.mjs); use `cancel`.
  await entitle(S, true, 'app_store', '2027-12-01T00:00:00Z');
  // ─── public RPC ───
  const pub = (await as(S, `select open_exit_offer('cancel', $1) j`, [X1])).rows[0].j;
  ok(pub.eligible === true && pub.server_now && pub.first_shown_at && pub.reason === null, 'open_exit_offer: eligible + server_now');
  const pub2 = (await as(S, `select open_exit_offer('cancel') j`)).rows[0].j;
  ok(!pub2.eligible && pub2.reason === 'shown_before' && same(pub2.first_shown_at, pub.first_shown_at),
    'public RPC: second call shown_before with the same first_shown_at');
  ok((await as(S, `select open_exit_offer('cancel', $1) j`, [X1])).rows[0].j.eligible, 'public RPC: client_id retry');
  ok(/permission denied/.test(await fails('anon', null, `select open_exit_offer('cancel')`)), 'anon cannot call open_exit_offer');
  ok(await fails('authenticated', null, `select open_exit_offer('cancel')`) === 'NOT_AUTHENTICATED',
    'open_exit_offer needs a JWT subject');

  // ─── access ───
  for (const role of ['anon', 'authenticated']) {
    for (const sql of ['select * from private.exit_offers',
      `select private.open_exit_offer_at('paywall_close', null, now())`,
      `select private.day3_live_at('${ab}', now())`]) {
      ok(/permission denied/.test(await fails(role, A, sql)), `${role}: ${sql.slice(0, 45)} denied`);
    }
  }
  ok(/permission denied/.test(await fails('service_role', null, `select private.open_exit_offer_at('cancel', null, now())`)),
    'service_role cannot pin the exit-offer clock');
  const fn = (await db.query(`select p.prosecdef d, p.proconfig c from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='open_exit_offer'`)).rows;
  ok(fn.length === 1 && fn[0].d && fn[0].c.some((x) => x.startsWith('search_path=')), 'open_exit_offer: one overload, definer, search_path set');
  ok((await db.query(`select relrowsecurity r from pg_class where oid='private.exit_offers'::regclass`)).rows[0].r, 'RLS on exit_offers');
  ok(fg && lm, 'fixtures');

  // ─── delete account cascade ───
  ok((await rows(L)).length === 1, 'fixture: L has a row');
  await db.query('delete from auth.users where id=$1', [L]);
  ok((await rows(L)).length === 0, 'deleting the account removes its exit-offer rows');
  ok((await rows(A)).length === 1, "other people's rows stay");

  console.log(`\n${passed} passed, 0 failed`);
} finally { await db.close(); }
