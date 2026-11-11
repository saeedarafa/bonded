// BE-44 (D48): little things, data and limits.
//   * send_little_thing(p_kind, p_amount, p_client_id) → {id, same_time, at_limit}; limits per sender per
//     sender-local day by tier: free 10 kisses (per kiss) / 5 hugs / 3 miss-yous, Premium 50/30/15,
//     everyone 1 goodnight + 1 good morning → LITTLE_THING_LIMIT {"kind","more_with_premium"}.
//   * undo_little_thing(p_id): sender only, ≤ 5 s, gives the count back → UNDO_EXPIRED after.
//   * same_time: a hug within 10 s after the partner's hug, decided by the server.
//   * little_things_today(): per kind at_limit + more_with_premium, no counts.
//   * RLS: couple members read, nobody writes directly; other couples and anon see nothing.
// Clocks are pinned through the private *_at variants (called as the owner with the user's JWT subject).
// Usage: node supabase/tests/little-things.test.mjs
import { createDb } from './pglite-supabase.mjs';
import { randomUUID } from 'node:crypto';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e; } };
const owner = (sql, params) => db.query(sql, params);
const is = (e, msg, detail) => e?.message === msg && e.code === 'P0001' && (detail === undefined || e.detail === JSON.stringify(detail));
const perm = e => /permission denied/.test(e?.message ?? '');

// Clock-pinned calls: owner session, JWT subject set (the definer reads auth.uid()).
const withSub = async (uid, fn) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return await fn(); } finally { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); }
};
const sendAt = (uid, now, kind, amount = 1, client = null) => withSub(uid, async () =>
  (await db.query('select (r).id, (r).same_time, (r).at_limit from (select private.send_little_thing_at($1, $2, $3, $4) r) s', [kind, amount, client, now])).rows[0]);
const sendErr = async (...a) => { try { await sendAt(...a); return null; } catch (e) { return e; } };
const undoAt = (uid, now, id) => withSub(uid, async () => (await db.query('select * from private.undo_little_thing_at($1, $2)', [id, now])).rows);
const undoErr = async (...a) => { try { await undoAt(...a); return null; } catch (e) { return e; } };
const todayAt = (uid, now) => withSub(uid, async () =>
  Object.fromEntries((await db.query('select * from private.little_things_today_at($1)', [now])).rows.map(r => [r.kind, r])));
const at = (base, s) => new Date(new Date(base).getTime() + s * 1000).toISOString();

const U = n => `00000000-0000-0000-0000-0000000044${n}`;
const [MAYA, SAM, EVE, OUT, PRO1, PRO2, SOLO, NEW1] = ['01', '02', '03', '04', '05', '06', '07', '08'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, OUT, PRO1, PRO2, SOLO, NEW1].map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) values ('LT-Q1', 1);`);
const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  return couple;
};
const couple = await pair(MAYA, SAM);           // free
const otherCouple = await pair(EVE, OUT);       // free
const proCouple = await pair(PRO1, PRO2);       // Premium through PRO1
await as(SOLO, `select create_couple('dating', '{}', null)`);
await owner(`insert into entitlements (user_id, is_active, expires_at) values ($1, true, '2999-01-01')`, [PRO1]);
// Maya lives in New York, Sam in Tokyo: each sender's own day counts.
await owner(`update profiles set timezone = 'America/New_York' where id = $1`, [MAYA]);
await owner(`update profiles set timezone = 'Asia/Tokyo' where id = $1`, [SAM]);

const D1 = '2030-03-10T15:00:00Z'; // 11:00 in New York (Mar 10), 00:00 Mar 11 in Tokyo

// ═══ Free tier: kisses counted per kiss ═══
let r = await sendAt(MAYA, D1, 'kiss', 3);
ok(r && r.same_time === false && r.at_limit === false, 'a batch of 3 kisses is sent (same_time false, not at limit)');
ok(Number((await owner(`select amount from little_things where id = $1`, [r.id])).rows[0].amount) === 3, 'the batch is one row with amount 3');
await sendAt(MAYA, at(D1, 60), 'kiss', 5);
let e = await sendErr(MAYA, at(D1, 120), 'kiss', 3);
ok(is(e, 'LITTLE_THING_LIMIT', { kind: 'kiss', more_with_premium: true }), `8 used + batch of 3 > 10 → LITTLE_THING_LIMIT {"kind":"kiss","more_with_premium":true}, refused whole (got ${e?.message} ${e?.detail})`);
r = await sendAt(MAYA, at(D1, 180), 'kiss', 2);
ok(r.at_limit === true, 'the 9th and 10th kiss are accepted and report at_limit');
e = await sendErr(MAYA, at(D1, 240), 'kiss', 1);
ok(is(e, 'LITTLE_THING_LIMIT', { kind: 'kiss', more_with_premium: true }), 'a free user cannot send an 11th kiss in a day');
ok(Number((await owner(`select coalesce(sum(amount),0) n from little_things where sender_id = $1 and kind = 'kiss' and undone_at is null`, [MAYA])).rows[0].n) === 10, 'refused sends write nothing (10 kisses stored)');
let t = await todayAt(MAYA, at(D1, 300));
ok(t.kiss.at_limit === true && t.kiss.more_with_premium === true && t.hug.at_limit === false, 'little_things_today: kiss at limit, more with Premium; hug not at limit');
ok(Object.keys(t).join() === 'hug,kiss,goodnight,good_morning,miss_you' && !('count' in t.kiss) && Object.keys(t.kiss).length === 3,
  'little_things_today returns the five kinds with {kind, at_limit, more_with_premium} only (no countdown)');

// Sender-local day: Maya's New York midnight resets her, not UTC midnight.
const D1_LATE = '2030-03-11T03:30:00Z';  // 23:30 Mar 10 in New York, next UTC day
const D2 = '2030-03-11T04:30:00Z';       // 00:30 Mar 11 in New York
ok(is(await sendErr(MAYA, D1_LATE, 'kiss', 1), 'LITTLE_THING_LIMIT'), 'still the same New York day after UTC midnight → limit holds');
ok((await sendAt(MAYA, D2, 'kiss', 1)).id, 'after the sender\'s local midnight the kisses reset');
// Sam's day is Tokyo's: D1 is 00:00 Mar 11 there; Maya's kisses do not count for him.
ok((await sendAt(SAM, D1, 'kiss', 5)).id, 'the partner has his own count (limits are per sender)');

// ═══ Free tier: hugs (any length counts 1) and miss-yous ═══
for (let i = 0; i < 4; i++) await sendAt(MAYA, at(D1, 1000 + i * 60), 'hug', 5000);
r = await sendAt(MAYA, at(D1, 1300), 'hug', 200);
ok(r.at_limit === true, 'the 5th hug (any length) is accepted and at limit');
ok(is(await sendErr(MAYA, at(D1, 1400), 'hug', 100), 'LITTLE_THING_LIMIT', { kind: 'hug', more_with_premium: true }), 'free 6th hug → LITTLE_THING_LIMIT (hug, more with Premium)');
for (let i = 0; i < 3; i++) await sendAt(MAYA, at(D1, 2000 + i * 60), 'miss_you');
ok(is(await sendErr(MAYA, at(D1, 2300), 'miss_you'), 'LITTLE_THING_LIMIT', { kind: 'miss_you', more_with_premium: true }), 'free 4th miss-you → LITTLE_THING_LIMIT');

// ═══ Everyone: 1 goodnight, 1 good morning ═══
ok((await sendAt(MAYA, at(D1, 3000), 'goodnight')).at_limit === true, 'first goodnight accepted and at limit');
ok(is(await sendErr(MAYA, at(D1, 3060), 'goodnight'), 'LITTLE_THING_LIMIT', { kind: 'goodnight', more_with_premium: false }), 'goodnight twice → LITTLE_THING_LIMIT, more_with_premium false');
await sendAt(MAYA, at(D1, 3100), 'good_morning');
ok(is(await sendErr(MAYA, at(D1, 3160), 'good_morning'), 'LITTLE_THING_LIMIT', { kind: 'good_morning', more_with_premium: false }), 'good morning twice → LITTLE_THING_LIMIT');
await sendAt(PRO1, at(D1, 3000), 'goodnight');
ok(is(await sendErr(PRO1, at(D1, 3060), 'goodnight'), 'LITTLE_THING_LIMIT', { kind: 'goodnight', more_with_premium: false }), 'Premium also gets 1 goodnight');

// ═══ Premium: 50 / 30 / 15, for both partners (couple-level) ═══
for (let i = 0; i < 10; i++) await sendAt(PRO2, at(D1, 4000 + i), 'kiss', 5);
ok(is(await sendErr(PRO2, at(D1, 4100), 'kiss', 1), 'LITTLE_THING_LIMIT', { kind: 'kiss', more_with_premium: false }), 'Premium (partner of the subscriber): 51st kiss → limit, more_with_premium false');
for (let i = 0; i < 30; i++) await sendAt(PRO1, at(D1, 5000 + i), 'hug', 1000);
ok(is(await sendErr(PRO1, at(D1, 5100), 'hug'), 'LITTLE_THING_LIMIT', { kind: 'hug', more_with_premium: false }), 'Premium 31st hug → limit');
for (let i = 0; i < 15; i++) await sendAt(PRO1, at(D1, 6000 + i), 'miss_you');
ok(is(await sendErr(PRO1, at(D1, 6100), 'miss_you'), 'LITTLE_THING_LIMIT'), 'Premium 16th miss-you → limit');
t = await todayAt(PRO2, at(D1, 7000));
ok(t.kiss.at_limit && !t.kiss.more_with_premium && !t.hug.at_limit, 'Premium today: kiss at limit, no Premium upsell; hug (PRO2) free to send');
// A lapse: the limit drops to the free numbers; what was sent stays.
await owner(`update entitlements set expires_at = '2000-01-01' where user_id = $1`, [PRO1]);
t = await todayAt(PRO1, at(D1, 7000));
ok(t.hug.at_limit && t.hug.more_with_premium, 'after a lapse 30 hugs are over the free 5: at limit, more with Premium');
await owner(`update entitlements set expires_at = '2999-01-01' where user_id = $1`, [PRO1]);

// ═══ Invalid input ═══
for (const [kind, amount, label] of [['kiss', 6, 'kiss batch of 6'], ['kiss', 0, 'kiss amount 0'], ['hug', 5001, 'hug over 5 s'], ['hug', 0, 'hug of 0 ms'],
  ['goodnight', 2, 'goodnight amount 2'], ['wink', 1, 'unknown kind'], [null, 1, 'null kind']]) {
  ok(is(await sendErr(EVE, D1, kind, amount), 'INVALID_LITTLE_THING'), `${label} → INVALID_LITTLE_THING`);
}
ok((await sendAt(EVE, D1, 'miss_you', null)).id, 'a null amount means 1');

// ═══ Not paired ═══
ok(is(await sendErr(SOLO, D1, 'hug', 100), 'NOT_PAIRED'), 'a solo couple cannot send (no partner) → NOT_PAIRED');
ok(is(await errOf('authenticated', NEW1, `select * from little_things_today()`), 'NOT_PAIRED'), 'no couple → little_things_today NOT_PAIRED');
ok(is(await errOf('authenticated', null, `select send_little_thing('hug', 1)`), 'NOT_AUTHENTICATED'), 'no JWT subject → NOT_AUTHENTICATED');

// ═══ Undo: sender only, ≤ 5 s, gives the count back ═══
const H = '2030-04-01T12:00:00Z';
const k5 = await sendAt(EVE, H, 'kiss', 5);
const k5b = await sendAt(EVE, at(H, 1), 'kiss', 5);
ok(k5b.at_limit, 'Eve is at 10 kisses');
ok(is(await undoErr(OUT, at(H, 2), k5b.id), 'INVALID_LITTLE_THING'), 'the partner cannot undo my gesture (INVALID_LITTLE_THING)');
ok(is(await undoErr(MAYA, at(H, 2), k5b.id), 'INVALID_LITTLE_THING'), 'another couple cannot undo it (same code as an unknown id)');
ok(is(await undoErr(EVE, at(H, 2), randomUUID()), 'INVALID_LITTLE_THING'), 'unknown id → INVALID_LITTLE_THING');
let st = await undoAt(EVE, at(H, 6), k5b.id);
ok(st.find(x => x.kind === 'kiss').at_limit === false, 'undo at exactly 5 s succeeds and returns the state (kiss no longer at limit)');
ok((await owner(`select undone_at from little_things where id = $1`, [k5b.id])).rows[0].undone_at !== null, 'the row is kept with undone_at set (realtime UPDATE, BE-45 skips the push)');
ok((await undoAt(EVE, at(H, 60), k5b.id)).length === 5, 'undoing again is idempotent (no UNDO_EXPIRED for an undone row)');
ok((await sendAt(EVE, at(H, 7), 'kiss', 5)).at_limit, 'the undone 5 kisses are given back: 5 more can be sent');
ok(is(await undoErr(EVE, at(H, 5.001), k5.id), 'UNDO_EXPIRED'), 'undo after 5 s → UNDO_EXPIRED');
ok((await owner(`select undone_at from little_things where id = $1`, [k5.id])).rows[0].undone_at === null, 'an expired undo changes nothing');
const old = await sendAt(EVE, '2021-01-01T00:00:00Z', 'miss_you');
ok(is(await errOf('authenticated', EVE, `select * from undo_little_thing($1)`, [old.id]), 'UNDO_EXPIRED'), 'public undo_little_thing on a send from the past → UNDO_EXPIRED (database clock)');

// ═══ Same-time hug (server decides, 10 s) ═══
const S = '2030-05-01T12:00:00Z';
r = await sendAt(EVE, S, 'hug', 1000);
ok(r.same_time === false, 'the first hug is not same-time');
r = await sendAt(OUT, at(S, 10), 'hug', 3000);
ok(r.same_time === true, 'the partner\'s hug 10 s later → same_time true');
ok((await owner(`select same_time from little_things where id = $1`, [r.id])).rows[0].same_time === true, 'same_time is stored on the row (the partner sees it through realtime)');
ok((await sendAt(EVE, at(S, 21), 'hug', 1000)).same_time === false, 'a hug 11 s after the partner\'s → not same-time');
const lone = await sendAt(OUT, at(S, 200), 'hug', 1000);
await undoAt(OUT, at(S, 201), lone.id);
ok((await sendAt(EVE, at(S, 202), 'hug', 1000)).same_time === false, 'an undone partner hug does not make it same-time');
ok((await sendAt(EVE, at(S, 300), 'kiss', 1)).same_time === false, 'only hugs can be same-time');
await sendAt(EVE, at(S, 400), 'hug', 1000);
ok((await sendAt(EVE, at(S, 401), 'hug', 1000)).same_time === false, 'my own two hugs are not same-time');
// Another couple's hug never counts.
const MX = '2030-05-02T12:00:00Z';
await sendAt(PRO1, MX, 'hug', 1000);
ok((await sendAt(EVE, at(MX, 1), 'hug', 1000)).same_time === false, 'another couple\'s hug at the same moment does not count');

// ═══ Idempotent retry with p_client_id ═══
const cid = randomUUID();
const I = '2030-06-01T12:00:00Z';
const first = await sendAt(SAM, I, 'kiss', 4, cid);
const again = await sendAt(SAM, at(I, 30), 'kiss', 4, cid);
ok(first.id === again.id, 'a retry with the same client id returns the same id');
ok(Number((await owner(`select count(*) n from little_things where sender_id = $1 and client_id = $2`, [SAM, cid])).rows[0].n) === 1, 'the retry writes nothing and counts once');
const sentPublic = (await as(SAM, `select * from send_little_thing('miss_you', 1, $1)`, [cid])).rows[0];
ok(sentPublic.id === first.id, 'the public RPC with a used client id also returns the first result');

// ═══ RLS: read own couple, write nothing directly ═══
const mine = (await as(MAYA, 'select couple_id, sender_id from little_things')).rows;
ok(mine.length > 0 && mine.every(x => x.couple_id === couple), 'Maya reads only her couple\'s rows');
ok(mine.some(x => x.sender_id === SAM), 'Maya reads her partner\'s gestures (for 24d)');
ok((await as(EVE, 'select 1 from little_things where couple_id = $1', [couple])).rows.length === 0, 'another couple sees none of them');
ok(perm(await errOf('anon', null, 'select * from little_things')), 'anon cannot read little_things');
ok(perm(await errOf('authenticated', MAYA, `insert into little_things (couple_id, sender_id, kind, local_date) values ($1, $2, 'kiss', '2030-01-01')`, [couple, MAYA])), 'direct insert is denied (only through send_little_thing)');
ok(perm(await errOf('authenticated', MAYA, `update little_things set undone_at = null where sender_id = $1`, [MAYA])), 'direct update is denied (no un-undo, no count tampering)');
ok(perm(await errOf('authenticated', MAYA, `delete from little_things where sender_id = $1`, [MAYA])), 'direct delete is denied');
for (const sql of [`select send_little_thing('hug', 1)`, 'select * from undo_little_thing(gen_random_uuid())', 'select * from little_things_today()']) {
  ok(perm(await errOf('anon', null, sql)), `anon cannot call ${sql.match(/(\w+)\(/g).at(-1)}`);
}
for (const sql of [`select private.send_little_thing_at('hug', 1, null, now())`, `select private.undo_little_thing_at(gen_random_uuid(), now())`, `select private.little_things_today_at(now())`]) {
  ok(perm(await errOf('authenticated', MAYA, sql)), `clients cannot call the clock-pinned ${sql.match(/private\.(\w+)/)[1]}`);
}
const pub = (await owner(`select count(*) n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'little_things'`)).rows[0];
ok(Number(pub.n) === 1, 'little_things is in supabase_realtime');

// Public RPC on the wall clock (smoke): today shape and a send.
const pubSend = (await as(PRO2, `select * from send_little_thing('hug', 2500)`)).rows[0];
ok(pubSend.id && typeof pubSend.same_time === 'boolean' && typeof pubSend.at_limit === 'boolean', 'public send_little_thing returns {id, same_time, at_limit}');
ok((await as(PRO2, 'select * from little_things_today()')).rows.length === 5, 'public little_things_today returns five rows');
ok((await as(PRO2, 'select * from undo_little_thing($1)', [pubSend.id])).rows.length === 5, 'public undo_little_thing right after the send succeeds');

// ═══ Error codes catalogued ═══
const codes = (await owner(`select unnest(enum_range(null::public.error_code))::text c`)).rows.map(x => x.c);
ok(['LITTLE_THING_LIMIT', 'INVALID_LITTLE_THING', 'UNDO_EXPIRED'].every(c => codes.includes(c)), 'LITTLE_THING_LIMIT, INVALID_LITTLE_THING, UNDO_EXPIRED are in public.error_code');

// ═══ Deletion: account (D09) and couple purge (D08) ═══
const before = Number((await owner(`select count(*) n from little_things where sender_id = $1`, [SAM])).rows[0].n);
ok(before > 0, 'Sam has sent gestures');
await owner('delete from auth.users where id = $1', [SAM]);
ok(Number((await owner(`select count(*) n from little_things where sender_id = $1`, [SAM])).rows[0].n) === 0, 'deleting the account deletes the sender\'s gestures');
await as(EVE, 'select unpair()');
ok((await as(EVE, 'select 1 from little_things limit 1')).rows.length === 1, 'after unpair the gestures stay readable in the 30-day archive');
ok(is(await sendErr(EVE, '2030-07-01T12:00:00Z', 'hug', 100), 'NOT_PAIRED'), 'an ended couple cannot send');
await owner(`select private.purge_ended_couples(now() + interval '31 days')`);
ok(Number((await owner(`select count(*) n from little_things where couple_id = $1`, [otherCouple])).rows[0].n) === 0, 'the D08 purge deletes the couple\'s gestures');

console.log(`\n${passed} passed, ${failed} failed`);
