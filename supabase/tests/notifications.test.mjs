// BE-07: notification_prefs (D23), timezone validation, push_tokens RLS + register_push_token.
// Usage: node supabase/tests/notifications.test.mjs
import fs from 'fs';
import path from 'path';
import { createDb, defaultMigrations } from './pglite-supabase.mjs';

const migrations = defaultMigrations();
const last = migrations.find(f => f.endsWith('_notification_prefs.sql'));
let db;
try { db = await createDb(migrations.filter(f => f !== last)); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errorOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e.message; } };
const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;

// ═══ Migration: reminder_time carried over, then dropped ═══
const U = n => `00000000-0000-0000-0000-0000000007${n}`;
const [OLD1, OLD2] = [U('91'), U('92')];
await db.exec(`insert into auth.users (id) values ('${OLD1}'), ('${OLD2}'); update profiles set reminder_time = '08:30' where id = '${OLD1}';`);
await db.exec(fs.readFileSync(last, 'utf8'));
{
  const r = (await db.query('select user_id, ritual_time::text t from notification_prefs where user_id in ($1, $2) order by t', [OLD1, OLD2])).rows;
  ok(r.length === 2 && r.find(x => x.user_id === OLD1).t === '08:30:00' && r.find(x => x.user_id === OLD2).t === '21:00:00', 'migration: profiles.reminder_time becomes ritual_time; users without one get 21:00');
  ok(!(await db.query(`select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'reminder_time'`)).rows.length, 'migration: profiles.reminder_time is gone');
}

// ═══ Defaults ═══
const [MAYA, SAM, EVE, FINN, NOA] = ['01', '02', '03', '04', '05'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, FINN, NOA].map(u => `('${u}')`).join(', ')}`);
{
  const p = (await as(MAYA, 'select * from notification_prefs')).rows;
  ok(p.length === 1 && p[0].user_id === MAYA, 'a new account gets its own prefs row');
  const d = p[0];
  ok(d.ritual_time === '21:00:00' && d.daily_reminder && d.partner_answered && d.replies && d.last_call && d.nudges && d.tips === false && d.quiet_start === '23:00:00' && d.quiet_end === '07:00:00', 'defaults: ritual 21:00, five types on, tips off (opt-in), quiet hours 23:00–07:00 (D23)');
}

// ═══ Own prefs only ═══
const SAMS = (await db.query('select * from notification_prefs where user_id = $1', [SAM])).rows[0];
ok((await as(SAM, 'select user_id from notification_prefs')).rows.map(r => r.user_id).join() === SAM, 'a user reads only their own row');
ok((await as(NOA, 'select * from notification_prefs')).rows.length === 1, 'every user sees exactly one row (their own)');
ok(/permission denied/.test(await errorOf('anon', null, 'select * from notification_prefs') ?? ''), 'anon cannot read prefs');
// The client upsert from CONTRACTS.
await as(MAYA, `insert into notification_prefs (user_id, ritual_time, daily_reminder, partner_answered, replies, last_call, nudges, tips, quiet_start, quiet_end)
  values ($1, '08:00', true, false, true, false, true, true, '22:00', '06:30')
  on conflict (user_id) do update set ritual_time = excluded.ritual_time, daily_reminder = excluded.daily_reminder, partner_answered = excluded.partner_answered,
    replies = excluded.replies, last_call = excluded.last_call, nudges = excluded.nudges, tips = excluded.tips, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end`, [MAYA]);
{
  const m = (await as(MAYA, 'select * from notification_prefs')).rows[0];
  ok(m.ritual_time === '08:00:00' && m.partner_answered === false && m.last_call === false && m.tips === true && m.quiet_start === '22:00:00' && m.quiet_end === '06:30:00', 'the upsert changes ritual time, toggles and quiet hours');
  ok(new Date(m.updated_at) >= new Date(SAMS.updated_at), 'updated_at is maintained');
}
await as(MAYA, `update notification_prefs set tips = false where user_id = $1`, [SAM]);
await as(MAYA, `update notification_prefs set ritual_time = '03:00' where user_id <> $1`, [MAYA]);
{
  const s = (await db.query('select * from notification_prefs where user_id = $1', [SAM])).rows[0];
  ok(s.ritual_time === SAMS.ritual_time && s.tips === SAMS.tips, 'a user cannot change someone else\'s prefs (no rows match)');
}
ok(/row-level security/.test(await errorOf('authenticated', MAYA, `insert into notification_prefs (user_id) values ($1)`, [SAM]) ?? ''), 'a user cannot insert a row for someone else');
ok(/row-level security/.test(await errorOf('authenticated', MAYA, `update notification_prefs set user_id = $1 where user_id = $2`, [SAM, MAYA]) ?? ''), 'a row cannot be handed to someone else');
ok(/permission denied/.test(await errorOf('authenticated', MAYA, 'delete from notification_prefs') ?? ''), 'prefs cannot be deleted (they go with the account)');
// Partner (same couple) doesn't read prefs either.
{
  const code = (await (async () => { await as(MAYA, `select create_couple('dating','{}',null)`); return as(MAYA, 'select (create_invite()).code c'); })()).rows[0].c;
  await as(SAM, 'select accept_invite($1)', [code]);
  ok((await as(SAM, 'select user_id from notification_prefs')).rows.map(r => r.user_id).join() === SAM, 'a partner in the same couple still reads only their own prefs');
}

// ═══ Constraints ═══
ok(/notification_prefs_quiet_hours_differ/.test(await errorOf('authenticated', EVE, `update notification_prefs set quiet_start = '22:00', quiet_end = '22:00'`) ?? ''), 'quiet_start and quiet_end must differ');
ok(/not-null/.test(await errorOf('authenticated', EVE, `update notification_prefs set ritual_time = null`) ?? ''), 'ritual_time is required');
ok(/not-null/.test(await errorOf('authenticated', EVE, `update notification_prefs set nudges = null`) ?? ''), 'toggles are never null');
ok(/out of range|invalid input syntax for type time/.test(await errorOf('authenticated', EVE, `update notification_prefs set ritual_time = '25:00'`) ?? ''), 'an invalid time is rejected');
ok(!(await as(EVE, `update notification_prefs set quiet_start = '00:00', quiet_end = '23:59' returning 1`).then(r => r.rows.length === 0)), 'midnight and 23:59 are accepted');

// ═══ Quiet hours helper (for notify, BE-08) ═══
{
  const q = async (t, s, e) => (await db.query(`select private.in_quiet_hours($1::time, $2::time, $3::time) r`, [t, s, e])).rows[0].r;
  ok(await q('23:00', '23:00', '07:00') && await q('02:00', '23:00', '07:00') && await q('06:59', '23:00', '07:00'), 'quiet hours wrapping midnight: 23:00, 02:00, 06:59 are inside');
  ok(!(await q('07:00', '23:00', '07:00')) && !(await q('12:00', '23:00', '07:00')) && !(await q('22:59', '23:00', '07:00')), '... 07:00, 12:00, 22:59 are outside');
  ok(await q('13:00', '12:00', '14:00') && !(await q('14:00', '12:00', '14:00')) && !(await q('11:59', '12:00', '14:00')), 'quiet hours inside one day');
}

// ═══ Timezone check ═══
const tz = async (uid, value) => errorOf('authenticated', uid, `update profiles set timezone = $1 where id = $2`, [value, uid]);
for (const bad of ['Mars/Olympus', 'EST', 'UTC+3', 'PST8PDT', '', 'berlin', 'Europe/', "Europe/Berlin'; --", 'Europe/Berlin ', '../etc/passwd']) {
  ok(/profiles_timezone_is_iana/.test(await tz(FINN, bad) ?? ''), `invalid timezone ${JSON.stringify(bad)} is rejected`);
}
for (const good of ['Europe/Berlin', 'America/New_York', 'UTC', 'Asia/Kolkata', 'America/Argentina/Buenos_Aires', 'Pacific/Auckland']) {
  ok(await tz(FINN, good) === null, `valid timezone ${good} is accepted`);
}
ok(/profiles_timezone_is_iana/.test(await errorOf('authenticated', FINN, `update profiles set timezone = null where id = $1`, [FINN]) ?? '') || /not-null/.test(await errorOf('authenticated', FINN, `update profiles set timezone = null where id = $1`, [FINN]) ?? ''), 'a null timezone is rejected');
{
  await as(FINN, `select create_couple('dating', '{}', null)`);
  ok(/couples_timezone_is_iana/.test(await errorOf('authenticated', FINN, `update couples set timezone = 'Mars/Olympus'`) ?? ''), 'the couple\'s timezone is checked too');
  await as(FINN, `update couples set timezone = 'Europe/Paris'`);
  ok((await as(FINN, 'select timezone from couples')).rows[0].timezone === 'Europe/Paris', 'a valid couple timezone is accepted');
}
ok(await count(`select count(*)::int n from profiles where timezone = 'UTC'`) >= 1, 'the default timezone UTC passes the check');

// ═══ push_tokens ═══
const T1 = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]', T2 = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
await as(MAYA, `insert into push_tokens (token, user_id, platform) values ($1, $2, 'ios')`, [T1, MAYA]);
await as(SAM, `insert into push_tokens (token, user_id, platform) values ($1, $2, 'android')`, [T2, SAM]);
ok((await as(MAYA, 'select token from push_tokens')).rows.map(r => r.token).join() === T1, 'push_tokens: a user reads only their own tokens');
ok((await as(NOA, 'select token from push_tokens')).rows.length === 0, 'push_tokens: others see nothing (not even a partner\'s)');
ok((await as(SAM, 'select token from push_tokens')).rows.map(r => r.token).join() === T2, 'push_tokens: a partner sees only theirs');
ok(/row-level security/.test(await errorOf('authenticated', MAYA, `insert into push_tokens (token, user_id, platform) values ('ExponentPushToken[cccccccc]', $1, 'ios')`, [SAM]) ?? ''), 'push_tokens: cannot register a token for someone else');
ok(/row-level security/.test(await errorOf('authenticated', MAYA, `insert into push_tokens (token, user_id, platform) values ($1, $2, 'ios') on conflict (token) do update set user_id = excluded.user_id`, [T2, MAYA]) ?? ''), 'push_tokens: a direct upsert cannot take over someone else\'s token');
await as(MAYA, `update push_tokens set platform = 'ios' where token = $1`, [T2]);
await as(MAYA, `delete from push_tokens where token = $1`, [T2]);
ok(await count('select count(*)::int n from push_tokens where user_id = $1 and token = $2 and platform = $3', [SAM, T2, 'android']) === 1 && await count('select count(*)::int n from push_tokens where user_id = $1', [MAYA]) === 1, 'push_tokens: cannot change or delete someone else\'s token');
ok(/permission denied/.test(await errorOf('anon', null, 'select * from push_tokens') ?? ''), 'push_tokens: anon denied');
ok(/check constraint/.test(await errorOf('authenticated', MAYA, `insert into push_tokens (token, user_id, platform) values ('x', $1, 'ios')`, [MAYA]) ?? '') && /check constraint/.test(await errorOf('authenticated', MAYA, `insert into push_tokens (token, user_id, platform) values ($1, $2, 'web')`, ['ExponentPushToken[dddddddd]', MAYA]) ?? ''), 'push_tokens: token length and platform are checked');
// Own token upsert (same user, new platform) still works.
await as(MAYA, `insert into push_tokens (token, user_id, platform) values ($1, $2, 'android') on conflict (token) do update set platform = excluded.platform`, [T1, MAYA]);
ok((await as(MAYA, 'select platform from push_tokens where token = $1', [T1])).rows[0].platform === 'android', 'push_tokens: upserting your own token works');

// register_push_token: the device changes hands.
ok(/permission denied/.test(await errorOf('anon', null, `select register_push_token('${T1}', 'ios')`) ?? ''), 'register_push_token: anon denied');
{
  await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  const e = await db.query(`set role authenticated`).then(() => db.query(`select register_push_token($1, 'ios')`, [T1])).then(() => null, x => x.message);
  await db.exec('reset role');
  ok(e === 'NOT_AUTHENTICATED', 'register_push_token: NOT_AUTHENTICATED without a user');
}
await as(NOA, `select register_push_token($1, 'ios')`, [T1]);
ok((await db.query('select user_id, platform from push_tokens where token = $1', [T1])).rows[0].user_id === NOA && await count('select count(*)::int n from push_tokens where token = $1', [T1]) === 1, 'register_push_token: the token moves to the signed-in user (device handed over), one row');
ok((await as(MAYA, 'select * from push_tokens')).rows.length === 0 && (await as(NOA, 'select token from push_tokens')).rows.map(r => r.token).join() === T1, '... the previous owner no longer has it; the new one does');
await as(NOA, `select register_push_token($1, 'ios')`, [T1]);
ok(await count('select count(*)::int n from push_tokens where token = $1', [T1]) === 1, 'register_push_token is idempotent');
ok(/check constraint/.test(await errorOf('authenticated', NOA, `select register_push_token('short', 'ios')`) ?? ''), 'register_push_token: validates the token');
// Prefs and tokens go with the account.
await db.exec(`delete from auth.users where id = '${NOA}'`);
ok(await count('select count(*)::int n from notification_prefs where user_id = $1', [NOA]) === 0 && await count('select count(*)::int n from push_tokens where user_id = $1', [NOA]) === 0, 'deleting the account deletes prefs and tokens');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
