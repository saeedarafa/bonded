// BE-45 (D48, D24): little-things push, claimed in the database.
//   * claim_little_thing_pushes() (service only, database clock) → {user_id, claim_id, silent, partner_name,
//     gesture, counts}; private.claim_little_thing_pushes_at(p_now) pins the clock here (fake clock).
//   * Eligible 10 s after the send (undo window 5 s); everything eligible goes into one push; after a push,
//     new gestures wait 10 min and go out together; ≤ 1 push per gesture type per hour; the D24 4/day cap is
//     shared with every other type; toggle notification_prefs.little_things; quiet hours → silent; undone
//     gestures never push; a claimed gesture can no longer be undone (SEC-09d Info 1).
// Each scenario uses its own couple and its own day (the claim scans one day back across all couples).
// Usage: node supabase/tests/little-things-push.test.mjs
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
const is = (e, msg) => e?.message === msg && e.code === 'P0001';
const perm = e => /permission denied/.test(e?.message ?? '');
const withSub = async (uid, fn) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return await fn(); } finally { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); }
};
const sendAt = (uid, now, kind, amount = 1) => withSub(uid, async () =>
  (await db.query('select (r).id from (select private.send_little_thing_at($1, $2, null, $3) r) s', [kind, amount, now])).rows[0].id);
const undoAt = (uid, now, id) => withSub(uid, () => db.query('select * from private.undo_little_thing_at($1, $2)', [id, now]));
const undoErr = async (...a) => { try { await undoAt(...a); return null; } catch (e) { return e; } };
const claim = async now => (await owner('select * from private.claim_little_thing_pushes_at($1)', [now])).rows;
const claimFor = async (uid, now) => (await claim(now)).filter(r => r.user_id === uid);
const due = async now => (await owner('select private.little_things_due($1) b', [now])).rows[0].b;
const outcome = async id => (await owner('select outcome from private.little_thing_dispatch where little_thing_id = $1', [id])).rows[0]?.outcome ?? null;
const at = (base, s) => new Date(new Date(base).getTime() + s * 1000).toISOString();
const MIN = 60, HOUR = 3600;

const U = n => `00000000-0000-0000-0000-0000000045${n}`;
const ids = Array.from({ length: 16 }, (_, i) => U(String(i + 10)));
const [A1, B1, A2, B2, A3, B3, A4, B4, A5, B5, A6, B6, A7, B7, A8, B8] = ids;
await db.exec(`insert into auth.users (id, raw_user_meta_data) values ${ids.map((u, i) =>
  `('${u}', '{"name":"${i % 2 ? 'Sam' : 'Maya Rose'}"}')`).join(', ')};
  insert into questions (body, sort_order) values ('LTP-Q1', 1);`);
const pair = async (a, b) => {
  const c = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  return c;
};
for (let i = 0; i < ids.length; i += 2) await pair(ids[i], ids[i + 1]);
await owner(`update profiles set timezone = 'UTC' where id = any($1)`, [ids]);

// ═══ Toggle column ═══
const prefs = (await as(B1, 'select little_things from notification_prefs')).rows;
ok(prefs.length === 1 && prefs[0].little_things === true, 'notification_prefs.little_things exists and defaults to on');
await as(B1, 'update notification_prefs set little_things = false where user_id = $1', [B1]);
ok((await as(B1, 'select little_things from notification_prefs')).rows[0].little_things === false, 'the owner can switch little_things off');
await as(B1, 'update notification_prefs set little_things = true where user_id = $1', [B1]);
const types = (await owner(`select unnest(enum_range(null::public.push_type))::text t`)).rows.map(r => r.t);
ok(types.includes('little_thing'), "push_type has 'little_thing'");

// ═══ C1: eligibility, grouping, hourly cap per type ═══
const T1 = '2030-03-01T12:00:00Z';
const k1 = await sendAt(A1, T1, 'kiss', 3);
const h1 = await sendAt(A1, at(T1, 3), 'hug', 2000);
ok((await claimFor(B1, at(T1, 9))).length === 0 && await due(at(T1, 9)) === false, 'nothing is claimed or due before 10 s (undo window + margin)');
ok(await due(at(T1, 13)) === true, 'little_things_due is true once a gesture is 10 s old');
let c = await claimFor(B1, at(T1, 13));
ok(c.length === 1, 'one push for both gestures (kiss batch + hug grouped)');
ok(c[0]?.gesture === 'hug' && JSON.stringify(c[0]?.counts) === JSON.stringify({ hug: 1, kiss: 3 }),
  `counts kisses per kiss, hugs per send; the lead gesture is the newest (got ${c[0]?.gesture} ${JSON.stringify(c[0]?.counts)})`);
ok(c[0]?.silent === false && c[0]?.partner_name === 'Maya Rose' && c[0]?.claim_id, 'not silent at 12:00; partner name ≤ 30 chars; claim id');
ok(await outcome(k1) === 'pushed' && await outcome(h1) === 'pushed', 'both gestures are recorded as pushed');
const log1 = (await owner(`select type::text, status, local_date::text d, couple_question_id from push_log where id = $1`, [c[0].claim_id])).rows[0];
ok(log1.type === 'little_thing' && log1.status === 'claimed' && log1.d === '2030-03-01' && log1.couple_question_id === null,
  'push_log row: type little_thing, claimed, recipient-local date, no question');
const raw = JSON.stringify((await owner(`select * from push_log where id = $1`, [c[0].claim_id])).rows);
ok(!/Maya|kiss|hug/.test(raw), 'push_log carries no name and no gesture');
ok((await claimFor(B1, at(T1, 14))).length === 0, 'a second claim returns nothing (idempotent)');
ok((await owner(`select count(*) n from push_log where user_id = $1 and type = 'little_thing'`, [B1])).rows[0].n == 1, 'one ledger row');
ok((await owner(`select undone_at from little_things where id = $1`, [k1])).rows[0].undone_at === null, 'claiming does not touch the gesture row (no realtime UPDATE)');

// Within 10 min of that push: held, then one grouped push; kiss and hug were pushed < 1 h ago → dropped.
const m1 = await sendAt(A1, at(T1, 2 * MIN), 'miss_you');
const k2 = await sendAt(A1, at(T1, 3 * MIN), 'kiss', 2);
const g1 = await sendAt(A1, at(T1, 4 * MIN), 'good_morning');
ok((await claimFor(B1, at(T1, 5 * MIN))).length === 0, 'gestures within 10 min after a push are held');
ok(await due(at(T1, 5 * MIN)) === false, 'little_things_due stays false while held (no function call every 10 s)');
ok(await outcome(m1) === null, 'held gestures are not handled yet');
ok(await due(at(T1, 10 * MIN + 13)) === true, 'due again when the 10-minute window ends');
c = await claimFor(B1, at(T1, 10 * MIN + 13));
ok(c.length === 1 && JSON.stringify(c[0].counts) === JSON.stringify({ miss_you: 1, good_morning: 1 }),
  `the held gestures go out as one push; the kiss (pushed < 1 h ago) is dropped (got ${JSON.stringify(c[0]?.counts)})`);
ok(c[0]?.gesture === 'good_morning', 'lead gesture = newest kept gesture');
ok(await outcome(k2) === 'type_cap' && await outcome(m1) === 'pushed' && await outcome(g1) === 'pushed', 'outcomes: kiss type_cap, others pushed');

// Only a capped kind → no push at all.
const k3 = await sendAt(A1, at(T1, 25 * MIN), 'kiss');
c = await claimFor(B1, at(T1, 25 * MIN + 13));
ok(c.length === 0 && await outcome(k3) === 'type_cap', 'a kiss 25 min after a kiss push: no push (1 per type per hour)');
// One hour after the first kiss push, kisses push again.
const k4 = await sendAt(A1, at(T1, HOUR + 5), 'kiss');
c = await claimFor(B1, at(T1, HOUR + 15));
ok(c.length === 1 && JSON.stringify(c[0].counts) === JSON.stringify({ kiss: 1 }) && await outcome(k4) === 'pushed',
  'a kiss more than 1 h after the last kiss push is pushed');
// The sender's own gestures never push to the sender.
ok((await claimFor(A1, at(T1, HOUR + 16))).length === 0, 'the sender gets no push for their own gesture');

// ═══ C2: the D24 four-a-day cap is shared both ways ═══
const T2 = '2030-03-04T12:00:00Z';
const claimPush = (uid, type, now) => owner(`select (cp).claim_id from (select private.claim_push($1, $2::public.push_type, $3, null, $4::date, $5) cp) s`,
  [uid, type, randomUUID(), now.slice(0, 10), now]).then(r => r.rows[0].claim_id);
ok(await claimPush(B2, 'nudge', at(T2, -3 * HOUR)) && await claimPush(B2, 'partner_answered', at(T2, -2 * HOUR)) && await claimPush(B2, 'partner_joined', at(T2, -HOUR)),
  'three pushes of other types today');
await sendAt(A2, T2, 'hug', 500);
c = await claimFor(B2, at(T2, 12));
ok(c.length === 1, 'the 4th push of the day can be a little-things push');
ok(await claimPush(B2, 'both_answered', at(T2, 60)) === null, 'after it, other types are blocked by the 4/day cap (little things count)');
const h2 = await sendAt(A2, at(T2, 11 * MIN), 'miss_you');
c = await claimFor(B2, at(T2, 11 * MIN + 12));
ok(c.length === 0 && await outcome(h2) === 'daily_cap', 'a 5th push (little things) is dropped: daily_cap');
const hn = await sendAt(A2, at(T2, 13 * HOUR), 'miss_you');           // 01:00 next UTC day, quiet hours
c = await claimFor(B2, at(T2, 13 * HOUR + 12));
ok(c.length === 1 && await outcome(hn) === 'pushed', 'the next recipient-local day starts a new cap');

// ═══ C3: quiet hours → silent, still counted ═══
const T3 = '2030-03-07T23:30:00Z';
await owner(`update profiles set timezone = 'Europe/Berlin' where id = $1`, [B3]);   // 00:30 local
await sendAt(A3, T3, 'goodnight');
c = await claimFor(B3, at(T3, 12));
ok(c.length === 1 && c[0].silent === true, 'inside the recipient\'s quiet hours (Berlin 00:30) the push is claimed silent');
ok((await owner(`select local_date::text d from push_log where id = $1`, [c[0].claim_id])).rows[0].d === '2030-03-08', 'silent pushes count on the recipient-local day');
await owner(`update notification_prefs set quiet_start = '01:00', quiet_end = '02:00' where user_id = $1`, [B3]);
await sendAt(A3, at(T3, 12 * MIN), 'hug', 100);   // 00:42 Berlin
c = await claimFor(B3, at(T3, 12 * MIN + 12));
ok(c.length === 1 && c[0].silent === false, 'custom quiet hours are honoured (00:42 outside 01:00–02:00 → sound)');

// ═══ C4: toggle off ═══
const T4 = '2030-03-10T12:00:00Z';
await as(B4, 'update notification_prefs set little_things = false where user_id = $1', [B4]);
const t4 = await sendAt(A4, T4, 'kiss', 5);
c = await claimFor(B4, at(T4, 12));
ok(c.length === 0 && await outcome(t4) === 'preference', 'toggle off → no push (dropped, not queued)');
ok((await owner(`select count(*) n from push_log where user_id = $1`, [B4])).rows[0].n == 0, 'toggle off writes no push_log row');
await as(B4, 'update notification_prefs set little_things = true where user_id = $1', [B4]);
await sendAt(A4, at(T4, 60), 'hug', 100);
c = await claimFor(B4, at(T4, 72));
ok(c.length === 1 && JSON.stringify(c[0].counts) === JSON.stringify({ hug: 1 }), 'back on: only the new gesture pushes');
await owner(`update notification_prefs set replies = false, partner_answered = false, nudges = false where user_id = $1`, [B4]);
await sendAt(A4, at(T4, 2 * HOUR), 'miss_you');
ok((await claimFor(B4, at(T4, 2 * HOUR + 12))).length === 1, 'other toggles do not affect little things');

// ═══ C5: undo → no push ═══
const T5 = '2030-03-13T12:00:00Z';
const u5 = await sendAt(A5, T5, 'kiss', 2);
await undoAt(A5, at(T5, 3), u5);
ok(await due(at(T5, 12)) === false, 'an undone gesture is never due');
c = await claimFor(B5, at(T5, 12));
ok(c.length === 0 && await outcome(u5) === null, 'undo within 5 s → no push and no dispatch row');
const v5 = await sendAt(A5, at(T5, 20), 'kiss', 1);
const w5 = await sendAt(A5, at(T5, 21), 'hug', 300);
await undoAt(A5, at(T5, 24), w5);
c = await claimFor(B5, at(T5, 40));
ok(c.length === 1 && JSON.stringify(c[0].counts) === JSON.stringify({ kiss: 1 }) && c[0].gesture === 'kiss',
  'a batch skips the undone gesture (kiss pushed, undone hug not mentioned)');
ok(await outcome(w5) === null && await outcome(v5) === 'pushed', 'outcomes: undone none, kiss pushed');

// ═══ C6: the undo/claim race (SEC-09d Info 1) ═══
// An undo whose transaction started inside the 5 s window but reaches the row after the claim
// committed (pinned p_now 4 s, run after the claim) is refused; nothing is left undone-but-pushed.
const T6 = '2030-03-16T12:00:00Z';
const r6 = await sendAt(A6, T6, 'hug', 1000);
c = await claimFor(B6, at(T6, 10));
ok(c.length === 1 && await outcome(r6) === 'pushed', 'claimed exactly at 10 s');
const e6 = await undoErr(A6, at(T6, 4), r6);
ok(is(e6, 'UNDO_EXPIRED'), `an undo arriving after the claim → UNDO_EXPIRED even inside 5 s (got ${e6?.message})`);
ok((await owner(`select undone_at from little_things where id = $1`, [r6])).rows[0].undone_at === null, 'the pushed gesture stays not undone');
// Reverse order: the undo commits first (4.9 s, after the claim's 10 s instant in wall time), the claim skips it.
const s6 = await sendAt(A6, at(T6, HOUR + 2 * HOUR), 'kiss', 1);
await undoAt(A6, at(T6, 3 * HOUR + 4.9), s6);
c = await claimFor(B6, at(T6, 3 * HOUR + 10));
ok(c.length === 0 && await outcome(s6) === null, 'an undo that commits before the claim → no push');
const fns = (await owner(`select pg_get_functiondef('private.claim_little_thing_pushes_at(timestamptz)'::regprocedure) d`)).rows[0].d;
ok(/for update of l/i.test(fns), 'the claim locks gesture rows FOR UPDATE (waits for an in-flight undo, re-checks undone_at)');
const undoDef = (await owner(`select pg_get_functiondef('private.undo_little_thing_core(uuid, uuid, timestamptz)'::regprocedure) d`)).rows[0].d;
ok(/for update/i.test(undoDef) && /little_thing_dispatch/.test(undoDef), 'undo locks the row and refuses once a dispatch row exists');

// ═══ C7: stale and ended couple ═══
const T7 = '2030-03-19T12:00:00Z';
const s7 = await sendAt(A7, T7, 'miss_you');
c = await claimFor(B7, at(T7, 31 * MIN));
ok(c.length === 0 && await outcome(s7) === 'stale', 'a gesture never handled within 30 min is dropped (stale)');
const e7 = await sendAt(A7, at(T7, HOUR), 'hug', 100);
await as(A7, 'select unpair()');
c = await claim(at(T7, HOUR + 12));
ok(!c.some(r => r.user_id === B7 || r.user_id === A7) && await outcome(e7) === 'no_recipient', 'ended couple → no push (no_recipient)');

// ═══ Access ═══
ok(perm(await errOf('authenticated', B1, 'select * from claim_little_thing_pushes()')), 'authenticated cannot claim pushes');
ok(perm(await errOf('anon', null, 'select * from claim_little_thing_pushes()')), 'anon cannot claim pushes');
ok(perm(await errOf('authenticated', B1, 'select * from private.little_thing_dispatch')), 'the dispatch ledger is private');
ok(perm(await errOf('authenticated', B1, 'select private.claim_little_thing_pushes_at(now())')), 'the clock-pinned claim is not callable by users');
ok(perm(await errOf('authenticated', B1, 'select private.dispatch_little_things()')), 'the dispatcher is not callable by users');
const svc = await errOf('service_role', null, 'select * from claim_little_thing_pushes()');
ok(svc === null, `service_role can call claim_little_thing_pushes() on the database clock (got ${svc?.message})`);
const argc = (await owner(`select pronargs n from pg_proc where proname = 'claim_little_thing_pushes' and pronamespace = 'public'::regnamespace`)).rows;
ok(argc.length === 1 && argc[0].n === 0, 'the public claim takes no clock argument');
ok(await errOf('postgres', null, 'select private.dispatch_little_things()') === null, 'the dispatcher is a no-op without Vault/pg_net');

// ═══ Deletion ═══
const n8 = await sendAt(A8, '2030-03-22T12:00:00Z', 'hug', 100);
await claim('2030-03-22T12:00:12Z');
ok(await outcome(n8) === 'pushed', 'C8 pushed');
await owner('delete from auth.users where id = $1', [B8]);
ok((await owner('select count(*) n from private.little_thing_dispatch where recipient_id = $1', [B8])).rows[0].n == 0, 'deleting the recipient removes their dispatch rows');
await owner('delete from auth.users where id = $1', [A8]);
ok(await outcome(n8) === null, 'deleting the sender removes the gesture and its dispatch row');

console.log(`\n${passed} passed, ${failed} failed`);
