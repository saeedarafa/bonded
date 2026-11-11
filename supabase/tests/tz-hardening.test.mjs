// BE-55c: one couple "today" (SEC-13 Info 3), couples.history_floor (SEC-14 Low 1) and a fixed
// couple_questions.local_day (SEC-14 Low 2).
//   A. Pinned clock: get_daily_question, send_nudge, due_reminders (ritual + last call) and both
//      invite previews use the couple today after an east-then-west timezone switch.
//   B. The timezone-skip case (live RLS): no row for today yet, a member switches +14 → −12, day −2
//      stays locked; history_floor is server-set, monotone and stamped only when it matters.
//   C. Pinned history_floor semantics: a dateline jump and an ordinary westward trip.
//   D. A pack question keeps the day it was started on after an eastward switch.
//   E. Privileges.
// Usage: node supabase/tests/tz-hardening.test.mjs
// Without this task's migration (to show the tests fail): BE55C_WITHOUT=1 node supabase/tests/tz-hardening.test.mjs
import { createDb, defaultMigrations } from './pglite-supabase.mjs';

const files = process.env.BE55C_WITHOUT ? defaultMigrations().filter(f => !f.includes('_tz_hardening')) : defaultMigrations();
let db;
try { db = await createDb(files); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const section = async (name, fn) => { try { await fn(); } catch (e) { ok(false, `${name}: threw ${e.message}`); } };
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e; } };
const owner = async (sql, params) => { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); return db.query(sql, params); };
const asClaim = async (uid, sql, params) => { await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`); return db.query(sql, params); };
const denied = e => /permission denied/.test(e?.message ?? '');

const U = n => `00000000-0000-0000-0000-00000055c0${n}`;
const ids = Array.from({ length: 30 }, (_, i) => U(String(i + 1).padStart(2, '0')));
const [X1, X2, N1, N2, R1, R2, L1, L2, I1, IC, S1, S2, P1, P2, Q1, Q2, K1, K2, E1, E2, Z1, Z2] = ids;
await db.exec(`insert into auth.users (id) values ${ids.map(u => `('${u}')`).join(', ')};
  update profiles set display_name = 'FIXTURE Partner';
  insert into questions (body, sort_order) select 'TZ-Q' || g, 1000 + g from generate_series(1, 80) g;
  create table private.tz_test_events (type public.push_type, record_id uuid);
  create or replace function private.dispatch_notify(p_type public.push_type, p_record_id uuid, p_couple_id uuid, p_couple_question_id uuid, p_actor_user_id uuid)
  returns void language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
    insert into private.tz_test_events select $1, $2
  $$;`);

const pair = async (a, b, tz) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  if (b) {
    const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
    await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  }
  await owner(`update couples set timezone = $2, paired_at = '2026-01-01Z' where id = $1`, [couple, tz]);
  return couple;
};
let qn = 0;
const daily = async (couple, date, createdAt = null) => (await owner(`insert into couple_questions (couple_id, question_id, source, assigned_for, created_at)
  select $1, id, 'daily', $2::date, coalesce($3::timestamptz, now()) from questions where body = $4 returning id`, [couple, date, createdAt, `TZ-Q${++qn}`])).rows[0].id;
const pack = async (couple, createdAt) => (await owner(`insert into couple_questions (couple_id, question_id, source, created_at)
  select $1, id, 'pack', $2::timestamptz from questions where body = $3 returning id`, [couple, createdAt, `TZ-Q${++qn}`])).rows[0].id;
const answer = (cq, uid, body = 'FIXTURE-TZ') => owner(`insert into answers (couple_question_id, user_id, body) values ($1, $2, $3) returning id`, [cq, uid, body]);
const setTz = (couple, tz) => owner('update couples set timezone = $2 where id = $1', [couple, tz]);
const dq = async (uid, at) => (await asClaim(uid, 'select (q).id id, (q).assigned_for::text d from (select private.get_daily_question_at($1::timestamptz) q) s', [at])).rows[0];
const openAt = async (uid, cq, at) => (await asClaim(uid, 'select private.cq_content_open_at($1, $2) o', [cq, at])).rows[0].o;
const dayOpenAt = async (cq, at) => (await owner('select private.answer_day_open_at($1, $2) o', [cq, at])).rows[0].o;
const dailyCount = async couple => (await owner(`select count(*)::int n from couple_questions where couple_id = $1 and source = 'daily'`, [couple])).rows[0].n;
const nudge = async (uid, at) => { try { await asClaim(uid, 'select private.send_nudge_at($1::timestamptz)', [at]); return null; } catch (e) { return e.message; } };

// 12:00 on 10 Jan in +14 = 22:00Z on 9 Jan = 10:00 on 9 Jan in −12.
const NOON = '2027-01-10T12:00:00+14:00';

// ═══ A. The couple today in every "today" lookup (pinned clock) ═══
await section('A get_daily_question', async () => {
  const c = await pair(X1, X2, 'Pacific/Kiritimati');
  const ahead = await dq(X1, NOON);
  ok(ahead.d === '2027-01-10', `+14: get_daily_question_at assigns 10 Jan (${ahead.d})`);
  await setTz(c, 'Etc/GMT+12');
  const same = await dq(X1, NOON);
  ok(same.id === ahead.id, `after +14 → −12 (local 9 Jan) get_daily_question returns the newest row (${same.d}), not a 9 Jan row`);
  ok(await dailyCount(c) === 1, 'no row is created below the newest one');
  ok(await dayOpenAt(same.id, NOON), 'the returned row is answerable (no DAY_ENDED)');
  ok((await dq(X2, '2027-01-10T23:00:00-12:00')).id === ahead.id, 'local 10 Jan 23:00 in −12: still the 10 Jan row');
  const next = await dq(X2, '2027-01-11T10:00:00-12:00');
  ok(next.d === '2027-01-11' && await dailyCount(c) === 2, `local 11 Jan in −12: a new 11 Jan row (${next.d})`);
});

await section('A send_nudge', async () => {
  const c = await pair(N1, N2, 'Pacific/Kiritimati');
  const row = await dq(N1, NOON);
  ok(await nudge(N1, NOON) === null, '+14: N1 nudges once on 10 Jan');
  await setTz(c, 'Etc/GMT+12');
  ok(await nudge(N1, NOON) === 'NUDGE_LIMIT', 'after +14 → −12 the same instant (local 9 Jan) → NUDGE_LIMIT (no second nudge from a westward switch)');
  ok((await owner(`select local_date::text d from private.nudge_log where sender_id = $1`, [N1])).rows.map(r => r.d).join() === '2027-01-10', 'the ledger holds one 10 Jan nudge');
  await answer(row.id, N1);
  ok(await nudge(N2, NOON) === 'PARTNER_ALREADY_ANSWERED', 'N1 answered the newest row: N2 cannot nudge N1 (PARTNER_ALREADY_ANSWERED)');
  ok((await owner('select count(*)::int n from private.tz_test_events where type = $1', ['nudge'])).rows[0].n === 1, 'exactly one nudge dispatched');
});

await section('A due_reminders', async () => {
  // Ritual reminder at 10:00 user-local (−12); the couple question answered by R1 is the newest (10 Jan) row.
  const c = await pair(R1, R2, 'Pacific/Kiritimati');
  const row = await dq(R1, NOON);
  await answer(row.id, R1);
  await setTz(c, 'Etc/GMT+12');
  await owner(`update profiles set timezone = 'Etc/GMT+12' where id = any($1::uuid[]);
    `.trim(), [[R1, R2]]);
  await owner(`update notification_prefs set daily_reminder = true, ritual_time = '10:00', quiet_start = '03:00', quiet_end = '04:00', last_call = false
    where user_id = any($1::uuid[])`, [[R1, R2]]);
  const due = (await owner('select * from due_reminders($1::timestamptz)', [NOON])).rows.filter(r => [R1, R2].includes(r.user_id));
  ok(due.length === 1 && due[0].user_id === R2 && due[0].type === 'ritual_reminder', `ritual: only R2 is reminded; R1 answered today's (newest) row (${due.map(r => r.user_id === R1 ? 'R1' : 'R2').join()})`);
  ok(due[0]?.partner_answered === true, 'ritual: R2 sees partner_answered from the newest row');

  // Last call at 22:30 couple-local (−12, 9 Jan): both answered the 10 Jan row, so the day is complete.
  const l = await pair(L1, L2, 'Pacific/Kiritimati');
  const lrow = await dq(L1, NOON);
  await answer(lrow.id, L1); await answer(lrow.id, L2);
  await setTz(l, 'Etc/GMT+12');
  await owner(`update profiles set timezone = 'Etc/GMT+12' where id = any($1::uuid[])`, [[L1, L2]]);
  await owner(`update notification_prefs set daily_reminder = false, last_call = true, quiet_start = '03:00', quiet_end = '04:00' where user_id = any($1::uuid[])`, [[L1, L2]]);
  await owner(`insert into couple_streaks (couple_id, current, last_completed_on) values ($1, 3, '2027-01-08')
    on conflict (couple_id) do update set current = 3, last_completed_on = '2027-01-08'`, [l]);
  const lc = (await owner('select * from due_reminders($1::timestamptz)', ['2027-01-09T22:30:00-12:00'])).rows.filter(r => [L1, L2].includes(r.user_id));
  ok(lc.length === 0, `last call: none, the couple today's row is complete (${lc.length})`);
  // Control: with the newest row incomplete both get the last call.
  await owner('delete from answers where couple_question_id = $1 and user_id = $2', [lrow.id, L2]);
  await owner('update couple_questions set answer_count = 1 where id = $1', [lrow.id]);  // the count trigger runs on insert only
  const lc2 = (await owner('select * from due_reminders($1::timestamptz)', ['2027-01-09T22:31:00-12:00'])).rows.filter(r => [L1, L2].includes(r.user_id));
  ok(lc2.length === 2 && lc2.every(r => r.type === 'last_call'), `last call control: incomplete day → both reminded (${lc2.length})`);
});

await section('A invite previews', async () => {
  const c = (await as(I1, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  await owner(`update couples set timezone = 'Pacific/Kiritimati' where id = $1`, [c]);
  const row = await daily(c, '2027-01-10');
  await answer(row, I1);
  await setTz(c, 'Etc/GMT+12');
  const inv = (await asClaim(I1, 'select (i).* from (select private.create_invite_at($1::timestamptz) i) s', ['2027-01-09T12:00:00Z'])).rows[0];
  const link = (await owner('select private.invite_preview_for_link_at($1, $2, $3::timestamptz) j', [inv.code, inv.token, NOON])).rows[0].j;
  ok(link?.preview?.inviter_answered_today === true, 'invite_preview_for_link: the inviter answered the couple today (newest) row');
  const pv = (await asClaim(IC, 'select private.invite_preview_at($1, $2, $3::timestamptz) j', [inv.code, inv.token, NOON])).rows[0].j;
  ok(pv?.inviter_answered_today === true, 'invite_preview: the same');
  ok(!JSON.stringify([link, pv]).includes('FIXTURE-TZ'), 'no answer text in either preview');
});

// ═══ B. The timezone-skip case (live clock, RLS) ═══
await section('B timezone skip', async () => {
  const TZ = 'Pacific/Kiritimati';
  const c = await pair(S1, S2, TZ);
  const local = async (tz, off = 0) => (await owner(`select ((now() at time zone $1)::date + $2::int)::text d`, [tz, off])).rows[0].d;
  const q = {};
  // Days −3 … −1 exist; today's row was never fetched (no get_daily_question today).
  for (const k of [3, 2, 1]) q[`d${k}`] = await daily(c, await local(TZ, -k), new Date(Date.now() - k * 86400e3).toISOString());
  for (const cq of Object.values(q)) { await answer(cq, S1); await answer(cq, S2); }
  const readable = async (uid, cq) => (await as(uid, 'select id from answers where couple_question_id = $1', [cq])).rows.length;
  ok(await readable(S1, q.d2) === 0 && await readable(S1, q.d1) === 2, 'free +14: day −2 locked, day −1 readable');
  const before = await local(TZ);
  await as(S1, `update couples set timezone = 'Etc/GMT+12' where id = $1`, [c]);
  const floor = (await owner('select history_floor::text f from couples where id = $1', [c])).rows[0].f;
  ok(floor === before || floor === await local(TZ), `the switch stamped history_floor = the +14 date (${floor})`);
  for (const [who, uid] of [['S1', S1], ['S2', S2]]) {
    ok(await readable(uid, q.d2) === 0 && await readable(uid, q.d3) === 0, `${who} after +14 → −12 with no row for today: day −2 and −3 stay locked`);
    ok(await readable(uid, q.d1) === 2, `${who}: day −1 still readable`);
    const locked = Object.fromEntries((await as(uid, 'select couple_question_id id, locked from history_days()')).rows.map(r => [r.id, r.locked]));
    ok(locked[q.d2] && locked[q.d3] && !locked[q.d1], `${who}: history_days locked flags unchanged`);
  }
  const got = (await as(S1, 'select (q).id id from (select get_daily_question() q) s')).rows[0];
  ok(got.id === q.d1 || (await owner('select assigned_for::text d from couple_questions where id = $1', [got.id])).rows[0].d >= await local(TZ, -1),
    'get_daily_question after the switch never returns a row below day −1');
  ok(!(await readable(S1, q.d2)), 'still locked after get_daily_question');

  // Server-set and monotone.
  ok(denied(await errOf('authenticated', S1, `update couples set history_floor = '2000-01-01' where id = $1`, [c])), 'a member cannot write history_floor (no column grant)');
  await owner(`update couples set history_floor = '2000-01-01' where id = $1`, [c]);
  ok((await owner('select history_floor::text f from couples where id = $1', [c])).rows[0].f === floor, 'even the owner cannot lower it (trigger keeps the maximum)');
  await as(S1, `update couples set timezone = 'Pacific/Kiritimati' where id = $1`, [c]);
  ok((await owner('select history_floor::text f from couples where id = $1', [c])).rows[0].f === floor, 'switching east again leaves it unchanged');
  ok(await readable(S1, q.d2) === 0, 'and day −2 stays locked');

  // Stamped only when it matters.
  const e = await pair(E1, E2, 'Etc/GMT+12');
  await daily(e, await local('Etc/GMT+12'));
  await setTz(e, 'Pacific/Kiritimati');
  ok((await owner('select history_floor f from couples where id = $1', [e])).rows[0].f === null, 'an eastward switch stamps no floor');
  const z = await pair(Z1, Z2, 'Pacific/Kiritimati');
  await setTz(z, 'Etc/GMT+12');
  ok((await owner('select history_floor f from couples where id = $1', [z])).rows[0].f === null, 'a couple with no questions yet gets no floor (nothing to reopen)');
});

// ═══ C. history_floor semantics (pinned clock; the floor set as the server would have stamped it) ═══
await section('C floor pinned', async () => {
  // Dateline jump: in +14 it was 10 Jan; now −12, local 8 Jan 23:00; the newest row is 8 Jan.
  const c = await pair(P1, P2, 'Etc/GMT+12');
  const jan7 = await daily(c, '2027-01-07'), jan8 = await daily(c, '2027-01-08');
  await owner(`update couples set history_floor = '2027-01-10' where id = $1`, [c]);
  const at = '2027-01-08T23:00:00-12:00';
  ok(!(await openAt(P1, jan8, at)) && !(await openAt(P1, jan7, at)), 'dateline jump: 8 Jan (below floor − 1) stays locked');
  const today = await dq(P1, at);
  ok(today.d === '2027-01-09', `dateline jump: the couple today is floor − 1 = 9 Jan (${today.d})`);
  ok(await openAt(P1, today.id, at) && await dayOpenAt(today.id, at), 'dateline jump: today\'s row is readable and answerable (never paywalled)');
  ok(!(await dayOpenAt(jan8, at)), 'dateline jump: 8 Jan answers DAY_ENDED');

  // Ordinary westward trip: Berlin 12 Jan 02:00 → New York 11 Jan 20:00; the newest row is 11 Jan.
  const t = await pair(Q1, Q2, 'America/New_York');
  const jan10 = await daily(t, '2027-01-10'), jan11 = await daily(t, '2027-01-11');
  await owner(`update couples set history_floor = '2027-01-12' where id = $1`, [t]);
  const ny = '2027-01-11T20:00:00-05:00';
  const tq = await dq(Q1, ny);
  ok(tq.id === jan11 && await dailyCount(t) === 2, 'westward trip: the couple stays on the natural 11 Jan question');
  ok(await dayOpenAt(jan11, ny) && await openAt(Q1, jan11, ny), '11 Jan is answerable and readable');
  ok(!(await openAt(Q1, jan10, ny)), '10 Jan stays locked (it was day −2 in Berlin)');
  ok(await openAt(Q1, jan10, '2027-01-11T20:00:00-05:00') === false && (await asClaim(Q1, `select locked from private.history_days_at(null, 10, 0, $1, $2)`, [jan10, ny])).rows[0].locked, 'history_days_at agrees');
});

// ═══ D. Pack day fixed at creation ═══
await section('D pack day', async () => {
  const c = await pair(K1, K2, 'Etc/GMT+12');
  // Started 8 Jan 23:00 in −12 (= 10 Jan 01:00 in +14).
  const p = await pack(c, '2027-01-08T23:00:00-12:00');
  ok((await owner('select local_day::text d from couple_questions where id = $1', [p])).rows[0].d === '2027-01-08', 'pack local_day = the couple-local start date (8 Jan)');
  const at = '2027-01-10T10:00:00-12:00';
  ok(!(await openAt(K1, p, at)), '−12, local 10 Jan: the 8 Jan pack question is locked');
  await setTz(c, 'Pacific/Kiritimati');
  ok(!(await openAt(K1, p, at)), 'after an eastward switch to +14 (created_at would read 10 Jan) it stays locked');
  const h = (await asClaim(K1, `select day::text d, locked from private.history_days_at(null, 10, 0, $1, $2)`, [p, at])).rows[0];
  ok(h.d === '2027-01-08' && h.locked === true, `history_days_at: day 8 Jan, locked (${h.d}, ${h.locked})`);
  // Fixed for every writer; clients cannot write couple_questions at all.
  await owner(`update couple_questions set local_day = '2030-01-01' where id = $1`, [p]);
  ok((await owner('select local_day::text d from couple_questions where id = $1', [p])).rows[0].d === '2027-01-08', 'local_day cannot be rewritten');
  ok((await as(K1, `update couple_questions set local_day = '2030-01-01' where id = $1 returning id`, [p]).catch(() => ({ rows: [] }))).rows.length === 0, 'a member cannot update couple_questions');
  const d = await daily(c, '2027-02-01');
  ok((await owner('select local_day::text d from couple_questions where id = $1', [d])).rows[0].d === '2027-02-01', 'daily local_day = assigned_for');
  // The Premium path through start_pack_question: today in the couple zone at creation.
  await owner(`insert into entitlements (user_id, is_active, expires_at) values ($1, true, '2999-01-01Z') on conflict (user_id) do update set is_active = true`, [K1]);
  const pq = (await owner(`select pq.question_id id from pack_questions pq join question_packs p on p.id = pq.pack_id join questions q on q.id = pq.question_id where p.active and q.active limit 1`)).rows[0];
  if (pq) {
    const row = (await as(K1, 'select (s).id id, (s).local_day::text d from (select start_pack_question($1) s) x', [pq.id])).rows[0];
    const expect = (await owner(`select (created_at at time zone 'Pacific/Kiritimati')::date::text d from couple_questions where id = $1`, [row.id])).rows[0].d;
    ok(row.d === expect, `start_pack_question: local_day is the +14 date at creation (${row.d})`);
  } else ok(true, 'start_pack_question: no active pack in this database (content not loaded), skipped');
});

// ═══ E. Privileges ═══
await section('E privileges', async () => {
  for (const [sig, call] of [['couple_today_at', `select private.couple_today_at(gen_random_uuid(), 'UTC', now())`],
    ['get_daily_question_at', 'select private.get_daily_question_at(now())']]) {
    for (const role of ['anon', 'authenticated', 'service_role']) ok(denied(await errOf(role, X1, call)), `${role} cannot call private.${sig}`);
  }
  ok(denied(await errOf('anon', null, 'select get_daily_question()')), 'anon cannot call get_daily_question');
  const defs = (await owner(`select proname, prosecdef d, proconfig c from pg_proc
    where proname in ('couple_today_at', 'couple_history_today_at', 'get_daily_question_at', 'get_daily_question', 'couples_history_floor', 'couple_questions_local_day')`)).rows;
  ok(defs.length === 6 && defs.every(r => r.d && (r.c ?? []).some(x => x.startsWith('search_path='))), `six definer functions with a pinned search_path (${defs.length})`);
  ok(denied(await errOf('authenticated', X1, `update couples set history_floor = '2999-01-01'`)), 'history_floor is not client-writable');
});

console.log(`\n${passed} passed, ${failed} failed`);
