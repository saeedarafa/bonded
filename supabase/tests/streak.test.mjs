// BE-06: streak v2 (D17). Rule: an answer to the daily question of local day D counts for D if it was
// written on D and arrives before the end of D+1 (couple's timezone). get_streak() is 0 after a missed day.
// Usage: node supabase/tests/streak.test.mjs
// The rule is tested as a pure function with explicit timestamps, then through the trigger with
// explicit created_at / client_written_at (owner inserts, no JWT user: the row's timestamps are
// trusted), and once through the client path with times computed relative to the database clock.
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
const errorOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e.message; } };
const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;
const owner = async (sql, params) => { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); return db.query(sql, params); };

// ═══ The rule, pure ═══
const rule = async (assigned, tz, written, arrived) =>
  (await db.query(`select private.answer_counts_for_day($1::date, $2, $3::timestamptz, $4::timestamptz) r`, [assigned, tz, written, arrived])).rows[0].r;
{
  const B = 'Europe/Berlin'; // UTC+1 in December
  ok(await rule('2026-12-10', B, '2026-12-10T19:00:00Z', '2026-12-10T19:00:00Z') === true, 'D17: written on D, arrives on D → counts');
  ok(await rule('2026-12-10', B, '2026-12-10T22:59:59Z', '2026-12-11T22:59:59Z') === true, 'written 23:59:59 on D, arrives 23:59:59 on D+1 → counts');
  ok(await rule('2026-12-10', B, '2026-12-10T22:59:59Z', '2026-12-11T23:00:00Z') === false, 'arrives at 00:00:00 on D+2 → saved but does not count');
  ok(await rule('2026-12-10', B, '2026-12-10T23:00:00Z', '2026-12-10T23:00:00Z') === false, 'written 00:00 on D+1 (an answer to D\'s question the next day) → does not count');
  ok(await rule('2026-12-10', B, '2026-12-09T22:59:59Z', '2026-12-10T10:00:00Z') === false, 'written 23:59 on D-1 → does not count');
  ok(await rule('2026-12-10', B, '2026-12-09T23:00:00Z', '2026-12-10T10:00:00Z') === true, 'written 00:00 on D → counts');
  ok(await rule('2026-12-10', 'Pacific/Auckland', '2026-12-10T10:00:00Z', '2026-12-10T10:00:00Z') === true, 'timezone: 10:00Z on 10 Dec is 23:00 in Auckland (UTC+13) → still D');
  ok(await rule('2026-12-10', 'Pacific/Auckland', '2026-12-10T11:00:00Z', '2026-12-10T11:00:00Z') === false, 'timezone: 11:00Z is already 11 Dec in Auckland → not D');
  // DST: New York falls back on 2026-11-01 (a 25-hour day); D+1 ends at 00:00 EST on 3 Nov = 05:00Z.
  const N = 'America/New_York';
  ok(await rule('2026-11-01', N, '2026-11-01T04:30:00Z', '2026-11-03T04:59:59Z') === true, 'DST fall-back: written 00:30 EDT on D, arrives 23:59:59 EST on D+1 → counts');
  ok(await rule('2026-11-01', N, '2026-11-01T04:30:00Z', '2026-11-03T05:00:00Z') === false, 'DST fall-back: one second later → does not count');
  ok(await rule('2026-11-01', N, '2026-11-01T03:59:59Z', '2026-11-01T10:00:00Z') === false, 'DST fall-back: 23:59:59 EDT on 31 Oct is not D');
  ok(await rule(null, B, '2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z') === true, 'a pack question has no day: always counts');
  ok(/permission denied/.test(await errorOf('authenticated', null, `select private.answer_counts_for_day(null, 'UTC', now(), now())`) ?? ''), 'clients cannot call the rule');
}

// ═══ Fixtures ═══
const U = n => `00000000-0000-0000-0000-0000000006${n}`;
const [MAYA, SAM, EVE, FINN, NOA, ZOE, LEO] = ['01', '02', '03', '04', '05', '06', '07'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, FINN, NOA, ZOE, LEO].map(u => `('${u}')`).join(', ')};
  update profiles set timezone = 'Europe/Berlin' where id in ('${MAYA}', '${SAM}', '${EVE}', '${FINN}');
  update profiles set timezone = 'America/New_York' where id in ('${ZOE}', '${LEO}');
  insert into questions (body, sort_order) select 'STREAK-Q' || g, g from generate_series(1, 40) g;`);
const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const code = (await as(a, 'select (create_invite()).code c')).rows[0].c;
  await as(b, 'select accept_invite($1)', [code]);
  return couple;
};
const mayaSam = await pair(MAYA, SAM), eveFinn = await pair(EVE, FINN);
let qn = 0;
const cqDay = async (couple, day) => (await db.query(
  `insert into couple_questions (couple_id, question_id, source, assigned_for) select $1, id, 'daily', $2::date from questions where body = 'STREAK-Q' || $3 returning id`,
  [couple, day, ++qn])).rows[0].id;
// An answer with explicit device and arrival times.
const answer = (cq, user, written, arrived) => owner(
  `insert into answers (couple_question_id, user_id, body, client_written_at, created_at) values ($1, $2, 'STREAK-ANS', $3::timestamptz, $4::timestamptz)`, [cq, user, written, arrived]);
const online = (cq, user, at) => answer(cq, user, null, at);
const streak = async couple => (await db.query(`select current, longest, last_completed_on::text d from couple_streaks where couple_id = $1`, [couple])).rows[0];
const getStreak = async (uid, now) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`);
  try { return (await db.query(`select (s).* from (select private.get_streak_at($1::timestamptz) s) x`, [now])).rows[0]; }
  catch (e) { return { error: e.message }; }
};

// ═══ Streak through the trigger ═══
const d10 = await cqDay(mayaSam, '2026-12-10'), d11 = await cqDay(mayaSam, '2026-12-11'), d12 = await cqDay(mayaSam, '2026-12-12'), d13 = await cqDay(mayaSam, '2026-12-13');
await online(d10, MAYA, '2026-12-10T19:00:00Z');
let s = await streak(mayaSam);
ok(s.current === 0 && s.d === null, 'one answer does not make a streak');
await online(d10, SAM, '2026-12-10T20:00:00Z');
s = await streak(mayaSam);
ok(s.current === 1 && s.longest === 1 && s.d === '2026-12-10', 'both answered day 1 → streak 1');
await online(d11, MAYA, '2026-12-11T19:00:00Z'); await online(d11, SAM, '2026-12-11T19:30:00Z');
s = await streak(mayaSam);
ok(s.current === 2 && s.d === '2026-12-11', 'day 2 → streak 2');
const morning = await getStreak(MAYA, '2026-12-12T10:00:00Z');
ok(morning.current === 2 && morning.longest === 2 && morning.completed_today === false && morning.at_risk === false && morning.saver_available === false, 'get_streak the next morning: current 2 (yesterday completed), not completed today, not at risk below 3');

// Offline: Sam writes on D at 22:00 local, it syncs at 09:00 local on D+1 → counts for D.
await online(d12, MAYA, '2026-12-12T19:00:00Z');
await answer(d12, SAM, '2026-12-12T21:00:00Z', '2026-12-13T08:00:00Z');
s = await streak(mayaSam);
ok(s.current === 3 && s.d === '2026-12-12', 'D17: an offline answer written on D and synced on D+1 counts for D (streak 3)');
ok((await db.query(`select counts_for_streak c from answers where couple_question_id = $1 and user_id = $2`, [d12, SAM])).rows[0].c === true, 'the answer is flagged as counting');
const g = await getStreak(MAYA, '2026-12-13T09:00:00Z');
ok(g.current === 3 && g.completed_today === false && g.at_risk === true, 'get_streak: streak of 3 not yet secured today → at_risk (the 22:30 last call)');
await online(d13, MAYA, '2026-12-13T19:00:00Z');
// Too late: written on D13 but arrives at 00:00 on D+2 → saved, not counted.
await answer(d13, SAM, '2026-12-13T21:00:00Z', '2026-12-14T23:00:00Z');
ok((await db.query(`select counts_for_streak c from answers where couple_question_id = $1 and user_id = $2`, [d13, SAM])).rows[0].c === false, 'D17: an answer that arrives after the end of D+1 is saved but flagged as not counting');
s = await streak(mayaSam);
ok(s.current === 3 && s.d === '2026-12-12', '... and the streak did not move');
ok((await db.query('select answer_count n from couple_questions where id = $1', [d13])).rows[0].n === 2 && await count(`select count(*)::int n from answers where couple_question_id = $1`, [d13]) === 2, '... the answered signal still shows both, and both answers are stored');
// Missed day → 0.
const miss = await getStreak(MAYA, '2026-12-14T09:00:00Z');   // last completed d12, yesterday was d13
ok(miss.current === 0 && miss.longest === 3 && miss.at_risk === false, 'get_streak after a missed day: current 0, longest kept');
ok((await getStreak(MAYA, '2026-12-13T22:59:59Z')).current === 3 && (await getStreak(MAYA, '2026-12-13T23:00:00Z')).current === 0, 'the day rolls over at local midnight: 3 until 23:59:59 on 13 Dec (Berlin), 0 from 00:00 on 14 Dec');
ok((await getStreak(SAM, '2026-12-14T09:00:00Z')).current === 0, 'the partner sees the same');
// After a miss the next completed day restarts at 1.
const d15 = await cqDay(mayaSam, '2026-12-15');
await online(d15, MAYA, '2026-12-15T19:00:00Z'); await online(d15, SAM, '2026-12-15T19:05:00Z');
s = await streak(mayaSam);
ok(s.current === 1 && s.longest === 3 && s.d === '2026-12-15', 'after a missed day the next completed day restarts the streak at 1 (longest stays 3)');

// A late day that fills a gap merges the streak (couple eveFinn).
const e10 = await cqDay(eveFinn, '2026-12-10'), e11 = await cqDay(eveFinn, '2026-12-11'), e12 = await cqDay(eveFinn, '2026-12-12');
await online(e10, EVE, '2026-12-10T19:00:00Z'); await online(e10, FINN, '2026-12-10T19:10:00Z');
await online(e12, EVE, '2026-12-12T19:00:00Z'); await online(e12, FINN, '2026-12-12T19:10:00Z');
s = await streak(eveFinn);
ok(s.current === 1 && s.d === '2026-12-12', 'a gap restarts the streak at 1 (day 12 completed, day 11 still open)');
await online(e11, EVE, '2026-12-11T19:00:00Z');
await answer(e11, FINN, '2026-12-11T21:00:00Z', '2026-12-12T08:00:00Z');   // Finn's offline answer for the 11th syncs on the 12th
s = await streak(eveFinn);
ok(s.current === 3 && s.longest === 3 && s.d === '2026-12-12', 'D17: the late day fills the gap, so 10, 11, 12 merge into a streak of 3');
await owner(`update answers set body = 'STREAK-EDIT' where couple_question_id = $1`, [e11]);
ok((await streak(eveFinn)).current === 3, 'editing an answer does not move the streak');
const eveToday = await getStreak(EVE, '2026-12-12T20:00:00Z');
ok(eveToday.completed_today === true && eveToday.at_risk === false, 'completed today → completed_today, not at risk');

// ═══ Client path: the server owns the clock (real now(), relative times) ═══
{
  const zoeLeo = await pair(ZOE, LEO);   // America/New_York
  const ydayLocal = (await db.query(`select ((now() at time zone 'America/New_York')::date - 1)::text d`)).rows[0].d;
  const cqToday = (await as(ZOE, 'select (get_daily_question()).id i')).rows[0].i;
  const cqY = await cqDay(zoeLeo, ydayLocal);
  ok(/permission denied/.test(await errorOf('authenticated', ZOE, `insert into answers (couple_question_id, user_id, body, created_at) values ($1, $2, 'x', now() - interval '3 days')`, [cqToday, ZOE]) ?? ''), 'clients cannot set created_at');
  ok(/permission denied/.test(await errorOf('authenticated', ZOE, `insert into answers (couple_question_id, user_id, body, counts_for_streak) values ($1, $2, 'x', true)`, [cqToday, ZOE]) ?? ''), 'clients cannot set counts_for_streak');
  await as(ZOE, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'ZOE-TODAY')`, [cqToday, ZOE]);
  let a = (await db.query(`select counts_for_streak c, client_written_at <= created_at ok, created_at > now() - interval '1 minute' fresh from answers where user_id = $1 and couple_question_id = $2`, [ZOE, cqToday])).rows[0];
  ok(a.c && a.ok && a.fresh, 'an online answer to today\'s question counts; created_at is the server\'s time');
  await as(LEO, `insert into answers (couple_question_id, user_id, body, client_written_at) values ($1, $2, 'LEO-TODAY', now() + interval '5 days')`, [cqToday, LEO]);
  a = (await db.query(`select counts_for_streak c, client_written_at <= created_at ok from answers where user_id = $1 and couple_question_id = $2`, [LEO, cqToday])).rows[0];
  ok(a.c && a.ok, 'a client_written_at in the future is clamped to arrival and counts for today');
  ok((await db.query('select current from couple_streaks where couple_id = $1', [zoeLeo])).rows[0].current === 1, 'both answered today → streak 1');
  await as(ZOE, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'ZOE-YDAY')`, [cqY, ZOE]);
  ok((await db.query(`select counts_for_streak c from answers where user_id = $1 and couple_question_id = $2`, [ZOE, cqY])).rows[0].c === false, 'an online answer to yesterday\'s question (written today) does not count');
  await as(LEO, `insert into answers (couple_question_id, user_id, body, client_written_at) values ($1, $2, 'LEO-YDAY', (((now() at time zone 'America/New_York')::date - 1) + time '21:00') at time zone 'America/New_York')`, [cqY, LEO]);
  ok((await db.query(`select counts_for_streak c from answers where user_id = $1 and couple_question_id = $2`, [LEO, cqY])).rows[0].c === true, 'an offline answer written yesterday at 21:00 local and arriving today counts for yesterday');
  await as(ZOE, `insert into answers (couple_question_id, user_id, body, client_written_at) values ($1, $2, 'ZOE-YDAY-EDITED', (((now() at time zone 'America/New_York')::date - 1) + time '20:00') at time zone 'America/New_York')
    on conflict (couple_question_id, user_id) do update set body = excluded.body, client_written_at = excluded.client_written_at`, [cqY, ZOE]);
  a = (await db.query(`select body, counts_for_streak c from answers where user_id = $1 and couple_question_id = $2`, [ZOE, cqY])).rows[0];
  ok(a.body === 'ZOE-YDAY-EDITED' && a.c === false, 'an edit through the upsert cannot turn a non-counting answer into a counting one');
  await as(ZOE, `update answers set couple_question_id = $1 where user_id = $2 and body = 'ZOE-TODAY'`, [cqY, ZOE]);
  ok(await count(`select count(*)::int n from answers where user_id = $1 and couple_question_id = $2 and body = 'ZOE-TODAY'`, [ZOE, cqToday]) === 1, 'an answer cannot be moved to another question');
  ok((await as(NOA, 'select * from answers')).rows.length === 0, 'reveal rule: an outsider sees no answers');
}

// ═══ get_streak ═══
ok((await getStreak(null, '2026-12-14T09:00:00Z')).error === 'NOT_AUTHENTICATED', 'get_streak: NOT_AUTHENTICATED');
ok((await getStreak(NOA, '2026-12-14T09:00:00Z')).error === 'NOT_PAIRED', 'get_streak: NOT_PAIRED');
ok(/permission denied/.test(await errorOf('anon', null, 'select get_streak()') ?? ''), 'get_streak: anon denied');
ok(/permission denied/.test(await errorOf('authenticated', MAYA, `select private.get_streak_at(now())`) ?? ''), 'clients cannot pass their own clock');
{
  const SOLO = U('08');
  await db.exec(`insert into auth.users (id) values ('${SOLO}')`);
  await as(SOLO, `select create_couple('dating', '{}', null)`);
  const z = await getStreak(SOLO, '2026-12-14T09:00:00Z');
  ok(z.current === 0 && z.longest === 0 && z.last_completed_on === null && !z.completed_today && !z.at_risk && !z.saver_available, 'a solo couple has an empty streak');
  const pub = (await as(SOLO, 'select (s).current, (s).saver_available from (select get_streak() s) x')).rows[0];
  ok(pub.current === 0 && pub.saver_available === false, 'the public get_streak() returns the same shape');
}

// ═══ Concurrent get_daily_question: the loser of the race gets the winner's row ═══
{
  const RACE = U('09');
  await db.exec(`insert into auth.users (id) values ('${RACE}')`);
  const couple = (await as(RACE, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  // Simulates the other partner's transaction winning between our SELECT and INSERT: a competing
  // row for the same day with a different question lands just before ours.
  await db.exec(`
    create function public.test_race() returns trigger language plpgsql security definer set search_path = public as $$
    begin
      if current_setting('test.race', true) = 'on' then
        perform set_config('test.race', 'off', false);
        insert into couple_questions (couple_id, question_id, source, assigned_for)
          select new.couple_id, id, 'daily', new.assigned_for from questions where body = 'STREAK-Q40';
      end if;
      return new;
    end $$;
    create trigger test_race before insert on public.couple_questions for each row execute function public.test_race();
    select set_config('test.race', 'on', false);`);
  const got = (await as(RACE, 'select (get_daily_question()).question_id q')).rows[0].q;
  const winner = (await db.query(`select id from questions where body = 'STREAK-Q40'`)).rows[0].id;
  ok(got === winner, 'concurrent get_daily_question: the call that lost the race returns the winner\'s question');
  ok(await count(`select count(*)::int n from couple_questions where couple_id = $1 and source = 'daily'`, [couple]) === 1, '... and there is still exactly one daily question for the day');
  ok((await as(RACE, 'select (get_daily_question()).question_id q')).rows[0].q === winner, '... which every later call returns');
  await db.exec(`drop trigger test_race on public.couple_questions; drop function public.test_race()`);
}

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
