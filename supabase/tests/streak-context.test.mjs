// BE-11 / #121 P2: reason/previous-run context, fixed clocks and API-role isolation.
import { createDb } from './pglite-supabase.mjs';
const db = await createDb();
let passed = 0, failed = 0, seq = 0, qn = 0;
const ok = (c, message) => { console.log(`${c ? 'PASS' : 'FAIL'} ${message}`); c ? passed++ : failed++; };
const owner = async (sql, args) => {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)");
  return db.query(sql, args);
};
const run = async (role, uid, sql, args) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`);
  try { return await db.query(sql, args); } finally { await db.exec('reset role'); }
};
const error = async (role, uid, sql, args) => {
  try { await run(role, uid, sql, args); return null; } catch (e) { return e.message; }
};
const at = async (uid, name, now) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`);
  try { return (await db.query(`select (s).* from (select private.${name}($1::timestamptz) s) x`, [now])).rows[0]; }
  catch (e) { return { error: e.message }; }
};
const get = (p, now) => at(p.a, 'get_streak_at', now);
const save = (p, now, uid = p.a) => at(uid, 'use_streak_saver_at', now);
const fixture = async (tz = 'UTC') => {
  const a = `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`;
  const b = `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`;
  await owner('insert into auth.users(id) values ($1), ($2)', [a, b]);
  const c = (await run('authenticated', a, "select create_couple('dating') c")).rows[0].c;
  await owner('insert into couple_members(couple_id, user_id) values ($1, $2)', [c, b]);
  await owner('update couples set timezone = $2 where id = $1', [c, tz]);
  return { a, b, c };
};
const premium = (p, expires = null, who = p.b) => owner(`insert into entitlements(user_id, is_active, expires_at)
  values ($1, true, $2) on conflict(user_id) do update set is_active=true, expires_at=excluded.expires_at`, [who, expires]);
const cache = (p, current, day) => owner(`update couple_streaks set current=$2, longest=$2, last_completed_on=$3 where couple_id=$1`, [p.c, current, day]);
const daily = async (p, day, users = [p.a, p.b], arrival = null) => {
  const q = (await owner("insert into questions(body, sort_order) values ('FIXTURE-SAVER', $1) returning id", [++qn])).rows[0].id;
  const cq = (await owner("insert into couple_questions(couple_id, question_id, source, assigned_for) values ($1,$2,'daily',$3) returning id", [p.c, q, day])).rows[0].id;
  for (const u of users) await answer(cq, u, day, arrival);
  return cq;
};
const answer = (cq, uid, day, arrival = null) => owner(`insert into answers(couple_question_id,user_id,body,client_written_at,created_at)
  values ($1,$2,'FIXTURE-SAVER-ANSWER',$3,$4)`, [cq, uid, `${day}T12:00:00Z`, arrival ?? `${day}T12:00:00Z`]);
const ledger = async p => (await owner('select count(*)::int n from private.streak_savers where couple_id=$1', [p.c])).rows[0].n;
const T = '2026-11-04T12:00:00Z';
const p = await fixture();
let s = await get(p, T);
ok(s.previous_streak === null && s.saver_reason === null && !s.saver_available, 'fresh couple has no prior run or unavailable reason');
await cache(p, 11, '2026-11-02');
await owner('update couple_streaks set longest=99 where couple_id=$1', [p.c]);
s = await get(p, T);
ok(s.current === 0 && s.previous_streak === 11 && s.saver_reason === null && !s.saver_available, 'free caller sees expired prior run without a fabricated premium reason');
await premium(p, T);
ok(!(await get(p, T)).saver_available, 'exact entitlement expiry retains existing denial');
await premium(p);
s = await get(p, T);
ok(s.saver_available && s.previous_streak === 11 && s.saver_reason === null, 'one repairable day with premium has previous run and no failure reason');
ok(JSON.stringify(s) === JSON.stringify(await at(p.b, 'get_streak_at', T)), 'both current members receive identical context');
const before = await ledger(p);
ok(JSON.stringify(s) === JSON.stringify(await get(p, T)) && await ledger(p) === before, 'reading context is retry safe and never consumes quota');
s = await save(p, T);
ok(s.current === 11 && s.previous_streak === null && s.saver_reason === null, 'successful saver clears expired-run context without inventing a completion');
ok(JSON.stringify(s) === JSON.stringify(await save(p, T, p.b)), 'partner saver retry preserves extended return shape');
await cache(p, 12, '2026-11-04');
s = await get(p, '2026-11-06T12:00:00Z');
ok(s.previous_streak === 12 && s.saver_reason === 'used_this_month' && !s.saver_available, 'a later single gap explains shared monthly quota');
s = await get(p, '2026-11-07T12:00:00Z');
ok(s.previous_streak === 12 && s.saver_reason === 'too_many_missed', 'two missing days take precedence over spent monthly quota');
await cache(p, 12, '2026-11-29');
s = await get(p, '2026-12-01T12:00:00Z');
ok(s.saver_available && s.previous_streak === 12 && s.saver_reason === null, 'new local month clears monthly reason');
await cache(p, 0, null);
s = await get(p, T);
ok(s.previous_streak === null && s.saver_reason === null, 'empty cache cannot report an earlier longest run');
await cache(p, 5, '2026-11-03');
s = await get(p, T);
ok(s.current === 5 && s.previous_streak === null && s.saver_reason === null, 'ongoing run has no expired-run context even after quota spent');
await owner('delete from couple_streaks where couple_id=$1', [p.c]);
s = await get(p, T);
ok(s.current === 0 && s.previous_streak === null && s.saver_reason === null, 'missing cache returns all eight fields safely');

const afterToday = await fixture(); await premium(afterToday);
// Use a saver earlier this month, then complete actual days either side of yesterday.
await cache(afterToday, 4, '2026-10-31'); await save(afterToday, '2026-11-02T12:00:00Z');
await daily(afterToday, '2026-11-02'); await daily(afterToday, '2026-11-04');
s = await get(afterToday, T);
ok(s.current === 1 && s.completed_today && s.previous_streak === null && s.saver_reason === 'used_this_month', 'today completion still explains quota for a repairable yesterday gap');

const rollover = await fixture(); await premium(rollover); await cache(rollover, 5, '2026-10-29');
await save(rollover, '2026-10-31T12:00:00Z');
s = await get(rollover, '2026-11-01T12:00:00Z');
ok(s.previous_streak === 5 && s.saver_reason === 'too_many_missed' && !s.saver_available, 'consecutive protected/missed days stay unavailable across month rollover');

const zone = await fixture('America/New_York'); await premium(zone); await cache(zone, 3, '2026-10-30');
s = await get(zone, '2026-11-01T03:59:59Z');
ok(s.current === 3 && s.previous_streak === null && s.saver_reason === null, 'before local midnight UTC November is still an ongoing October run');
s = await get(zone, '2026-11-01T04:00:00Z');
ok(s.current === 0 && s.previous_streak === 3 && s.saver_available, 'exact local midnight exposes expired run and November eligibility');
await save(zone, '2026-11-01T04:00:00Z');
await cache(zone, 4, '2026-11-01');
s = await get(zone, '2026-11-03T04:59:59Z');
ok(s.previous_streak === null && s.saver_reason === null, '25-hour DST day: run remains ongoing until next local midnight');
s = await get(zone, '2026-11-03T05:00:00Z');
ok(s.previous_streak === 4 && s.saver_reason === 'used_this_month', '25-hour DST boundary uses local date for context and quota');

const own = await fixture(), other = await fixture();
await cache(own, 8, '2000-01-01'); await cache(other, 77, '2000-01-01');
const read = async uid => (await run('authenticated', uid, 'select (get_streak()).*')).rows[0];
ok((await read(own.a)).previous_streak === 8 && (await read(other.a)).previous_streak === 77, 'public RPC returns only caller current-couple context');
ok(JSON.stringify(await read(own.a)) === JSON.stringify(await read(own.b)), 'public RPC supplies identical server-clock state to partners');
ok(/permission denied/.test(await error('anon', null, 'select get_streak()')), 'anon cannot read streak context');
ok(await error('authenticated', null, 'select get_streak()') === 'NOT_AUTHENTICATED', 'authenticated role without identity cannot read context');
ok(/permission denied/.test(await error('authenticated', own.a, 'select private.get_streak_at(now())')), 'client cannot choose clock through private seam');
ok(/does not exist/.test(await error('authenticated', own.a, 'select get_streak(now())')), 'public RPC has no caller-clock overload');
await run('authenticated', own.a, 'select unpair()');
ok(await error('authenticated', own.a, 'select get_streak()') === 'NOT_PAIRED', 'ended membership cannot read context through current-couple RPC');
const replacement = (await run('authenticated', own.a, "select create_couple('dating') c")).rows[0].c;
ok((await read(own.a)).previous_streak === null && replacement !== own.c, 'new couple never inherits expired-run context from former couple');
console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
if (failed) process.exitCode = 1;
