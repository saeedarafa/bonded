// BE-03: couples v2 (D03 solo couple, D10 stage/goals/partner name/key dates, couple status).
// Usage: node supabase/tests/couples-v2.test.mjs   (after `npm --prefix supabase/tests ci`)
// Nothing asserts on now(); dates in fixtures are explicit.
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
const errorOf = async (role, uid, sql, params) => {
  try { await run(role, uid, sql, params); return null; } catch (e) { return e.message; }
};
const one = async (uid, sql, params) => (await as(uid, sql, params)).rows[0];

const U = n => `00000000-0000-0000-0000-0000000002${n}`;
const [MAYA, SAM, EVE, FINN, LEA] = ['01', '02', '03', '04', '05'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, FINN, LEA].map(u => `('${u}')`).join(', ')};
  update profiles set timezone = 'Europe/Berlin' where id = '${MAYA}';
  update profiles set timezone = 'America/New_York' where id = '${SAM}';
  insert into questions (body, sort_order) values ('CV-Q1', 1), ('CV-Q2', 2);`);

// ── create_couple: solo couple (D03) ──
const couple = (await one(MAYA, `select create_couple('long_distance', array['deep_talks', '', 'our_future', 'deep_talks'], '  Sam  ') c`)).c;
ok(!!couple, 'create_couple returns a couple id');
const c1 = await one(MAYA, 'select * from couples');
ok(c1.id === couple && c1.stage === 'long_distance' && c1.status === 'active' && c1.ended_at === null, 'solo couple: stage set, status active');
ok(JSON.stringify(c1.goals) === JSON.stringify(['deep_talks', 'our_future']), `goals: blanks and duplicates dropped, order kept (${JSON.stringify(c1.goals)})`);
ok(c1.partner_name === 'Sam', 'partner_name trimmed');
ok(c1.timezone === 'Europe/Berlin', 'couple timezone = creator\'s profile timezone');
ok((await as(MAYA, 'select user_id from couple_members')).rows.map(r => r.user_id).join() === MAYA, 'one member: the creator');
ok((await one(MAYA, 'select current from couple_streaks')).current === 0, 'streak row created');

// Idempotent retry while still solo: same id, settings updated, no second couple.
const again = (await one(MAYA, `select create_couple('dating', array['romance'], null) c`)).c;
ok(again === couple, 'create_couple retry returns the same couple');
const c2 = await one(MAYA, 'select stage, goals, partner_name from couples');
ok(c2.stage === 'dating' && c2.goals.join() === 'romance' && c2.partner_name === null, 'retry updates the solo couple settings');
ok((await db.query('select count(*)::int n from couples')).rows[0].n === 1, 'retry created no second couple');
await as(MAYA, `select create_couple('long_distance', array['deep_talks', 'our_future'], 'Sam')`);
const many = Array.from({ length: 20 }, (_, i) => `g${i}`);
await as(LEA, `select create_couple(null, $1, $2)`, [many, 'x'.repeat(60)]);
const lea = await one(LEA, 'select stage, goals, partner_name from couples');
ok(lea.stage === null && lea.goals.length === 12 && lea.partner_name.length === 40, 'stage optional; goals capped at 12, partner_name at 40');
ok(/invalid input value for enum/.test(await errorOf('authenticated', EVE, `select create_couple('married', '{}', null)`) ?? ''), 'unknown stage rejected by the enum (client bug, not a code)');
await as(LEA, 'select unpair()');

// ── Solo couple gets a daily question ──
const dq = await one(MAYA, 'select (get_daily_question()).*');
ok(dq && dq.couple_id === couple && dq.source === 'daily', 'solo couple gets a daily question');
await as(MAYA, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'CV-MAYA')`, [dq.id, MAYA]);
ok((await one(MAYA, 'select answer_count from couple_questions where id = $1', [dq.id])).answer_count === 1, 'solo answer counted');
ok((await one(MAYA, 'select current from couple_streaks')).current === 0, 'no streak from one answer');

// ── Key dates (D10) ──
await as(MAYA, `insert into key_dates (couple_id, kind, date, remind_week_before) values ($1, 'together_since', '2023-03-14', true)`, [couple]);
await as(MAYA, `insert into key_dates (couple_id, kind, user_id, date) values ($1, 'birthday', $2, '1994-05-09')`, [couple, MAYA]);
// The app upserts on (couple_id, kind, user_id); NULLS NOT DISTINCT makes that work for couple-wide dates.
await as(MAYA, `insert into key_dates (couple_id, kind, date) values ($1, 'together_since', '2023-03-15')
  on conflict (couple_id, kind, user_id) do update set date = excluded.date`, [couple]);
ok((await as(MAYA, `select date::text d from key_dates where kind = 'together_since'`)).rows.map(r => r.d).join() === '2023-03-15', 'together_since upsert: one row, updated');
ok(/duplicate key/.test(await errorOf('authenticated', MAYA, `insert into key_dates (couple_id, kind, date) values ($1, 'together_since', '2020-01-01')`, [couple]) ?? ''), 'second together_since rejected');
ok(/check constraint/.test(await errorOf('authenticated', MAYA, `insert into key_dates (couple_id, kind, date) values ($1, 'birthday', '2000-01-01')`, [couple]) ?? ''), 'birthday needs a user_id');
ok(/check constraint/.test(await errorOf('authenticated', MAYA, `insert into key_dates (couple_id, kind, user_id, date) values ($1, 'anniversary', $2, '2000-01-01')`, [couple, MAYA]) ?? ''), 'couple-wide date has no user_id');

// ── Invite + join: the joiner inherits stage, goals and dates (J5) ──
const invite = await one(MAYA, 'select (x).code c, (x).token t from (select create_invite() x) s');
const { c: code, t: token } = invite;
ok((await one(MAYA, 'select couple_id, partner_name from pair_invites where code = $1', [code])).couple_id === couple, 'invite points at the inviter\'s couple');
ok((await one(MAYA, 'select partner_name from pair_invites where code = $1', [code])).partner_name === 'Sam', 'invite carries partner_name');
ok((await as(SAM, 'select * from key_dates')).rows.length === 0, 'before joining, Sam sees no dates');
const joined = (await one(SAM, 'select accept_invite($1, $2, true) c', [code, token])).c;
ok(joined === couple, 'accept_invite joins the inviter\'s couple');
ok((await db.query("select count(*)::int n from couples where status = 'active'")).rows[0].n === 1, 'no new active couple created on join');
const seen = await one(SAM, 'select * from couples');
ok(seen.id === couple && seen.stage === 'long_distance' && seen.goals.join() === 'deep_talks,our_future', 'joiner inherits stage and goals');
ok(seen.timezone === 'Europe/Berlin', 'joiner inherits the couple timezone');
ok((await as(SAM, 'select kind from key_dates order by kind')).rows.map(r => r.kind).join() === 'together_since,birthday', 'joiner inherits the key dates');
ok((await as(SAM, 'select user_id from couple_members order by user_id')).rows.map(r => r.user_id).join() === [MAYA, SAM].join(), 'couple has two members');
ok((await one(SAM, `select count(*)::int n from couples where status = 'active'`)).n === 1, 'contract select .eq(status, active) finds the couple');
ok((await as(SAM, 'select left_at from couple_members')).rows.every(r => r.left_at === null), 'couple_members.left_at readable (null while active)');

// Day-1 question carries over; Sam answers and sees Maya's (reveal rule), streak starts.
ok((await one(SAM, 'select (get_daily_question()).id')).id === dq.id, 'joiner gets the question the inviter already answered');
ok((await as(SAM, 'select * from answers')).rows.length === 0, 'reveal rule: Sam cannot see Maya\'s solo answer before answering');
await as(SAM, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'CV-SAM')`, [dq.id, SAM]);
ok((await as(SAM, 'select * from answers')).rows.length === 2, 'reveal rule: Sam sees both after answering');
ok((await one(SAM, 'select current from couple_streaks')).current === 1, 'streak = 1 once both answered');

// Birthdays: each partner adds their own; nobody edits the other's.
await as(SAM, `insert into key_dates (couple_id, kind, user_id, date) values ($1, 'birthday', $2, '1993-11-20')`, [couple, SAM]);
ok((await as(MAYA, `select user_id from key_dates where kind = 'birthday' order by user_id`)).rows.length === 2, 'both birthdays visible to both');
ok(/row-level security/.test(await errorOf('authenticated', SAM, `insert into key_dates (couple_id, kind, user_id, date) values ($1, 'birthday', $2, '2001-01-01')
  on conflict (couple_id, kind, user_id) do update set date = excluded.date`, [couple, MAYA]) ?? ''), 'Sam cannot set Maya\'s birthday');
await as(SAM, `update key_dates set date = '2001-01-01' where kind = 'birthday' and user_id = $1`, [MAYA]);
ok((await one(MAYA, `select date::text d from key_dates where kind = 'birthday' and user_id = $1`, [MAYA])).d === '1994-05-09', 'Sam\'s update of Maya\'s birthday changes nothing');
await as(SAM, `update key_dates set remind_week_before = false where kind = 'together_since'`);
ok((await one(MAYA, `select remind_week_before r from key_dates where kind = 'together_since'`)).r === false, 'either partner edits couple-wide dates');

// ── Couple settings: members edit stage/goals; status and ids are server-owned ──
await as(SAM, `update couples set stage = 'engaged_married', goals = array['romance']`);
ok((await one(MAYA, 'select stage from couples')).stage === 'engaged_married', 'partner updates stage (contract: couples.update({ stage, goals }))');
ok(/permission denied/.test(await errorOf('authenticated', SAM, `update couples set status = 'ended', ended_at = '2026-01-01T00:00:00Z'`) ?? ''), 'members cannot set status/ended_at');
ok(/permission denied/.test(await errorOf('authenticated', SAM, `update couples set id = gen_random_uuid()`) ?? ''), 'members cannot change the couple id');
ok(/row-level security|permission denied/.test(await errorOf('authenticated', SAM, `insert into couples (timezone) values ('UTC')`) ?? ''), 'members cannot insert couples directly');

// ── Errors ──
ok(await errorOf('authenticated', MAYA, `select create_couple('dating', '{}', null)`) === 'ALREADY_PAIRED', 'create_couple in a full couple → ALREADY_PAIRED');
ok(await errorOf('authenticated', MAYA, 'select create_invite()') === 'COUPLE_FULL', 'create_invite in a full couple → COUPLE_FULL');
ok(await errorOf('authenticated', EVE, 'select create_invite()') === 'NOT_PAIRED', 'create_invite without a couple → NOT_PAIRED');
ok(await errorOf('authenticated', null, `select create_couple('dating', '{}', null)`) === 'NOT_AUTHENTICATED', 'create_couple without a session → NOT_AUTHENTICATED');
ok(/permission denied/.test(await errorOf('anon', null, `select create_couple('dating', '{}', null)`) ?? ''), 'create_couple: anon denied');

// ── Other couple and anon see nothing ──
await as(EVE, `select create_couple('living_together', array['romance'], 'Finn')`);
const eveCouple = (await one(EVE, 'select id from couples')).id;
ok((await as(EVE, 'select * from key_dates')).rows.length === 0, 'other couple sees no key dates');
ok((await as(EVE, 'select id from couples')).rows.map(r => r.id).join() === eveCouple, 'other couple sees only its own couple');
ok(/row-level security/.test(await errorOf('authenticated', EVE, `insert into key_dates (couple_id, kind, date) values ($1, 'anniversary', '2020-01-01')`, [couple]) ?? ''), 'other couple cannot add dates to ours');
await as(EVE, `update key_dates set date = '2000-01-01'`);
await as(EVE, `delete from key_dates`);
ok((await db.query(`select count(*)::int n from key_dates where couple_id = $1`, [couple])).rows[0].n === 3, 'other couple cannot edit or delete our dates');
await as(EVE, `update couples set stage = 'dating' where id = $1`, [couple]);
ok((await db.query('select stage::text s from couples where id = $1', [couple])).rows[0].s === 'engaged_married', 'other couple cannot edit our couple');
ok(/permission denied/.test(await errorOf('anon', null, 'select * from key_dates') ?? ''), 'anon cannot read key_dates');

// ── Joining an ended couple fails; BE-09 keeps the archive (ended-couples.test.mjs covers it) ──
const eveCode = (await one(EVE, 'select (create_invite()).code c')).c;
await db.query(`update couples set status = 'ended', ended_at = '2026-10-01T00:00:00Z' where id = $1`, [eveCouple]);
const ended = await one(FINN, `select accept_invite($1, p_archive_own => true) j`, [eveCode]);
ok(ended.j.message === 'COUPLE_FULL', 'invite into an ended couple → COUPLE_FULL');
await as(MAYA, 'select unpair()');
ok((await db.query('select count(*)::int n from key_dates where couple_id = $1', [couple])).rows[0].n === 3
  && (await db.query('select count(*)::int n from pair_invites where couple_id = $1 and accepted_at is not null', [couple])).rows[0].n === 1,
  'unpair retains the archive and its accepted invite record');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
