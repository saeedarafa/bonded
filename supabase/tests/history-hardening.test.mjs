// BE-55b: SEC-12 (#216) and SEC-13 (#223) follow-ups on the History lock (D55) and the answer-day
// window (D56), plus history_days(p_answered_only).
//   1. A couples.timezone switch (+14 → −12) cannot reopen a locked day: the open window is anchored
//      at greatest(couple-local today, newest daily assigned_for) (pinned clock + live RLS).
//   2. Second layer: the INSERT/UPDATE with-checks of answers, thread_messages, reactions refuse a
//      locked day even with the *_history_lock triggers disabled (a simulated guard regression).
//   3. SEC-13 Info 3 (documented here; get_daily_question part fixed in BE-55c): a future-dated newest daily row (pulled early by an eastward zone
//      change) stays answerable; a row for the local today below it answers DAY_ENDED.
//   4. history_days(p_answered_only) and the unchanged four-argument call.
// Usage: node supabase/tests/history-hardening.test.mjs
import { createDb } from './pglite-supabase.mjs';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e; } };
const owner = async (sql, params) => { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); return db.query(sql, params); };
const rls = e => /row-level security/.test(e?.message ?? '');
const is = (e, code) => e?.message === code && e?.code === 'P0001';

const U = n => `00000000-0000-0000-0000-00000055b0${n}`;
const [F1, F2, T1, T2, W1, W2, K1, K2, H1, H2, O1, O2, S1, S2] = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14'].map(U);
await db.exec(`insert into auth.users (id) values ${[F1, F2, T1, T2, W1, W2, K1, K2, H1, H2, O1, O2, S1, S2].map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) select 'HH-Q' || g, g from generate_series(1, 60) g;`);

const pair = async (a, b, tz) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  await owner(`update couples set timezone = $2, paired_at = now() - interval '20 days' where id = $1`, [couple, tz]);
  return couple;
};
const setPremium = uid => owner(`insert into entitlements (user_id, is_active, expires_at) values ($1, true, '2999-01-01T00:00:00Z')
  on conflict (user_id) do update set is_active = true, expires_at = excluded.expires_at`, [uid]);
const dropPremium = uid => owner('delete from entitlements where user_id = $1', [uid]);
let qn = 0;
// A daily row for an explicit date, or a pack row created at an explicit instant.
const daily = async (couple, date, createdAt = null) => (await owner(`insert into couple_questions (couple_id, question_id, source, assigned_for, created_at)
  select $1, id, 'daily', $2::date, coalesce($3::timestamptz, now()) from questions where body = $4 returning id`, [couple, date, createdAt, `HH-Q${++qn}`])).rows[0].id;
const pack = async (couple, createdAt) => (await owner(`insert into couple_questions (couple_id, question_id, source, created_at)
  select $1, id, 'pack', $2::timestamptz from questions where body = $3 returning id`, [couple, createdAt, `HH-Q${++qn}`])).rows[0].id;
const localDate = async (tz, offset = 0) => (await owner(`select ((now() at time zone $1)::date + $2::int)::text d`, [tz, offset])).rows[0].d;
const answer = (cq, uid, body) => owner(`insert into answers (couple_question_id, user_id, body) values ($1, $2, $3) returning id`, [cq, uid, body]).then(r => r.rows[0].id);
const message = (cq, uid, body) => owner(`insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, $3) returning id`, [cq, uid, body]).then(r => r.rows[0].id);
const react = (uid, answerId) => owner(`insert into reactions (user_id, answer_id, kind) values ($1, $2, '❤️') returning id`, [uid, answerId]).then(r => r.rows[0].id);
const openAt = async (uid, cq, at) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);
  return (await db.query('select private.cq_content_open_at($1, $2) o', [cq, at])).rows[0].o;
};
const dayOpenAt = async (cq, at) => (await owner('select private.answer_day_open_at($1, $2) o', [cq, at])).rows[0].o;

// ═══ 1a. Timezone switch, pinned clock (SEC-12 Low) ═══
{
  const c = await pair(T1, T2, 'Pacific/Kiritimati');
  const jan7 = await daily(c, '2027-01-07'), jan8 = await daily(c, '2027-01-08'), jan9 = await daily(c, '2027-01-09'), jan10 = await daily(c, '2027-01-10');
  // 2027-01-10 12:00 in +14 = 2027-01-09 22:00Z.
  const noon = '2027-01-10T12:00:00+14:00';
  ok(await openAt(T1, jan9, noon) && await openAt(T1, jan10, noon) && !(await openAt(T1, jan8, noon)), 'pinned +14: today and yesterday open, day −2 locked');
  await as(T1, `update couples set timezone = 'Etc/GMT+12' where id = $1`, [c]);  // a member's own write (column grant)
  ok((await owner('select timezone from couples where id = $1', [c])).rows[0].timezone === 'Etc/GMT+12', 'a member switched the couple to −12');
  // Same instant in −12: 2027-01-09 10:00 local. The unanchored rule would call Jan 8 "yesterday".
  ok(!(await openAt(T1, jan8, noon)), 'pinned −12 (same instant, local Jan 9): day −2 (Jan 8) stays locked');
  ok(await openAt(T1, jan9, noon) && await openAt(T1, jan10, noon), 'pinned −12: Jan 9 and Jan 10 stay open');
  // 2027-01-10 01:00 in +14 = 2027-01-08 23:00 in −12 (two local dates back): the unanchored rule opened day −3.
  ok(!(await openAt(T1, jan7, '2027-01-10T01:00:00+14:00')) && !(await openAt(T1, jan8, '2027-01-10T01:00:00+14:00')), 'pinned −12, local Jan 8 23:00: day −3 (Jan 7) and day −2 stay locked');
  // Real time moves on in −12: the anchor is max(local today, Jan 10).
  ok(await openAt(T1, jan9, '2027-01-10T23:00:00-12:00') && !(await openAt(T1, jan8, '2027-01-10T23:00:00-12:00')), 'pinned −12, local Jan 10: Jan 9 open, Jan 8 locked');
  ok(!(await openAt(T1, jan9, '2027-01-11T10:00:00-12:00')) && await openAt(T1, jan10, '2027-01-11T10:00:00-12:00'), 'pinned −12, local Jan 11: Jan 9 locked, Jan 10 open (normal rule again)');
  // A pack question started on Jan 8 (+14) is also not reopened.
  const p = await pack(c, '2027-01-08T12:00:00+14:00');
  ok(!(await openAt(T1, p, noon)), 'pinned −12: a pack question of day −2 stays locked');
  await db.exec(`select set_config('request.jwt.claim.sub', '${T1}', false)`);
  const h = Object.fromEntries((await db.query(`select couple_question_id id, locked from private.history_days_at(null, 100, 0, null, $1)`, [noon])).rows.map(r => [r.id, r.locked]));
  ok(h[jan7] && h[jan8] && h[p] && !h[jan9] && !h[jan10], 'pinned −12: history_days_at locked flags follow the anchor');
  await setPremium(T2);
  ok(await openAt(T1, jan7, noon), 'Premium: everything open regardless of the anchor');
  await dropPremium(T2);
  // No daily row at all: the anchor is the plain local today.
  const solo = await pair(K1, K2, 'Etc/GMT+12');
  const kp = await pack(solo, '2027-01-08T10:00:00-12:00');
  ok(await openAt(K1, kp, '2027-01-09T10:00:00-12:00') && !(await openAt(K1, kp, '2027-01-10T10:00:00-12:00')), 'no daily row: the window uses the local today (pack day −1 open, −2 locked)');
}

// ═══ 1b. Timezone switch, live RLS (now()) ═══
const TZF = 'Pacific/Kiritimati';
const free = await pair(F1, F2, TZF);
const fq = {};
for (const k of [0, 1, 2, 3]) fq[`d${k}`] = await daily(free, await localDate(TZF, -k), new Date(Date.now() - k * 86400e3).toISOString());
fq.packOld = await pack(free, new Date(Date.now() - 3 * 86400e3).toISOString());
const fa = {};
for (const [l, cq] of Object.entries(fq)) fa[l] = { f1: await answer(cq, F1, `F1-${l}`), f2: await answer(cq, F2, `F2-${l}`) };
const fm = { d1: await message(fq.d1, F2, 'M-d1'), d2: await message(fq.d2, F2, 'M-d2') };
const fr = { d1: await react(F2, fa.d1.f1) };
const readable = async (uid, cq) => (await as(uid, 'select id from answers where couple_question_id = $1', [cq])).rows.length;
ok(await readable(F1, fq.d2) === 0 && await readable(F1, fq.d1) === 2, 'free +14: day −2 locked, yesterday readable');
await as(F1, `update couples set timezone = 'Etc/GMT+12' where id = $1`, [free]);
{
  const minus12Yesterday = await localDate('Etc/GMT+12', -1);
  ok(minus12Yesterday <= await localDate(TZF, -2), `the unanchored rule would have opened day −2 (−12 yesterday ${minus12Yesterday})`);
}
for (const [who, uid] of [['F1', F1], ['F2', F2]]) {
  ok(await readable(uid, fq.d2) === 0 && await readable(uid, fq.d3) === 0, `free ${who} after the switch to −12: day −2 and −3 answers stay locked`);
  ok((await as(uid, 'select id from thread_messages where id = $1', [fm.d2])).rows.length === 0, `free ${who} after the switch: day −2 thread stays locked`);
  ok(await readable(uid, fq.d1) === 2 && await readable(uid, fq.d0) === 2, `free ${who} after the switch: today and yesterday still readable`);
  const locked = Object.fromEntries((await as(uid, 'select couple_question_id id, locked from history_days()')).rows.map(r => [r.id, r.locked]));
  ok(locked[fq.d2] && locked[fq.d3] && locked[fq.packOld] && !locked[fq.d1] && !locked[fq.d0], `free ${who} after the switch: history_days locked flags unchanged`);
}

// ═══ 2. Second layer: with-checks refuse a locked day when the guard triggers are off ═══
{
  // Sanity with the guards on: the codes stay as documented.
  ok(is(await errOf('authenticated', F1, `insert into reactions (user_id, answer_id, kind) values ($1, $2, '🔥')`, [F1, fa.d2.f2]), 'PREMIUM_REQUIRED'), 'guard on: reacting to a day −2 answer → PREMIUM_REQUIRED');
  const retarget = `update reactions set answer_id = $2 where id = $1 returning id`;
  ok(is(await errOf('authenticated', F2, retarget, [fr.d1, fa.d2.f1]), 'PREMIUM_REQUIRED'), 'guard on: moving a reaction onto a day −2 answer → PREMIUM_REQUIRED');
  ok(is(await errOf('authenticated', F1, `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, 'x')`, [fq.d2, F1]), 'PREMIUM_REQUIRED'), 'guard on: a message on day −2 → PREMIUM_REQUIRED');

  await db.exec(`alter table answers disable trigger answers_history_lock;
    alter table thread_messages disable trigger thread_messages_history_lock;
    alter table reactions disable trigger reactions_history_lock`);
  try {
    // A pack question has no day window, so only the history layer stands between F2 and the row.
    await owner('delete from answers where couple_question_id = $1 and user_id = $2', [fq.packOld, F2]);
    ok(rls(await errOf('authenticated', F2, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'late')`, [fq.packOld, F2])), 'guard off: an answer to a locked pack day → RLS error');
    ok(rls(await errOf('authenticated', F1, `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, 'x')`, [fq.d2, F1])), 'guard off: a message on day −2 → RLS error');
    ok(rls(await errOf('authenticated', F1, `insert into reactions (user_id, answer_id, kind) values ($1, $2, '🔥')`, [F1, fa.d2.f2])), 'guard off: a reaction on a day −2 answer → RLS error');
    ok(rls(await errOf('authenticated', F2, retarget, [fr.d1, fa.d2.f1])), 'guard off: moving a reaction onto a day −2 answer → RLS error');
    ok((await owner('select answer_id from reactions where id = $1', [fr.d1])).rows[0].answer_id === fa.d1.f1, 'guard off: the reaction stayed on yesterday');
    ok((await as(F1, `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, 'ok') returning id`, [fq.d1, F1])).rows.length === 1, 'guard off: a message on yesterday still works');
    ok((await as(F1, `insert into reactions (user_id, answer_id, kind) values ($1, $2, '🔥') returning id`, [F1, fa.d1.f2])).rows.length === 1, 'guard off: a reaction on yesterday still works');
    await setPremium(F1);
    ok((await as(F1, `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, 'prem') returning id`, [fq.d2, F1])).rows.length === 1, 'guard off, Premium: a message on day −2 passes the check');
    ok((await as(F2, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'prem') returning id`, [fq.packOld, F2])).rows.length === 1, 'guard off, Premium: an answer to an old pack question passes the check');
    await dropPremium(F1);
  } finally {
    await db.exec(`alter table answers enable trigger answers_history_lock;
      alter table thread_messages enable trigger thread_messages_history_lock;
      alter table reactions enable trigger reactions_history_lock`);
  }
  // The unchanged re-send of a locked own answer is still a silent no-op (the guard skips the row, no check runs).
  const resend = await errOf('authenticated', F2, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'prem')
    on conflict (couple_question_id, user_id) do update set body = excluded.body`, [fq.packOld, F2]);
  ok(resend === null, `guard on: an unchanged re-send of a locked pack answer still succeeds (${resend?.message})`);
  ok(is(await errOf('authenticated', F2, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'changed')
    on conflict (couple_question_id, user_id) do update set body = excluded.body`, [fq.packOld, F2]), 'PREMIUM_REQUIRED'), 'guard on: a changed locked pack answer → PREMIUM_REQUIRED');
  const pols = (await owner(`select policyname, with_check from pg_policies where schemaname = 'public' and tablename in ('answers', 'thread_messages', 'reactions') and cmd in ('INSERT', 'UPDATE')`)).rows;
  ok(pols.length === 6 && pols.every(p => /cq_content_open/.test(p.with_check ?? '')), `all ${pols.length} insert/update with-checks carry cq_content_open`);
}

// ═══ 3. SEC-13 Info 3: a future-dated newest daily row (documented behaviour) ═══
{
  const c = await pair(W1, W2, 'Europe/Berlin');
  const feb9 = await daily(c, '2027-02-09'), feb10 = await daily(c, '2027-02-10'), feb11 = await daily(c, '2027-02-11');
  // 20:00 on 10 Feb in Berlin; a flip to +14 earlier pulled 11 Feb's question.
  const eve = '2027-02-10T20:00:00+01:00';
  ok(await dayOpenAt(feb11, eve), 'Info 3: the future-dated newest row stays answerable');
  ok(!(await dayOpenAt(feb10, eve)), 'Info 3: the local today\'s row below it answers DAY_ENDED (newest-row rule)');
  ok(await openAt(W1, feb10, eve) && !(await openAt(W1, feb9, eve)), 'Info 3: the History anchor is the future row (10 Feb open, 9 Feb already locked)');
  ok(await openAt(W1, feb10, '2027-02-11T12:00:00+01:00') && !(await openAt(W1, feb9, '2027-02-11T12:00:00+01:00')), 'Info 3: the next local day nothing changes (10 Feb yesterday, 9 Feb locked)');

  // The same through the API: get_daily_question in +14, then in −12.
  const live = await pair(H1, H2, 'Pacific/Kiritimati');
  const ahead = (await as(H1, 'select (q).id id, (q).assigned_for::text d from (select get_daily_question() q) s')).rows[0];
  await as(H1, `update couples set timezone = 'Etc/GMT+12' where id = $1`, [live]);
  const behind = (await as(H1, 'select (q).id id, (q).assigned_for::text d from (select get_daily_question() q) s')).rows[0];
  // BE-55c fixed Info 3: the couple today never falls below the newest daily row (was: an older
  // −12 row that answered DAY_ENDED). More cases in tz-hardening.test.mjs.
  ok(behind.id === ahead.id, `Info 3 (BE-55c): after the switch get_daily_question keeps returning the newest row (${behind.d})`);
  ok((await owner(`select count(*)::int n from couple_questions where couple_id = $1 and source = 'daily'`, [live])).rows[0].n === 1, 'Info 3 (BE-55c): no older row is created');
  const up = (uid, cq, body) => errOf('authenticated', uid, `insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)
    on conflict (couple_question_id, user_id) do update set body = excluded.body`, [cq, uid, body]);
  ok(await up(H1, ahead.id, 'ahead') === null, 'Info 3: answering the newest (future-dated) row is accepted');
  ok((await owner('select counts_for_streak c from answers where couple_question_id = $1 and user_id = $2', [ahead.id, H1])).rows[0].c === false,
    'Info 3: an answer written before its local day does not count for the streak (D17)');
  const days = Object.fromEntries((await as(H1, 'select couple_question_id id, locked from history_days()')).rows.map(r => [r.id, r.locked]));
  ok(days[ahead.id] === false, 'Info 3: the future row is not locked');
}

// ═══ 4. history_days(p_answered_only) ═══
{
  const TZ = 'UTC';
  const hc = await pair(S1, S2, TZ);
  // Five daily days (newest first: d0 … d4) plus a pack question; answered: d1 both, d2 partner only, d4 me only.
  const q = {};
  for (const k of [4, 3, 2, 1, 0]) q[`d${k}`] = await daily(hc, await localDate(TZ, -k), new Date(Date.now() - k * 86400e3).toISOString());
  q.pack = await pack(hc, new Date(Date.now() - 1000).toISOString());
  await answer(q.d1, S1, 'a'); await answer(q.d1, S2, 'b'); await answer(q.d2, S2, 'c'); await answer(q.d4, S1, 'd');
  const ids = async (args = '') => (await as(S1, `select couple_question_id id from history_days(${args})`)).rows.map(r => r.id);
  const all = await ids();
  ok(all.length === 6 && all.includes(q.pack), `default: every day listed (${all.length})`);
  ok(JSON.stringify(await ids('p_answered_only => false')) === JSON.stringify(all), 'p_answered_only => false = the default');
  const answered = await ids('p_answered_only => true');
  ok(JSON.stringify(answered) === JSON.stringify([q.d1, q.d2, q.d4]), 'p_answered_only => true: only days with an answer (either partner), newest first');
  ok(JSON.stringify(await ids('p_limit => 2, p_answered_only => true')) === JSON.stringify([q.d1, q.d2]), 'p_answered_only: a page of 2 holds 2 answered days');
  ok(JSON.stringify(await ids('p_limit => 2, p_offset => 2, p_answered_only => true')) === JSON.stringify([q.d4]), 'p_answered_only: offset counts answered days only');
  ok((await ids(`p_couple_question_id => '${q.d3}', p_answered_only => true`)).length === 0 && (await ids(`p_couple_question_id => '${q.d2}', p_answered_only => true`)).length === 1, 'p_answered_only with one day: unanswered → empty, partner-answered → the day');
  ok(JSON.stringify(await ids('null, 30, 0, null')) === JSON.stringify(all), 'the four-argument positional call still works');
  ok(JSON.stringify(await ids('null, 30, 0, null, true')) === JSON.stringify(answered), 'five positional arguments');
  const p2 = (await as(S2, `select couple_question_id id from history_days(p_answered_only => true)`)).rows.map(r => r.id);
  ok(JSON.stringify(p2) === JSON.stringify(answered), 'the partner sees the same answered days');
  const outsider = await pair(O1, O2, 'UTC');
  ok((await as(O1, `select * from history_days(p_couple_id => '${hc}', p_answered_only => true)`)).rows.length === 0, 'other couple: empty');
  ok(outsider && (await as(O1, `select * from history_days(p_answered_only => true)`)).rows.length === 0, 'other couple: its own empty history');
  ok(/permission denied/.test((await errOf('anon', null, 'select * from history_days(p_answered_only => true)'))?.message ?? ''), 'anon cannot call history_days');
  const json = JSON.stringify((await as(S1, 'select * from history_days(p_answered_only => true)')).rows);
  ok(!/"(a|b|c|d)"/.test(json), 'history_days(p_answered_only) returns no answer text');
}

// ═══ Privileges and signatures ═══
{
  const sigs = (await owner(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' s
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('history_days', 'history_days_at') order by 1`)).rows.map(r => r.s);
  ok(sigs.length === 2, `one overload each: ${sigs.join(' | ')}`);
  ok(/permission denied/.test((await errOf('authenticated', F1, `select private.couple_history_today_at('${free}', 'UTC', now())`))?.message ?? ''), 'authenticated cannot call private.couple_history_today_at');
  ok(/permission denied/.test((await errOf('authenticated', F1, `select * from private.history_days_at(null, 30, 0, null, now(), true)`))?.message ?? ''), 'authenticated cannot call private.history_days_at');
  const def = (await owner(`select prosecdef d, proconfig c from pg_proc where proname = 'couple_history_today_at'`)).rows[0];
  ok(def.d === true && (def.c ?? []).some(x => x.startsWith('search_path=')), 'couple_history_today_at: definer with a pinned search_path');
}

console.log(`\n${passed} passed, ${failed} failed`);
