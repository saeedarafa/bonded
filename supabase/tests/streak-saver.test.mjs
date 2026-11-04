// BE-11 / D18: fixed clocks; authenticated API grants plus privileged clock seam.
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

const p = await fixture(), outsider = await fixture();
await cache(p, 6, '2026-11-02');
ok((await get(p, T)).current === 0 && !(await get(p, T)).saver_available, 'missed yesterday: free couple sees zero and no saver');
ok((await save(p, T)).error === 'PREMIUM_REQUIRED', 'free caller cannot restore a streak');
await premium(p, T);
ok((await save(p, T)).error === 'PREMIUM_REQUIRED', 'entitlement expiring exactly now is denied');
await premium(p);
ok((await get(p, T)).saver_available === true, 'current partner premium makes saver available to both');
ok((await save(outsider, T)).error === 'PREMIUM_REQUIRED' && await ledger(p) === 0, 'outsider cannot choose or change another couple');
ok(/permission denied/.test(await error('anon', null, 'select use_streak_saver()')), 'anon cannot call public saver');
ok(await error('authenticated', null, 'select use_streak_saver()') === 'NOT_AUTHENTICATED', 'empty authenticated identity is rejected');
ok((await at(null, 'use_streak_saver_at', T)).error === 'NOT_AUTHENTICATED', 'private core checks auth too');
for (const sql of ["select private.use_streak_saver_at(now())", 'select * from private.streak_savers', 'select private.streak_run(null, current_date)', 'select private.saver_base(null, current_date)', 'select private.saver_premium(null, now())']) {
  ok(/permission denied/.test(await error('authenticated', p.a, sql)), `client denied: ${sql.split('(')[0]}`);
}
ok(/permission denied/.test(await error('authenticated', p.a, 'update entitlements set is_active=true')), 'client cannot forge premium');
await owner(`insert into badges(slug,kind,owner,threshold,title,description,priority,status)
  values ('fixture-saver-seven','streak','shared',7,'Fixture','Fixture','P1','placeholder')`);
const state = await save(p, T);
ok(state.current === 6 && state.longest === 6 && state.completed_today === false && state.at_risk && !state.saver_available, 'restore six-day run without adding a completed day');
ok(await ledger(p) === 1, 'one shared monthly claim');
const retry = await save(p, T, p.b);
ok(JSON.stringify(retry) === JSON.stringify(state) && await ledger(p) === 1, 'partner same-day retry returns state without spending again');
ok((await owner("select count(*)::int n from badge_awards where couple_id=$1 and badge_slug='fixture-saver-seven'", [p.c])).rows[0].n === 0, 'protection alone does not award an unearned seven-day badge');
await premium(p, '2026-11-04T11:00:00Z');
ok((await save(p, T, p.b)).current === 6 && await ledger(p) === 1, 'successful same-day retry remains idempotent after premium expires');
await premium(p);
await daily(p, '2026-11-04');
ok((await get(p, T)).current === 7 && (await get(p, T)).completed_today, 'today completion extends protected checkpoint once');
ok((await owner("select count(*)::int n from badge_awards where couple_id=$1 and badge_slug='fixture-saver-seven'", [p.c])).rows[0].n === 1, 'real next completion earns seven-day badge once');
await cache(p, 7, '2026-11-04');
ok((await save(p, '2026-11-06T12:00:00Z')).error === 'SAVER_UNAVAILABLE', 'second missed day in same month denied');
ok(await ledger(p) === 1, 'rejection leaves quota unchanged');
await cache(p, 7, '2026-11-29');
ok((await save(p, '2026-12-01T12:00:00Z')).current === 7 && await ledger(p) === 2, 'new usage month restores Nov30; shared quota resets at local month boundary');

const consecutive = await fixture(); await premium(consecutive); await cache(consecutive, 5, '2026-10-29');
await save(consecutive, '2026-10-31T12:00:00Z');
ok((await save(consecutive, '2026-11-01T12:00:00Z')).error === 'SAVER_UNAVAILABLE', 'month reset cannot protect two consecutive missed days');

ok(/does not exist/.test(await error('authenticated', p.a, 'select use_streak_saver(now())')), 'public RPC does not accept a client clock');
const fresh = await fixture(); await premium(fresh);
ok((await save(fresh, T)).error === 'SAVER_UNAVAILABLE', 'no prior completed streak cannot be saved');
await cache(fresh, 5, '2026-11-01');
ok((await save(fresh, T)).error === 'SAVER_UNAVAILABLE', 'two missed days cannot be saved');
await cache(fresh, 5, '2026-11-03');
ok((await save(fresh, T)).error === 'SAVER_UNAVAILABLE', 'no missed day cannot be saved');
await cache(fresh, 5, '2026-11-04');
ok((await save(fresh, T)).error === 'SAVER_UNAVAILABLE', 'today-only cache without prior run cannot invent a streak');

const eleven = await fixture(); await premium(eleven); await cache(eleven, 11, '2026-11-02');
ok((await save(eleven, T)).current === 11, 'missed-day-premium-saver fixture: eleven-day streak restores to eleven');

const doneToday = await fixture(); await premium(doneToday);
await daily(doneToday, '2026-11-01'); await daily(doneToday, '2026-11-02');
await daily(doneToday, '2026-11-04');
ok((await get(doneToday, T)).current === 1 && (await get(doneToday, T)).saver_available, 'single yesterday gap remains repairable after today completed');
const restored = await save(doneToday, T);
ok(restored.current === 3 && restored.completed_today && !restored.at_risk, 'repair joins previous run and today without double count');
await daily(doneToday, '2026-11-05');
ok((await get(doneToday, '2026-11-05T18:00:00Z')).current === 4, 'subsequent completion extends repaired run');

const late = await fixture(); await premium(late);
await daily(late, '2026-11-01'); await daily(late, '2026-11-02');
const missing = await daily(late, '2026-11-03', [late.a]);
await save(late, T);
ok((await run('authenticated', late.b, 'select * from answers where couple_question_id=$1', [missing])).rows.length === 0, 'saver does not reveal an unanswered partner answer');
ok((await owner('select answer_count from couple_questions where id=$1', [missing])).rows[0].answer_count === 1, 'saver does not fabricate answer counts');
await answer(missing, late.b, '2026-11-03', '2026-11-04T13:00:00Z');
ok((await get(late, T)).current === 3 && await ledger(late) === 1, 'late arrival on protected day counts the day once and keeps claim');
await daily(late, '2026-11-04');
ok((await get(late, T)).current === 4, 'late sync preserves future extension');

// A later offline gap merge must include both the protected day and its checkpoint.
const gap = await fixture(); await premium(gap);
await daily(gap, '2026-11-01');
const gapQ = await daily(gap, '2026-11-02', [gap.a]);
await daily(gap, '2026-11-03');
await save(gap, '2026-11-05T12:00:00Z');
await answer(gapQ, gap.b, '2026-11-02', '2026-11-03T13:00:00Z');
ok((await get(gap, '2026-11-05T12:00:00Z')).current === 3, 'older offline gap merges across protected day');

const zone = await fixture('America/New_York'); await premium(zone); await cache(zone, 3, '2026-10-30');
ok((await save(zone, '2026-11-01T03:59:59Z')).error === 'SAVER_UNAVAILABLE', 'before local midnight yesterday is already completed');
const midnight = await save(zone, '2026-11-01T04:00:00Z');
ok(midnight.current === 3 && !midnight.completed_today, 'DST month boundary uses local date rather than UTC date');
ok((await owner('select used_month::text m, saved_day::text d from private.streak_savers where couple_id=$1', [zone.c])).rows[0].m === '2026-11-01', 'quota charged to local use month');
await cache(zone, 4, '2026-11-01');
ok(!(await get(zone, '2026-11-02T04:59:59Z')).saver_available && (await save(zone, '2026-11-02T05:00:00Z')).error === 'SAVER_UNAVAILABLE', '25-hour DST day and monthly quota remain consistent');

const ended = await fixture(); await premium(ended); await cache(ended, 4, '2026-11-02');
await run('authenticated', ended.a, 'select unpair()');
ok((await save(ended, T)).error === 'NOT_PAIRED', 'ended couple cannot save');
const former = await fixture(); await premium(former); await cache(former, 4, '2026-11-02');
await owner('update couple_members set left_at=$2 where couple_id=$1 and user_id=$3', [former.c, '2026-11-03T00:00:00Z', former.b]);
ok((await save(former, T)).error === 'PREMIUM_REQUIRED', 'former member entitlement cannot fund saver');
await owner('delete from couples where id=$1', [p.c]);
ok(await ledger(p) === 0, 'purging couple cascades saver metadata');
console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
if (failed) process.exitCode = 1;
