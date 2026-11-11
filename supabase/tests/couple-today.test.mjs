// BE-55d (SEC-15 #250 Info 1): get_streak, use_streak_saver and the voice-cap bucket use the shared
// couple today (private.couple_today_at, BE-55c) instead of the plain local date.
//   A. get_streak after a westward dateline jump, and in step with get_daily_question.
//   B. use_streak_saver: a zone switch cannot buy a save that was not available before it.
//   C. start_voice_upload: the 35-slot bucket never moves back (dateline jump, ordinary trip).
//   D. Normal days are unchanged (midnight rollover for the streak, the saver and the bucket).
//   E. Privileges and the live public wrappers.
// Usage: node supabase/tests/couple-today.test.mjs
// Without this task's migration (to show the tests fail): BE55D_WITHOUT=1 node supabase/tests/couple-today.test.mjs
import { createDb, defaultMigrations } from './pglite-supabase.mjs';

const files = process.env.BE55D_WITHOUT ? defaultMigrations().filter(f => !f.includes('_couple_today_streak_voice')) : defaultMigrations();
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

const U = n => `00000000-0000-0000-0000-00000055d0${n}`;
const ids = Array.from({ length: 24 }, (_, i) => U(String(i + 1).padStart(2, '0')));
const [A1, A2, F1, F2, S1, S2, T1, T2, V1, V2, W1, W2, N1, N2, M1, M2, O1, O2, L1, L2] = ids;
await db.exec(`insert into auth.users (id) values ${ids.map(u => `('${u}')`).join(', ')};
  update profiles set display_name = 'FIXTURE Partner';
  insert into questions (body, sort_order) select 'CT-Q' || g, 2000 + g from generate_series(1, 60) g;`);

const pair = async (a, b, tz) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  await owner(`update couples set timezone = $2, paired_at = '2026-01-01Z' where id = $1`, [couple, tz]);
  return couple;
};
let qn = 0;
const daily = async (couple, date) => (await owner(`insert into couple_questions (couple_id, question_id, source, assigned_for)
  select $1, id, 'daily', $2::date from questions where body = $3 returning id`, [couple, date, `CT-Q${++qn}`])).rows[0].id;
const setTz = (couple, tz) => owner('update couples set timezone = $2 where id = $1', [couple, tz]);
const cache = (couple, current, day) => owner(`insert into couple_streaks (couple_id, current, longest, last_completed_on) values ($1, $2, $2, $3)
  on conflict (couple_id) do update set current = $2, longest = $2, last_completed_on = $3`, [couple, current, day]);
const premium = uid => owner(`insert into entitlements (user_id, is_active, expires_at) values ($1, true, '2999-01-01')
  on conflict (user_id) do update set is_active = true, expires_at = excluded.expires_at`, [uid]);
const at = async (uid, fn, now) => {
  try { return (await asClaim(uid, `select to_jsonb(private.${fn}($1::timestamptz)) j`, [now])).rows[0].j; }
  catch (e) { return { error: e.message }; }
};
const streakAt = (uid, now) => at(uid, 'get_streak_at', now);
const saveAt = (uid, now) => at(uid, 'use_streak_saver_at', now);
const dq = async (uid, now) => (await asClaim(uid, 'select (q).assigned_for::text d from (select private.get_daily_question_at($1::timestamptz) q) s', [now])).rows[0].d;
const slot = async (uid, now) => {
  try { await asClaim(uid, `select private.start_voice_upload_at('m4a', $1::timestamptz)`, [now]); return null; }
  catch (e) { return e.message; }
};
const slots = async (uid, now, n) => { for (let i = 0; i < n; i++) { const e = await slot(uid, now); if (e) return e; } return null; };
const buckets = async couple => (await owner(`select local_date::text d, count(*)::int n from private.voice_uploads where couple_id = $1 group by 1 order by 1`, [couple])).rows.map(r => `${r.d}:${r.n}`).join(',');
const savers = async couple => (await owner(`select used_month::text m, saved_day::text d from private.streak_savers where couple_id = $1 order by 1`, [couple])).rows.map(r => `${r.m}/${r.d}`).join(',');

// 12:00 on 10 Jan in +14 = 22:00Z on 9 Jan = 10:00 on 9 Jan in −12.
const NOON = '2027-01-10T12:00:00+14:00';

// ═══ A. get_streak ═══
await section('A dateline jump', async () => {
  const c = await pair(A1, A2, 'Pacific/Kiritimati');
  ok(await dq(A1, NOON) === '2027-01-10', '+14: today is 10 Jan');
  await cache(c, 3, '2027-01-10');   // both answered the 10 Jan row
  const before = await streakAt(A1, NOON);
  ok(before.current === 3 && before.completed_today === true && before.at_risk === false, '+14: streak 3, completed today, not at risk');
  await setTz(c, 'Etc/GMT+12');   // local 9 Jan at the same instant
  const after = await streakAt(A1, NOON);
  ok(after.completed_today === true, `after +14 → −12 (local 9 Jan): completed_today stays true (${after.completed_today})`);
  ok(after.at_risk === false, `... and not at risk (${after.at_risk})`);
  ok(after.current === 3 && after.longest === 3, '... current and longest unchanged');
  ok((await streakAt(A2, NOON)).completed_today === true, 'the partner sees the same');
  ok(await dq(A2, NOON) === '2027-01-10', 'get_daily_question still returns the 10 Jan row (same couple today)');
  // The local date catches up: 11 Jan in −12 is a new day, not completed yet.
  const next = await streakAt(A1, '2027-01-11T09:00:00-12:00');
  ok(next.completed_today === false && next.at_risk === true && next.current === 3, '11 Jan in −12: a new day, at risk (streak 3 unsecured)');
});

await section('A floor only (no row for today)', async () => {
  // A dateline jump left history_floor at 11 Jan; local today is 9 Jan; the couple today is 10 Jan.
  const c = await pair(F1, F2, 'Etc/GMT+12');
  await daily(c, '2027-01-08');
  await owner(`update couples set history_floor = '2027-01-11' where id = $1`, [c]);
  await cache(c, 4, '2027-01-09');
  const s = await streakAt(F1, NOON);
  ok(s.completed_today === false && s.at_risk === true && s.current === 4,
    `couple today 10 Jan: 9 Jan is "yesterday", today unsecured (completed_today ${s.completed_today}, at_risk ${s.at_risk})`);
  ok(await dq(F1, NOON) === '2027-01-10', '... the same day get_daily_question assigns');
  ok((await streakAt(F1, NOON)).completed_today === false, 'after the 10 Jan row exists: unchanged');
});

// ═══ B. use_streak_saver ═══
await section('B no extra save from a switch', async () => {
  // +14, 1 Feb: last completed 29 Jan, so 30 and 31 Jan are both missed (no save possible).
  const c = await pair(S1, S2, 'Pacific/Kiritimati');
  await premium(S1);
  const T = '2027-02-01T12:00:00+14:00';   // = 31 Jan 10:00 in −12
  ok(await dq(S1, T) === '2027-02-01', '+14: today is 1 Feb');
  await cache(c, 5, '2027-01-29');
  const before = await streakAt(S1, T);
  ok(before.current === 0 && before.saver_available === false && before.saver_reason === 'too_many_missed', '+14: two missed days, no saver (too_many_missed)');
  ok((await saveAt(S1, T)).error === 'SAVER_UNAVAILABLE', '+14: use_streak_saver → SAVER_UNAVAILABLE');
  await setTz(c, 'Etc/GMT+12');   // local 31 Jan (January) at the same instant
  const after = await streakAt(S1, T);
  ok(after.saver_available === false && after.current === 0 && after.saver_reason === 'too_many_missed',
    `after +14 → −12 (local 31 Jan): still no saver, current 0 (available ${after.saver_available}, current ${after.current})`);
  ok((await saveAt(S2, T)).error === 'SAVER_UNAVAILABLE', 'after the switch: use_streak_saver → SAVER_UNAVAILABLE (no January save bought by the switch)');
  ok(await savers(c) === '', 'no saver ledger row');
});

await section('B save books the couple-today month', async () => {
  // +14, 1 Feb: last completed 30 Jan, 31 Jan missed; the couple switches to −12 (local 31 Jan) first.
  const c = await pair(T1, T2, 'Pacific/Kiritimati');
  await premium(T2);
  const T = '2027-02-01T12:00:00+14:00';
  await dq(T1, T);
  await cache(c, 5, '2027-01-30');
  await setTz(c, 'Etc/GMT+12');
  const g = await streakAt(T1, T);
  ok(g.saver_available === true && g.current === 0 && g.previous_streak === 5, `after the switch: 31 Jan is the missed day, saver available (${g.saver_available})`);
  const s = await saveAt(T1, T);
  ok(s.current === 5 && s.last_completed_on === '2027-01-31', `save protects 31 Jan (current ${s.current}, last ${s.last_completed_on})`);
  ok(await savers(c) === '2027-02-01/2027-01-31', `booked on February, the couple-today month (${await savers(c)})`);
  ok((await saveAt(T2, T)).current === 5 && await savers(c) === '2027-02-01/2027-01-31', 'partner retry: idempotent');
});

// ═══ C. start_voice_upload bucket ═══
await section('C dateline jump', async () => {
  const c = await pair(V1, V2, 'Pacific/Kiritimati');
  await premium(V1);
  ok(await slots(V1, NOON, 35) === null, '+14: 35 slots on 10 Jan');
  ok(await slot(V2, NOON) === 'VOICE_LIMIT', '+14: the 36th → VOICE_LIMIT');
  await setTz(c, 'Etc/GMT+12');
  ok(await slot(V1, NOON) === 'VOICE_LIMIT', 'after +14 → −12 (local 9 Jan): still VOICE_LIMIT (no new bucket)');
  ok(await slot(V2, '2027-01-10T20:00:00-12:00') === 'VOICE_LIMIT', 'local 10 Jan in −12: the same full bucket');
  ok(await slot(V2, '2027-01-11T00:00:00-12:00') === null, 'local 11 Jan in −12: a new bucket');
  ok(await buckets(c) === '2027-01-10:35,2027-01-11:1', `buckets: ${await buckets(c)}`);
});

await section('C ordinary westward trip without a daily row', async () => {
  // 00:30 on 5 Mar in Berlin = 18:30 on 4 Mar in New York; no question fetched yet.
  const c = await pair(W1, W2, 'Europe/Berlin');
  await premium(W2);
  const T = '2027-03-05T00:30:00+01:00';
  ok(await slots(W1, T, 35) === null, 'Berlin 5 Mar: 35 slots');
  await setTz(c, 'America/New_York');
  ok(await slot(W2, T) === 'VOICE_LIMIT', 'New York 4 Mar 18:30: VOICE_LIMIT (the 5 Mar bucket is not left behind)');
  ok(await slot(W2, '2027-03-05T23:59:00-05:00') === 'VOICE_LIMIT', 'New York 5 Mar 23:59: the same bucket');
  ok(await slot(W2, '2027-03-06T00:00:00-05:00') === null, 'New York 6 Mar: a new bucket');
  ok(await buckets(c) === '2027-03-05:35,2027-03-06:1', `buckets: ${await buckets(c)}`);
});

// ═══ D. Normal days unchanged ═══
await section('D streak rollover at local midnight', async () => {
  const c = await pair(N1, N2, 'Europe/Berlin');
  await daily(c, '2027-04-10');
  await cache(c, 3, '2027-04-10');
  const late = await streakAt(N1, '2027-04-10T23:59:59+02:00');
  ok(late.completed_today === true && late.at_risk === false && late.current === 3, '23:59:59 on 10 Apr (Berlin): completed today');
  const mid = await streakAt(N1, '2027-04-11T00:00:00+02:00');
  ok(mid.completed_today === false && mid.at_risk === true && mid.current === 3, '00:00 on 11 Apr: a new day, at risk');
  const gone = await streakAt(N1, '2027-04-12T00:00:00+02:00');
  ok(gone.current === 0 && gone.previous_streak === 3, '00:00 on 12 Apr: missed 11 Apr, current 0');
});

await section('D saver on an ordinary day', async () => {
  const c = await pair(M1, M2, 'America/New_York');
  await premium(M1);
  await daily(c, '2027-05-01');
  await cache(c, 6, '2027-04-30');
  const T = '2027-05-02T09:00:00-04:00';   // missed 1 May
  ok((await streakAt(M2, T)).saver_available === true, 'missed yesterday: saver available');
  const s = await saveAt(M2, T);
  ok(s.current === 6 && s.last_completed_on === '2027-05-01' && await savers(c) === '2027-05-01/2027-05-01', `saves 1 May, booked on May (${await savers(c)})`);
});

await section('D voice bucket rollover', async () => {
  const c = await pair(O1, O2, 'Asia/Tokyo');
  await premium(O1);
  ok(await slots(O1, '2027-06-01T23:59:00+09:00', 35) === null, 'Tokyo 1 Jun 23:59: 35 slots');
  ok(await slot(O2, '2027-06-01T23:59:30+09:00') === 'VOICE_LIMIT', 'the 36th on 1 Jun → VOICE_LIMIT');
  ok(await slot(O2, '2027-06-02T00:00:00+09:00') === null, '00:00 on 2 Jun: a new bucket');
  ok(await buckets(c) === '2027-06-01:35,2027-06-02:1', `buckets: ${await buckets(c)}`);
});

// ═══ E. Privileges and live wrappers ═══
await section('E privileges', async () => {
  for (const sql of [
    `select private.couple_today_at(null, 'UTC', now())`,
    'select private.get_streak_at(now())',
    'select private.use_streak_saver_at(now())',
    `select private.start_voice_upload_at('m4a', now())`,
  ]) {
    ok(denied(await errOf('authenticated', L1, sql)), `authenticated denied: ${sql.split('(')[0].replace('select ', '')}`);
    ok(denied(await errOf('anon', null, sql)), `anon denied: ${sql.split('(')[0].replace('select ', '')}`);
  }
  for (const sql of ['select get_streak()', 'select use_streak_saver()', 'select start_voice_upload()']) {
    ok(denied(await errOf('anon', null, sql)), `anon denied: ${sql.replace('select ', '')}`);
  }
});

await section('E live wrappers', async () => {
  const c = await pair(L1, L2, 'Europe/London');
  await premium(L1);
  const g = (await as(L1, 'select (s).* from (select get_streak() s) x')).rows[0];
  ok(g.current === 0 && g.completed_today === false, 'get_streak() works for a member (definer chain reaches couple_today_at)');
  const e = await errOf('authenticated', L2, 'select use_streak_saver()');
  ok(e?.message === 'SAVER_UNAVAILABLE', `use_streak_saver() reaches its rules (${e?.message})`);
  const n = (await as(L2, 'select start_voice_upload() n')).rows[0].n;
  ok(n.startsWith(`${c}/${L2}/`), 'start_voice_upload() issues a slot');
  ok((await errOf('authenticated', A1, 'select start_voice_upload()'))?.message === 'PREMIUM_REQUIRED', 'a free couple still → PREMIUM_REQUIRED');
});

console.log(`\n${passed} passed, ${failed} failed`);
