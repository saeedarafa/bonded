// BE-47 / D52: the day-3 gift. Eligibility (premium, ever subscribed, trial used), once per couple,
// 12 h from the first open with no extension, intro/winback retired, one full-screen offer per
// person per day, and the `offer_ending` push (timing, quiet hours, D24 cap, once).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createDb, defaultMigrations } from './pglite-supabase.mjs';
import { contentSql } from '../scripts/content-sql.mjs';

const MIGRATION = '20261111130000_day3_offer.sql';
const all = defaultMigrations();
const mine = all.find((f) => path.basename(f) === MIGRATION);
assert.ok(mine, 'BE-47 migration present');
// Build the database as it was before BE-47 so a D28 clock can be started the old way.
const db = await createDb(all.filter((f) => path.basename(f) < MIGRATION));
await db.exec(contentSql());
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const id = (n) => `00000000-0000-4000-a000-0000000047${String(n).padStart(2, '0')}`;
const users = Array.from({ length: 30 }, (_, i) => id(i + 1));
const [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X] = users;
const run = async (role, uid, sql, params = []) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const fails = async (role, uid, sql, params) => {
  try { await run(role, uid, sql, params); return ''; } catch (e) { return e.message; }
};
const at = async (uid, fn, kind, time) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  return (await db.query(`select private.${fn}($1, $2) j`, [kind, time])).rows[0].j;
};
const get = (uid, kind, time) => at(uid, 'get_offer_at', kind, time);
const open = (uid, kind, time) => at(uid, 'open_offer_at', kind, time);
const hours = (iso, h) => new Date(Date.parse(iso) + h * 3600 * 1000).toISOString();
const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating') c`)).rows[0].c;
  const invite = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [invite.c, invite.t]);
  return couple;
};
// The badge trigger is what earns the gift; insert the award with a pinned time.
const earn = (couple, time, slug = 'streak-3') =>
  db.query('insert into badge_awards(badge_slug, couple_id, awarded_at) values ($1,$2,$3) on conflict do nothing',
    [slug, couple, time]);
const day3 = async (couple) =>
  (await db.query(`select * from couple_offers where couple_id=$1 and kind='day3'`, [couple])).rows[0];
const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;
const T0 = '2026-11-20T15:00:00Z';

try {
  await db.query(`insert into auth.users(id) values ${users.map((_, i) => `($${i + 1})`).join()}`, users);

  // ─── D28 clock started before BE-47, then the migration ───
  const old = await pair(A, B);
  const before = await get(A, 'intro', T0);
  ok(before.eligible && before.expires_at, 'pre-BE-47: an intro clock is started the old way');
  await db.exec(readFileSync(mine, 'utf8'));
  const kept = await get(B, 'intro', hours(T0, 1));
  ok(kept.eligible && kept.expires_at === before.expires_at, 'existing intro clock still reads after the migration');
  ok(!(await get(B, 'intro', hours(T0, 24))).eligible, 'and ends at its original 24 h');
  ok(!(await get(A, 'winback', '2026-11-22T15:00:00Z')).eligible
    && await count(`select count(*)::int n from couple_offers where couple_id=$1`, [old]) === 1,
    'winback is retired: no new clock on day 3');
  const fresh = await pair(C, D);
  for (const kind of ['intro', 'winback']) {
    const r = await get(C, kind, T0);
    ok(!r.eligible && r.expires_at === null, `${kind} is retired for new couples`);
  }
  ok(await count(`select count(*)::int n from couple_offers where couple_id=$1`, [fresh]) === 0, 'retired kinds write nothing');

  // ─── earned with the first 3-day badge through the streak trigger ───
  await db.query('update couple_streaks set current=1 where couple_id=$1', [fresh]);
  ok(!(await day3(fresh)), 'the 1-day badge earns nothing');
  await db.query('update couple_streaks set current=3 where couple_id=$1', [fresh]);
  const earned = await day3(fresh);
  ok(earned && earned.first_opened_at === null && earned.expires_at === null && earned.first_shown_at === null
    && earned.earned_at, 'reaching 3 days on the free plan creates one unopened day3 offer (no clock yet)');
  const unopened = await get(D, 'day3', hours(earned.earned_at.toISOString(), 72));
  ok(unopened.eligible && unopened.expires_at === null && unopened.first_opened_at === null,
    'an unopened gift is live with no countdown, for both partners');
  ok((await day3(fresh)).first_opened_at === null, 'reading never starts the clock');

  // ─── 12 h from the first open, shared, never extended ───
  const g = await pair(E, F);
  await earn(g, T0);
  const OPEN = hours(T0, 5);
  const first = await open(E, 'day3', OPEN);
  ok(first.eligible && first.first_opened_at && Date.parse(first.expires_at) === Date.parse(OPEN) + 12 * 3600e3,
    'first open sets expires_at = first_opened_at + 12 h');
  const partner = await open(F, 'day3', hours(OPEN, 3));
  ok(partner.eligible && partner.expires_at === first.expires_at && partner.first_opened_at === first.first_opened_at,
    'partner opening later shares the same clock (no extension)');
  ok((await open(E, 'day3', hours(OPEN, 11))).expires_at === first.expires_at, 'reopening is idempotent');
  ok((await get(F, 'day3', hours(OPEN, 12 - 1 / 3600))).eligible, 'live one second before the end');
  const ended = await open(E, 'day3', hours(OPEN, 12));
  ok(!ended.eligible && ended.expires_at === first.expires_at, 'ends exactly 12 h after the first open');
  ok(!(await open(F, 'day3', hours(OPEN, 48))).eligible
    && (await day3(g)).expires_at.getTime() === Date.parse(first.expires_at), 'an expired gift never restarts');
  await db.query(`update couple_streaks set current=0 where couple_id=$1`, [g]);
  await db.query(`update couple_streaks set current=3 where couple_id=$1`, [g]);
  ok(await count(`select count(*)::int n from couple_offers where couple_id=$1 and kind='day3'`, [g]) === 1,
    'reaching 3 days again never earns a second gift (once per couple)');

  // ─── eligibility at earn time ───
  const prem = await pair(G, H);
  await db.query(`insert into entitlements(user_id,is_active,product_id,expires_at,updated_at)
    values ($1,true,'yearly',$2,$3)`, [H, hours(T0, 240), T0]);
  await earn(prem, hours(T0, 1));
  ok(!(await day3(prem)), 'a Premium couple earns no gift');
  const past = await pair(I, J);
  await db.query(`insert into entitlements(user_id,is_active,product_id,expires_at,updated_at)
    values ($1,false,'monthly','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`, [I]);
  await earn(past, T0);
  ok(!(await day3(past)), 'a couple where someone subscribed before (expired) earns no gift');
  const trialled = await pair(K, L);
  await db.query(`select apply_revenuecat_event('evt-trial',$1,$2::jsonb)`, ['2026-11-01T00:00:00Z', JSON.stringify([{
    user_id: L, is_active: true, product_id: 'yearly', store: 'app_store', expires_at: '2026-11-08T00:00:00Z',
    period_type: 'trial', period_started_at: '2026-11-01T00:00:00Z', will_renew: false }])]);
  await db.query(`select apply_revenuecat_event('evt-trial-end',$1,$2::jsonb)`, ['2026-11-08T00:00:00Z', JSON.stringify([{
    user_id: L, is_active: false, product_id: null, store: null, expires_at: null }])]);
  ok(await count('select count(*)::int n from private.subscription_trials where user_id=$1', [L]) === 0,
    'the cancelled trial has left the BE-48 trial table');
  await earn(trialled, T0);
  ok(!(await day3(trialled)), 'a couple that used a trial earns no gift (durable history)');
  const sync = await pair(M, N);
  await db.query(`select apply_revenuecat_event('evt-none',$1,$2::jsonb)`, [T0, JSON.stringify([{
    user_id: M, is_active: false, product_id: null, store: null, expires_at: null }])]);
  await earn(sync, hours(T0, 1));
  ok(await day3(sync), 'an empty RevenueCat snapshot (never bought) does not count as a purchase');

  // streak broke before 3: the gift comes the first time they reach 3
  const broke = await pair(O, P);
  await db.query('update couple_streaks set current=2 where couple_id=$1', [broke]);
  await db.query('update couple_streaks set current=0 where couple_id=$1', [broke]);
  ok(!(await day3(broke)), 'no gift while the streak broke before 3');
  await db.query('update couple_streaks set current=4 where couple_id=$1', [broke]);
  ok(await day3(broke), 'a late answer jumping 2 → 4 still earns it at the first 3-day badge');

  // once per pair of people: unpair and re-pair the same two doesn't earn again; a new partner does
  await as(E, 'select unpair()');
  const again = await pair(E, F);
  await earn(again, hours(T0, 100));
  ok(!(await day3(again)), 're-pairing the same two people earns no second gift');
  await as(E, 'select unpair()');
  const newPartner = await pair(E, Q);
  await earn(newPartner, hours(T0, 100));
  ok(await day3(newPartner), 'a new pair of people is a new couple');

  // ─── after earning ───
  const later = await pair(R, S);
  await earn(later, T0);
  await db.query(`insert into entitlements(user_id,is_active,product_id,expires_at,updated_at)
    values ($1,true,'yearly',$2,$3)`, [S, hours(T0, 300), hours(T0, 1)]);
  const premOpen = await open(R, 'day3', hours(T0, 2));
  ok(!premOpen.eligible && premOpen.expires_at === null, 'a couple that became Premium cannot open (no clock starts)');
  await db.query(`update entitlements set is_active=false, updated_at=$2 where user_id=$1`, [S, hours(T0, 3)]);
  ok(!(await open(R, 'day3', hours(T0, 4))).eligible, 'after a refund/expiry the gift stays gone (ever subscribed)');
  ok(!(await get(R, 'day3', hours(T0, 4))).eligible, 'the read agrees');
  ok((await get(G, 'day3', T0)).eligible === false && (await get(G, 'day3', T0)).expires_at === null,
    'no offer: ineligible with null fields');
  const early = await open(M, 'day3', hours(T0, 0.5));
  ok(!early.eligible && early.expires_at === null, 'not live before it was earned (pinned clock)');
  // partner leaves: solo
  const solo = await pair(T, U);
  await earn(solo, T0);
  await open(T, 'day3', hours(T0, 1));
  await as(U, 'select unpair()');
  ok(/NOT_PAIRED/.test(await fails('authenticated', U, `select open_offer('day3')`)), 'a former member cannot open');

  // ─── public RPCs ───
  const pub = async (uid, fn, kind) => {
    const row = (await as(uid, `select ${fn}($1) j, now() clock`, [kind])).rows[0];
    ok(Date.parse(row.j.server_now) === row.clock.getTime(), `${fn}('${kind}') returns the server transaction time`);
    return row.j;
  };
  const live = await pair(V, W);
  await earn(live, '2026-01-01T00:00:00Z');
  const g1 = await pub(V, 'get_offer', 'day3');
  assert.deepEqual(Object.keys(g1).sort(), ['eligible', 'expires_at', 'first_opened_at', 'server_now']);
  ok(g1.eligible && g1.expires_at === null, 'get_offer(day3) on an unopened gift: live, no clock');
  const o1 = await pub(W, 'open_offer', 'day3');
  ok(o1.eligible && Date.parse(o1.expires_at) - Date.parse(o1.server_now) === 12 * 3600e3,
    'open_offer starts exactly 12 h relative to server time');
  const o2 = await pub(V, 'open_offer', 'day3');
  ok(o2.expires_at === o1.expires_at, 'partner open returns the same expiry');
  for (const kind of ['intro', 'winback', null, 'DAY3']) {
    const r = await pub(V, 'open_offer', kind);
    ok(!r.eligible && r.expires_at === null, `open_offer(${JSON.stringify(kind)}) starts nothing`);
  }
  ok(await count(`select count(*)::int n from couple_offers where couple_id=$1`, [live]) === 1, 'no stray rows');

  // ─── access ───
  ok((await as(V, `select kind from couple_offers`)).rows.length === 1, 'members read their own day3 row');
  ok((await as(A, `select * from couple_offers where couple_id=$1`, [live])).rows.length === 0, 'another couple cannot');
  for (const sql of [
    `update couple_offers set expires_at = expires_at + interval '1 day'`,
    `insert into couple_offers(couple_id,kind,earned_at) values ('${live}','day3',now())`,
    `delete from couple_offers`,
  ]) ok(/permission denied/.test(await fails('authenticated', V, sql)), 'clients cannot write offers');
  for (const fn of [`open_offer('day3')`, `claim_offer_screen('gift')`]) {
    ok(/permission denied/.test(await fails('anon', null, `select ${fn}`)), `anon cannot call ${fn}`);
    ok(await fails('authenticated', null, `select ${fn}`) === 'NOT_AUTHENTICATED', `${fn} needs a JWT subject`);
  }
  for (const role of ['anon', 'authenticated']) {
    for (const sql of ['select * from due_offer_endings(now())', 'select * from private.premium_history',
      'select * from private.offer_screens', 'select * from private.offer_reminders',
      `select private.open_offer_at('day3', now())`]) {
      ok(/permission denied/.test(await fails(role, V, sql)), `${role}: ${sql.slice(0, 40)} denied`);
    }
  }
  ok(/permission denied/.test(await fails('service_role', null, `select private.open_offer_at('day3', now())`)),
    'service_role cannot pin the open clock');
  ok(await count('select count(*)::int n from badge_awards b where b.badge_slug=$1', ['streak-3']) > 0,
    'badge awards still land (the gift trigger never blocks them)');

  // ─── one full-screen offer per person per day ───
  await db.query(`update profiles set timezone='America/Los_Angeles' where id=$1`, [X]);
  const screen = async (uid, s, time) => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    return (await db.query('select private.claim_offer_screen_at($1,$2) ok', [s, time])).rows[0].ok;
  };
  const DAY = '2026-11-20T16:00:00Z'; // 08:00 in Los Angeles
  ok(await screen(X, 'gift', DAY), 'first full-screen offer of the day is allowed');
  ok(await screen(X, 'gift', hours(DAY, 1)), 'retrying the same screen the same day is allowed (idempotent)');
  ok(!(await screen(X, 'paywall', hours(DAY, 2))), 'a second, different full-screen offer that day is refused');
  ok(!(await screen(X, 'paywall', '2026-11-21T07:59:00Z')), 'still the same local day at 23:59 in Los Angeles');
  ok(await screen(X, 'paywall', '2026-11-21T08:00:00Z'), 'the next local day allows one again');
  ok(await screen(W, 'paywall', DAY), 'the limit is per person (partner unaffected)');
  for (const bad of [null, '', 'Gift', 'a'.repeat(33), 'gift;drop']) {
    ok(!(await screen(X, bad, '2026-11-25T08:00:00Z')), `invalid screen ${JSON.stringify(bad)} is refused`);
  }
  ok(await count('select count(*)::int n from private.offer_screens where user_id=$1', [X]) === 2,
    'old days are trimmed; invalid input stores nothing');

  // ─── offer_ending push ───
  await db.query('delete from private.offer_reminders');
  const due = async (now) => (await db.query('select * from due_offer_endings($1)', [now])).rows;
  const forCouple = async (couple, now) => {
    const ids = (await db.query('select user_id from couple_members where couple_id=$1 and left_at is null', [couple]))
      .rows.map((r) => r.user_id);
    return (await due(now)).filter((r) => ids.includes(r.user_id));
  };
  // E+F (g) expired already. New couple for timing: open at 12:00 UTC → ends 00:00 UTC.
  const [P1, P2, P3, P4, P5, P6] = Array.from({ length: 6 }, (_, i) => id(60 + i));
  await db.query(`insert into auth.users(id) values ($1),($2),($3),($4),($5),($6),($7),($8)`, [P1, P2, P3, P4, P5, P6, id(72), id(73)]);
  const pc = await pair(P1, P2);
  await earn(pc, '2026-11-25T10:00:00Z');
  const pOpen = await open(P1, 'day3', '2026-11-25T12:00:00Z');
  const END = pOpen.expires_at; // 2026-11-26T00:00Z
  ok((await forCouple(pc, hours(END, -2.25))).length === 0, 'nothing before 2 h before the end');
  const sent = await forCouple(pc, hours(END, -2));
  ok(sent.length === 2 && sent.every((r) => r.minutes_left === 120), 'at 2 h before the end: both partners, minutes_left 120');
  ok((await db.query(`select count(*)::int n from push_log where type='offer_ending' and id = any($1::uuid[])`,
    [sent.map((r) => r.claim_id)])).rows[0].n === 2, 'claims recorded in push_log (no text)');
  ok((await forCouple(pc, hours(END, -2))).length === 0 && (await forCouple(pc, hours(END, -1))).length === 0,
    'once per partner: retries and later ticks claim nothing');

  // quiet hours, per recipient: ends 08:30Z, due 06:30Z = 06:30 UTC (quiet) / 07:30 Berlin (not quiet)
  const qc = await pair(P3, P4);
  await db.query(`update profiles set timezone='Europe/Berlin' where id=$1`, [P4]);
  await earn(qc, '2026-11-25T10:00:00Z');
  const qEnd = (await open(P3, 'day3', '2026-11-25T20:30:00Z')).expires_at;
  const atDue = await forCouple(qc, hours(qEnd, -2));
  ok(atDue.length === 1 && atDue[0].user_id === P4, 'at the due tick only the partner outside quiet hours is sent');
  ok((await forCouple(qc, hours(qEnd, -1.75))).length === 0, 'nothing for the other while still inside quiet hours');
  const after = await forCouple(qc, hours(qEnd, -1.5));
  ok(after.length === 1 && after[0].user_id === P3 && after[0].minutes_left === 90,
    'sent at the first tick after quiet hours end, inside the window');
  const qc2 = await pair(id(72), id(73));
  await earn(qc2, '2026-11-25T10:00:00Z');
  const q2End = (await open(id(72), 'day3', '2026-11-25T13:00:00Z')).expires_at; // ends 01:00Z, due 23:00Z
  let any = 0;
  for (let h = -2; h < -0.5; h += 0.25) any += (await forCouple(qc2, hours(q2End, h))).length;
  ok(any === 0, 'a window entirely inside quiet hours sends nothing (no catch-up after the end)');

  // cap: four pushes already today → released and retried; window closes 30 min before the end
  const cc = await pair(P5, P6);
  await earn(cc, '2026-11-25T10:00:00Z');
  const cEnd = (await open(P5, 'day3', '2026-11-25T10:00:00Z')).expires_at; // ends 22:00Z
  await db.query(`insert into push_log(user_id,type,record_id,local_date,created_at)
    select $1,'nudge',gen_random_uuid(),'2026-11-25',$2 from generate_series(1,4)`, [P5, hours(cEnd, -3)]);
  const capped = await forCouple(cc, hours(cEnd, -2));
  ok(capped.length === 1 && capped[0].user_id === P6, 'the D24 cap blocks the capped partner only');
  ok((await db.query('select count(*)::int n from private.offer_reminders where user_id=$1', [P5])).rows[0].n === 0,
    'a cap-blocked claim releases its ledger row');
  await db.query(`update push_log set status='suppressed' where user_id=$1 and type='nudge'
    and id = (select id from push_log where user_id=$1 and type='nudge' limit 1)`, [P5]);
  ok((await forCouple(cc, hours(cEnd, -0.5))).length === 0, 'the window closes 30 min before the end');
  ok((await forCouple(cc, hours(cEnd, -0.75))).length === 1, 'retried inside the window once the cap frees up');

  // skipped: premium couple, unopened gift, expired
  await db.query(`insert into entitlements(user_id,is_active,product_id,expires_at,updated_at)
    values ($1,true,'yearly',$2,$3)`, [P2, hours(END, 100), hours(END, -3)]);
  await db.query('delete from private.offer_reminders where couple_id=$1', [pc]);
  ok((await forCouple(pc, hours(END, -1))).length === 0, 'a couple that became Premium gets no offer_ending');
  ok((await forCouple(fresh, '2026-11-25T12:00:00Z')).length === 0, 'an unopened gift has no end and no push');

  console.log(`\n${passed} passed, 0 failed`);
} finally { await db.close(); }
