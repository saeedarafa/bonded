// BE-57 (D56): a daily question can be answered only on its own day, for free AND Premium couples.
// A client write to `answers` (insert, upsert, update; text and voice) on a daily couple question is
// accepted only while its assigned_for is the couple-local today, plus 15 minutes after midnight by
// arrival time on the database clock; otherwise DAY_ENDED. An unchanged re-send of the caller's own
// stored answer is a no-op and succeeds. Pack questions are unaffected. The day boundary is tested
// with a pinned clock (private.answer_day_open_at); the trigger cases use a timezone whose local time
// is far from midnight right now, with whole-day offsets.
// Usage: node supabase/tests/answer-day.test.mjs
import { createDb } from './pglite-supabase.mjs';
import { randomUUID } from 'node:crypto';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errOf = async (uid, sql, params) => { try { await as(uid, sql, params); return null; } catch (e) { return e; } };
const owner = async (sql, params) => { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); return db.query(sql, params); };
const rls = e => /row-level security/.test(e?.message ?? '');
const is = (e, code) => e?.message === code && e?.code === 'P0001';

const U = n => `00000000-0000-0000-0000-0000000057${n}`;
const [F1, F2, P1, P2, O1, O2, N1, N2] = ['01', '02', '03', '04', '05', '06', '07', '08'].map(U);
await db.exec(`insert into auth.users (id) values ${[F1, F2, P1, P2, O1, O2, N1, N2].map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) select 'DAY-Q' || g, g from generate_series(1, 40) g;`);

// A timezone whose local time is now between 02:00 and 21:00, so "today" and "yesterday" are
// unambiguous for the trigger cases (the grace itself is tested with a pinned clock below).
const TZS = ['UTC', 'Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati', 'Asia/Kolkata', 'America/Los_Angeles'];
let TZ = null;
for (const tz of TZS) {
  const h = (await owner(`select extract(hour from now() at time zone $1)::int h`, [tz])).rows[0].h;
  if (h >= 2 && h < 21) { TZ = tz; break; }
}
ok(TZ !== null, `picked a timezone away from midnight (${TZ})`);

const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  await owner(`update couples set timezone = $2, paired_at = now() - interval '20 days' where id = $1`, [couple, TZ]);
  return couple;
};
const setPremium = uid => owner(`insert into entitlements (user_id, is_active, expires_at) values ($1, true, '2999-01-01T00:00:00Z')
  on conflict (user_id) do update set is_active = true, expires_at = excluded.expires_at`, [uid]);
let qn = 0;
// A daily question k days ago (couple-local), or a pack question started k days ago.
const day = async (couple, k, source = 'daily') => (await owner(
  `insert into couple_questions (couple_id, question_id, source, assigned_for, created_at)
   select $1, id, $2, case when $2 = 'daily' then (now() at time zone $3)::date - $4::int end, now() - make_interval(days => $4)
     from questions where body = $5 returning id`, [couple, source, TZ, k, `DAY-Q${++qn}`])).rows[0].id;
const upsert = (uid, cq, body, extra = '') => as(uid,
  `insert into answers (couple_question_id, user_id, body${extra ? ', client_written_at' : ''}) values ($1, $2, $3${extra ? ', $4' : ''})
   on conflict (couple_question_id, user_id) do update set body = excluded.body returning id`,
  extra ? [cq, uid, body, extra] : [cq, uid, body]);
const serverAnswer = (cq, uid, body) => owner(
  `insert into answers (couple_question_id, user_id, body) values ($1, $2, $3) returning id`, [cq, uid, body]).then(r => r.rows[0].id);
const bodyOf = async (cq, uid) => (await owner('select body from answers where couple_question_id = $1 and user_id = $2', [cq, uid])).rows[0]?.body;

const free = await pair(F1, F2);
const prem = await pair(P1, P2);
await setPremium(P1);
const other = await pair(O1, O2);

for (const [label, couple, a, b] of [['free', free, F1, F2], ['Premium', prem, P1, P2]]) {
  const today = await day(couple, 0), yday = await day(couple, 1), old = await day(couple, 5);
  ok((await upsert(a, today, `${label}-today`)).rows.length === 1, `${label}: answer to today's question accepted`);
  ok(await bodyOf(today, a) === `${label}-today`, `${label}: today's answer stored`);
  await upsert(a, today, `${label}-today-edited`);
  ok(await bodyOf(today, a) === `${label}-today-edited`, `${label}: edit of today's answer accepted`);
  const e1 = await errOf(b, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'late')`, [yday, b]);
  ok(is(e1, 'DAY_ENDED'), `${label}: answer to yesterday → DAY_ENDED (got ${e1?.message})`);
  const e2 = await errOf(b, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'late')`, [old, b]);
  ok(is(e2, 'DAY_ENDED'), `${label}: answer to day −5 → DAY_ENDED, not PREMIUM_REQUIRED (got ${e2?.message})`);
  const e3 = await errOf(b, `insert into answers (couple_question_id, user_id, body, client_written_at)
    values ($1, $2, 'queued', now() - interval '1 day')`, [yday, b]);
  ok(is(e3, 'DAY_ENDED'), `${label}: an offline-queued answer written yesterday → DAY_ENDED (client time ignored)`);
  ok(await bodyOf(yday, b) === undefined, `${label}: nothing stored for the refused answer`);

  // Edits of a past answer (written on its day; inserted here by the server).
  await serverAnswer(yday, a, `${label}-yday`);
  const e4 = await errOf(a, `update answers set body = 'changed' where couple_question_id = $1 and user_id = $2`, [yday, a]);
  ok(is(e4, 'DAY_ENDED'), `${label}: update of yesterday's answer → DAY_ENDED (got ${e4?.message})`);
  const e5 = await errOf(a, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'changed')
    on conflict (couple_question_id, user_id) do update set body = excluded.body`, [yday, a]);
  ok(is(e5, 'DAY_ENDED'), `${label}: upsert edit of yesterday's answer → DAY_ENDED`);
  ok(await bodyOf(yday, a) === `${label}-yday`, `${label}: yesterday's answer unchanged`);
  ok((await upsert(a, yday, `${label}-yday`)).rows.length === 1, `${label}: unchanged re-send (upsert) of yesterday's own answer succeeds`);
  ok((await as(a, `update answers set body = body where couple_question_id = $1 and user_id = $2 returning id`, [yday, a])).rows.length === 1,
    `${label}: unchanged update of yesterday's own answer succeeds`);
  const e6 = await errOf(a, `insert into answers (couple_question_id, user_id, kind, body, voice_path, voice_duration_ms)
    values ($1, $2, 'voice', null, $3, 4000) on conflict (couple_question_id, user_id)
    do update set kind = excluded.kind, body = excluded.body, voice_path = excluded.voice_path, voice_duration_ms = excluded.voice_duration_ms`,
    [yday, a, `${couple}/${a}/${randomUUID()}.m4a`]);
  ok(is(e6, 'DAY_ENDED'), `${label}: voice answer to yesterday → DAY_ENDED (got ${e6?.message})`);

  // Reveal rule (D13, lead decision 4): the partner who missed yesterday never reads the answer.
  ok((await as(b, 'select body from answers where couple_question_id = $1 and user_id = $2', [yday, a])).rows.length === 0,
    `${label}: partner of a one-sided missed day cannot read the answer`);
  ok((await as(a, 'select body from answers where couple_question_id = $1 and user_id = $2', [yday, a])).rows.length === 1,
    `${label}: the author still reads their own answer of yesterday`);

  // The server is not limited (seeds, service code).
  ok(!!(await serverAnswer(old, b, 'seed')), `${label}: server write into a past day still allowed`);

  // Another couple's member: RLS, never DAY_ENDED (no date oracle).
  const e7 = await errOf(O1, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'x')`, [yday, O1]);
  ok(rls(e7), `${label}: other couple writing into this couple's past day → RLS error (got ${e7?.message})`);
  const e8 = await errOf(a, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'x')`, [yday, b]);
  ok(e8 && !is(e8, 'DAY_ENDED'), `${label}: writing the partner's user_id → not DAY_ENDED (got ${e8?.message})`);
}

// Pack questions (D51) have no day: a Premium couple answers an old one.
{
  const pack = await day(prem, 9, 'pack');
  ok((await upsert(P2, pack, 'pack-old')).rows.length === 1, 'Premium: answer to a pack question started 9 days ago accepted');
  await upsert(P2, pack, 'pack-old-edited');
  ok(await bodyOf(pack, P2) === 'pack-old-edited', 'Premium: edit of an old pack answer accepted');
  const packToday = await day(free, 0, 'pack');  // a row the free couple still has (D43 era)
  ok((await upsert(F1, packToday, 'pack-today')).rows.length === 1, 'free: answer to a pack question of today accepted');
}

// Reveal rule with both answering today, as before.
{
  const t = await day(other, 0);
  await upsert(O1, t, 'o1');
  ok((await as(O2, 'select 1 from answers where couple_question_id = $1 and user_id = $2', [t, O1])).rows.length === 0, 'reveal: partner cannot read before answering');
  await upsert(O2, t, 'o2');
  ok((await as(O2, 'select 1 from answers where couple_question_id = $1 and user_id = $2', [t, O1])).rows.length === 1, 'reveal: partner reads after answering');
}

// ═══ Pinned clock: the 15-minute grace (database arrival time) ═══
{
  const nyc = (await as(N1, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  await owner(`update couples set timezone = 'America/New_York' where id = $1`, [nyc]);
  const mk = async (d, src = 'daily') => (await owner(`insert into couple_questions (couple_id, question_id, source, assigned_for)
    select $1, id, $2, $3::date from questions where body = $4 returning id`, [nyc, src, src === 'daily' ? d : null, `DAY-Q${++qn}`])).rows[0].id;
  const open = async (cq, at) => (await owner('select private.answer_day_open_at($1, $2) o', [cq, at])).rows[0].o;
  const jan10 = await mk('2027-01-10');
  ok(await open(jan10, '2027-01-10T12:00:00-05:00'), 'pinned: noon on the day → open');
  ok(await open(jan10, '2027-01-10T23:59:00-05:00'), 'pinned: 23:59 → open');
  ok(await open(jan10, '2027-01-11T00:09:00-05:00'), 'pinned: 23:59 + 10 min (arrival 00:09 next day) → open (grace)');
  ok(await open(jan10, '2027-01-11T00:14:59-05:00'), 'pinned: 00:14:59 next day → open');
  ok(!(await open(jan10, '2027-01-11T00:15:00-05:00')), 'pinned: 00:15:00 next day → closed');
  ok(!(await open(jan10, '2027-01-11T00:19:00-05:00')), 'pinned: 23:59 + 20 min (arrival 00:19) → closed');
  ok(!(await open(jan10, '2027-01-12T12:00:00-05:00')), 'pinned: two days later → closed');
  ok(await open(jan10, '2027-01-11T04:59:00Z') && !(await open(jan10, '2027-01-11T05:15:00Z')), 'pinned: boundary is couple-local (UTC 04:59 open, 05:15 closed)');
  ok(await open(jan10, '2027-01-09T20:00:00-05:00'), 'pinned: a row dated after the local today (timezone change) → open');
  // DST: 2027-03-14 has 23 hours in New York; the grace is 15 real minutes after local midnight.
  const mar14 = await mk('2027-03-14');
  ok(await open(mar14, '2027-03-15T00:10:00-04:00') && !(await open(mar14, '2027-03-15T00:16:00-04:00')), 'pinned: DST spring-forward day, grace 15 min after local midnight');
  const nov7 = await mk('2027-11-07');
  ok(await open(nov7, '2027-11-08T00:14:00-05:00') && !(await open(nov7, '2027-11-08T00:15:00-05:00')), 'pinned: DST fall-back day, grace 15 min after local midnight');
  const pack = await mk(null, 'pack');
  ok(await open(pack, '2030-01-01T00:00:00Z'), 'pinned: a pack question is always open');
}

// ═══ Catalogue and privileges ═══
ok((await owner(`select 'DAY_ENDED'::public.error_code::text c`)).rows[0].c === 'DAY_ENDED', 'DAY_ENDED is in the error_code catalogue');
const e9 = await errOf(F1, `select private.answer_day_open_at(gen_random_uuid(), now())`);
ok(/permission denied/.test(e9?.message ?? ''), 'authenticated cannot call private.answer_day_open_at');
const trig = (await owner(`select tgname from pg_trigger where tgrelid = 'public.answers'::regclass and not tgisinternal
  and tgname like 'answers_%' and tgtype & 2 = 2 order by tgname`)).rows.map(r => r.tgname);
ok(trig.indexOf('answers_day_window') > trig.indexOf('answers_before_write') && trig.indexOf('answers_day_window') < trig.indexOf('answers_history_lock'),
  `trigger order: answers_before_write < answers_day_window < answers_history_lock (${trig})`);

console.log(`\n${passed} passed, ${failed} failed`);
