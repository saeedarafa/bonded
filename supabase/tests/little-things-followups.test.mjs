// BE-45b (SEC-09e follow-ups on #202) and issue #206 (QA-28):
//   * #206: push_log.record_id of a little-things push is the newest gesture of the push (CONTRACTS §4)
//     whatever the heap order of the rows (array_agg is now ordered by created_at, id).
//   * private.purge_cron_history(p_now): deletes cron.job_run_details older than 3 days (all jobs);
//     0 without pg_cron; owner/cron only. PGlite has no pg_cron, so a stand-in `cron.job_run_details`
//     with the real columns is created here; the daily schedule is checked on the real stack.
//   * undo's locked re-read finding nothing raises INVALID_LITTLE_THING: needs two sessions, verified on
//     the real stack (see docs/plan/status/backend.md); here only that undo of a deleted gesture still
//     gives INVALID_LITTLE_THING.
// Usage: node supabase/tests/little-things-followups.test.mjs
import { createDb } from './pglite-supabase.mjs';

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
const perm = e => /permission denied/.test(e?.message ?? '');
const withSub = async (uid, fn) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return await fn(); } finally { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); }
};
const sendAt = (uid, now, kind, amount = 1) => withSub(uid, async () =>
  (await db.query('select (r).id from (select private.send_little_thing_at($1, $2, null, $3) r) s', [kind, amount, now])).rows[0].id);
const undoErr = async (uid, now, id) => {
  try { await withSub(uid, () => db.query('select * from private.undo_little_thing_at($1, $2)', [id, now])); return null; } catch (e) { return e; }
};
const claim = async now => (await owner('select * from private.claim_little_thing_pushes_at($1)', [now])).rows;
// A plain heap scan (as on a larger table): the planner may otherwise walk the primary key index, which
// orders by uuid and hides the bug either way.
const heapClaim = async now => {
  await db.exec('set enable_indexscan = off; set enable_bitmapscan = off; set enable_indexonlyscan = off');
  try { return await claim(now); } finally { await db.exec('reset enable_indexscan; reset enable_bitmapscan; reset enable_indexonlyscan'); }
};
const at = (base, s) => new Date(new Date(base).getTime() + s * 1000).toISOString();
const recordIdOf = async claimId => (await owner('select record_id from push_log where id = $1', [claimId])).rows[0]?.record_id;

const U = n => `00000000-0000-0000-0000-0000000045b${n}`;
const ids = [U(1), U(2), U(3), U(4)];
const [A1, B1, A2, B2] = ids;
await db.exec(`insert into auth.users (id, raw_user_meta_data) values ${ids.map(u => `('${u}', '{"name":"Eve"}')`).join(', ')};
  insert into questions (body, sort_order) values ('LTF-Q1', 1);`);
const pair = async (a, b) => {
  const c = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  return c;
};
await pair(A1, B1);
await pair(A2, B2);
await owner(`update profiles set timezone = 'UTC' where id = any($1)`, [ids]);

// ═══ #206: record_id = the newest gesture, whatever the heap order ═══
{
  const T = '2026-12-02T10:00:00Z';
  const kiss = await sendAt(A1, T, 'kiss');
  const hug = await sendAt(A1, at(T, 1), 'hug', 800);
  // No data change, but the kiss row moves to a later heap position (as free-space reuse does).
  await owner('update little_things set amount = amount where id = $1', [kiss]);
  const order = (await owner('select id from little_things where id = any($1) order by ctid', [[kiss, hug]])).rows.map(r => r.id);
  ok(order[order.length - 1] === kiss, 'precondition: the older kiss now comes last in a plain scan');
  const rows = (await heapClaim(at(T, 20))).filter(r => r.user_id === B1);
  ok(rows.length === 1 && rows[0].gesture === 'hug', 'one push; the lead gesture is the newest (hug)');
  ok(await recordIdOf(rows[0].claim_id) === hug, '#206: push_log.record_id is the newest gesture (hug), not the last in heap order');
  const d = (await owner('select little_thing_id, outcome from private.little_thing_dispatch where push_id = $1 order by little_thing_id', [rows[0].claim_id])).rows;
  ok(d.length === 2 && d.every(r => r.outcome === 'pushed'), 'both gestures are in the push (ledger unchanged)');
}
{
  // Same with a type-capped kind in the middle: kept ids stay in send order.
  const T = '2026-12-03T10:00:00Z';
  const k1 = await sendAt(A2, T, 'kiss');
  const c1 = (await claim(at(T, 20))).filter(r => r.user_id === B2);
  ok(c1.length === 1 && await recordIdOf(c1[0].claim_id) === k1, 'a single-gesture push records that gesture');
  // 15 min later: a kiss (capped: kiss pushed within the hour), then a miss-you, then a hug.
  const T2 = at(T, 15 * 60);
  const k2 = await sendAt(A2, T2, 'kiss');
  const m = await sendAt(A2, at(T2, 1), 'miss_you');
  const h = await sendAt(A2, at(T2, 2), 'hug', 500);
  await owner('update little_things set amount = amount where id = $1', [m]);   // heap order now k2, h, m
  const c2 = (await heapClaim(at(T2, 20))).filter(r => r.user_id === B2);
  ok(c2.length === 1 && c2[0].gesture === 'hug' && JSON.stringify(c2[0].counts) === '{"hug":1,"miss_you":1}', 'the capped kiss is dropped; hug + miss-you go out, hug leads');
  ok(await recordIdOf(c2[0].claim_id) === h, '#206: record_id is the newest kept gesture (hug) with a capped kind in the batch');
  ok((await owner('select outcome from private.little_thing_dispatch where little_thing_id = $1', [k2])).rows[0]?.outcome === 'type_cap', 'the kiss is recorded as type_cap');
}

// ═══ Undo of a gesture deleted meanwhile: INVALID_LITTLE_THING ═══
{
  const T = '2026-12-04T10:00:00Z';
  const g = await sendAt(A1, T, 'miss_you');
  await owner('delete from little_things where id = $1', [g]);
  const e = await undoErr(A1, at(T, 2), g);
  ok(e?.message === 'INVALID_LITTLE_THING' && e.code === 'P0001', 'undo of a deleted gesture raises INVALID_LITTLE_THING');
}

// ═══ purge_cron_history ═══
const NOW = '2026-12-10T04:29:00Z';
const purge = async now => (await owner('select private.purge_cron_history($1) n', [now])).rows[0].n;
ok(await purge(NOW) === 0, 'without pg_cron (no cron.job_run_details) the purge is a no-op returning 0');
ok((await owner(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'private' and p.proname = 'purge_cron_history' and not p.prosecdef`)).rows[0].n === 1, 'purge_cron_history is not SECURITY DEFINER (runs as the cron job owner)');
for (const [role, uid] of [['authenticated', B1], ['anon', null], ['service_role', null]]) {
  ok(perm(await errOf(role, uid, 'select private.purge_cron_history()')), `${role} cannot call purge_cron_history`);
}

// Stand-in for pg_cron's table (same columns as pg_cron 1.6).
await db.exec(`create schema if not exists cron;
  create table cron.job_run_details (jobid bigint, runid bigserial primary key, job_pid integer, database text, username text,
    command text, status text, return_message text, start_time timestamptz, end_time timestamptz);`);
const rows = [
  // [label, start, end]
  ['old-4d', at(NOW, -4 * 86400 - 10), at(NOW, -4 * 86400)],
  ['edge-just-over-3d', at(NOW, -3 * 86400 - 2), at(NOW, -3 * 86400 - 1)],
  ['edge-exactly-3d', at(NOW, -3 * 86400 - 1), at(NOW, -3 * 86400)],
  ['recent-2d', at(NOW, -2 * 86400), at(NOW, -2 * 86400 + 1)],
  ['running-old', at(NOW, -5 * 86400), null],
  ['never-started', null, null],
  ['today', at(NOW, -60), at(NOW, -59)],
];
for (const [label, s, e] of rows) {
  await owner(`insert into cron.job_run_details (jobid, command, status, return_message, start_time, end_time) values (1, 'select 1', $1, $2, $3, $4)`, ['succeeded', label, s, e]);
}
const left = async () => (await owner('select return_message l from cron.job_run_details order by runid')).rows.map(r => r.l);
const n = await purge(NOW);
ok(n === 3, `deletes the 3 rows older than 3 days (got ${n})`);
ok(JSON.stringify(await left()) === JSON.stringify(['edge-exactly-3d', 'recent-2d', 'never-started', 'today']),
  'keeps exactly 3 days (boundary kept), recent runs and rows that never started; an old run without end_time goes by start_time');
ok(await purge(NOW) === 0, 'a second run deletes nothing (idempotent)');
ok(await purge(null) === 0 && (await left()).length === 4, 'a null clock deletes nothing');
// ~8,640 rows a day from the 10-second job: a week of history shrinks to 3 days.
await owner(`insert into cron.job_run_details (jobid, command, status, start_time, end_time)
  select 2, 'select private.dispatch_little_things()', 'succeeded', t, t + interval '50 ms'
    from generate_series($1::timestamptz - interval '7 days', $1::timestamptz - interval '1 second', interval '10 seconds') t`, [NOW]);
const before = (await owner('select count(*)::int n from cron.job_run_details where jobid = 2')).rows[0].n;
const removed = await purge(NOW);
const after = (await owner('select count(*)::int n from cron.job_run_details where jobid = 2')).rows[0].n;
ok(before === 7 * 8640 && removed === 4 * 8640 && after === 3 * 8640, `a week of 10-second runs (${before}) keeps 3 days (${after}, removed ${removed})`);

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
