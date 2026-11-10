// BE-37 / #126: the dispatchers call pg_net with named arguments, so the internal secret travels
// only in the Authorization header: never in `params`, the URL or the body. The stub below has
// pg_net's exact parameter names, order and defaults; the old positional call fails these checks.
// Assertions return booleans only; the fixture secret is never printed.
import fs from 'fs';
import path from 'path';
import { createDb, supabaseDir } from './pglite-supabase.mjs';

let passed = 0, failed = 0;
const ok = (c, message) => { console.log(`${c ? 'PASS' : 'FAIL'} ${message}`); c ? passed++ : failed++; };

// ---- Static guard: no positional net.http_* calls from this migration on. -----------------------
const FIX = '20261110160000';
const migDir = path.join(supabaseDir, 'migrations');
const calls = [];
for (const f of fs.readdirSync(migDir).filter(f => f.endsWith('.sql') && f.slice(0, 14) >= FIX).sort()) {
  const sql = fs.readFileSync(path.join(migDir, f), 'utf8').replace(/--[^\n]*/g, '');
  for (const m of sql.matchAll(/net\s*\.\s*http_(post|get|delete)\s*\(/gi)) {
    let depth = 1, i = m.index + m[0].length;
    for (; i < sql.length && depth; i++) depth += sql[i] === '(' ? 1 : sql[i] === ')' ? -1 : 0;
    calls.push({ f, verb: m[1].toLowerCase(), args: sql.slice(m.index + m[0].length, i - 1) });
  }
}
ok(calls.length >= 2, 'static guard sees the fixed dispatcher calls');
const named = c => /^\s*url\s*:=/i.test(c.args)
  && c.args.split(/,(?![^(]*\))/).every(a => /^\s*[a-z_]+\s*:=/i.test(a))
  && (c.verb !== 'post' || /\bheaders\s*:=/i.test(c.args));
const bad = calls.filter(c => !named(c));
ok(bad.length === 0, `every net.http_* call in migrations >= ${FIX} uses named args with headers := (${bad.map(c => c.f).join(', ') || 'none positional'})`);
ok(!named({ verb: 'post', args: '$1, $2::jsonb, $3::jsonb' }), 'static guard rejects the #126 positional form');

// ---- Behaviour against a pg_net-shaped stub. ----------------------------------------------------
const db = await createDb();
const SECRET = `FIXTURE-SECRET-${crypto.randomUUID()}`;
const owner = async (sql, args) => { await db.exec('reset role'); return db.query(sql, args); };
const bool = async (sql, args = []) => (await owner(sql, args)).rows[0]?.b === true;
const notices = [];
const call = async sql => {
  await db.exec('reset role');
  try { await db.query(sql, [], { onNotice: n => notices.push(String(n?.message ?? n)) }); return null; }
  catch (e) { return e.message; }
};
const notify = `select private.dispatch_notify('partner_answered', '00000000-0000-0000-0000-0000000000aa',
  '00000000-0000-0000-0000-0000000000bb', null, '00000000-0000-0000-0000-0000000000cc')`;
const daily = 'select private.dispatch_daily_reminders()';

ok(await call(notify) === null && await call(daily) === null, 'without Vault and pg_net both dispatchers stay a silent no-op');

await db.exec(`
  create schema vault;
  create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
  insert into vault.decrypted_secrets values ('functions_url', 'https://fixture-ref.supabase.example');`);
await owner("insert into vault.decrypted_secrets values ('internal_function_secret', $1)", [SECRET]);
ok(await call(notify) === null && await call(daily) === null, 'with Vault but no net schema both dispatchers stay a silent no-op');

await db.exec(`
  create schema net;
  create table net.calls (id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds int);
  create function net.http_post(
    url text,
    body jsonb default '{}'::jsonb,
    params jsonb default '{}'::jsonb,
    headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds int default 5000
  ) returns bigint language sql as $$
    insert into net.calls(url, body, params, headers, timeout_milliseconds)
      values (url, body, params, headers, timeout_milliseconds) returning id $$;`);

const checkLast = async (label, pathSuffix) => {
  const q = (cond) => bool(`select ($1::text is not null and (${cond})) b from net.calls c order by id desc limit 1`, [SECRET]);
  ok(await q(`c.params = '{}'::jsonb`), `${label}: params is empty`);
  ok(await q(`position('?' in c.url) = 0 and position($1 in c.url) = 0`), `${label}: URL has no query string and no secret`);
  ok(await q(`c.headers->>'Authorization' = 'Bearer ' || $1`), `${label}: Authorization header is Bearer <secret>`);
  ok(await q(`c.headers->>'Content-Type' = 'application/json' and (select count(*) from jsonb_object_keys(c.headers)) = 2`),
    `${label}: Content-Type is application/json and no other headers`);
  ok(await q(`position($1 in c.body::text) = 0`), `${label}: body carries no secret`);
  ok(await q(`c.url = 'https://fixture-ref.supabase.example${pathSuffix}'`), `${label}: URL is ${pathSuffix}`);
  ok(await q(`c.timeout_milliseconds = 5000`), `${label}: timeout is 5000 ms`);
};

ok(await call(notify) === null, 'dispatch_notify succeeds against the pg_net signature');
await checkLast('notify', '/functions/v1/notify');
ok(await bool(`select (c.body = jsonb_build_object('type','partner_answered','record_id','00000000-0000-0000-0000-0000000000aa',
  'couple_id','00000000-0000-0000-0000-0000000000bb','couple_question_id',null,'actor_user_id','00000000-0000-0000-0000-0000000000cc')) b
  from net.calls c order by id desc limit 1`), 'notify: payload is the unchanged CONTRACTS §4 body');

ok(await call(daily) === null, 'dispatch_daily_reminders succeeds against the pg_net signature');
await checkLast('daily-reminder', '/functions/v1/daily-reminder');
ok(await bool(`select (c.body = '{}'::jsonb) b from net.calls c order by id desc limit 1`), 'daily-reminder: body is {}');

// The #126 positional form against the same stub lands the headers in params: what the checks catch.
await owner(`select net.http_post($1, $2::jsonb, $3::jsonb)`, ['https://x.example/functions/v1/notify', '{}',
  JSON.stringify({ 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` })]);
ok(await bool(`select (c.params ? 'Authorization' and not (c.headers ? 'Authorization')) b from net.calls c order by id desc limit 1`),
  'control: the old positional call puts Authorization in params (the regression these checks catch)');

// Trigger path: a real answer insert dispatches through the fixed function.
const a = '00000000-0000-0000-0000-00000000a001', b = '00000000-0000-0000-0000-00000000a002';
await owner('insert into auth.users(id) values ($1), ($2)', [a, b]);
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${a}', false)`);
const couple = (await db.query("select create_couple('dating') c")).rows[0].c;
await db.exec('reset role');
await owner('insert into couple_members(couple_id, user_id) values ($1, $2)', [couple, b]);
const before = (await owner('select count(*)::int n from net.calls')).rows[0].n;
const qid = (await owner("insert into questions(body, sort_order) values ('FIXTURE-PGNET', 9001) returning id")).rows[0].id;
const cq = (await owner("insert into couple_questions(couple_id, question_id, source, assigned_for) values ($1,$2,'daily','2026-11-10') returning id", [couple, qid])).rows[0].id;
await owner("insert into answers(couple_question_id, user_id, body) values ($1, $2, 'FIXTURE-PGNET-ANSWER')", [cq, a]);
const after = (await owner('select count(*)::int n from net.calls')).rows[0].n;
ok(after > before, 'answer insert trigger dispatches through pg_net');
await checkLast('answer trigger', '/functions/v1/notify');
ok(await bool(`select (position('FIXTURE-PGNET-ANSWER' in c.body::text) = 0) b from net.calls c order by id desc limit 1`), 'answer trigger: body carries no answer text');

// URL scheme guard: https anywhere; http only for loopback, private and docker-internal hosts.
const setUrl = u => owner("update vault.decrypted_secrets set decrypted_secret = $1 where name = 'functions_url'", [u]);
const sends = async u => {
  await setUrl(u);
  const n0 = (await owner('select count(*)::int n from net.calls')).rows[0].n;
  const e1 = await call(notify), e2 = await call(daily);
  const n1 = (await owner('select count(*)::int n from net.calls')).rows[0].n;
  return e1 === null && e2 === null ? n1 - n0 : -1;
};
for (const u of ['http://host.docker.internal:54399', 'http://127.0.0.1:54321', 'http://localhost:54321',
  'http://kong:8000', 'http://172.18.0.1:9999', 'http://192.168.1.20:54321', 'http://10.0.0.5', 'http://[::1]:54321',
  'HTTP://LOCALHOST:54321/', 'http://localhost/@x', 'https://fixture-ref.supabase.example/path?x=1']) {
  ok(await sends(u) === 2, `local URL ${u} dispatches (local dev and QA harness keep working)`);
}
notices.length = 0;
for (const u of ['http://fixture-ref.supabase.example', 'http://8.8.8.8', 'ftp://fixture.example', 'http://172.32.0.1',
  'http://localhost.evil.example', 'fixture.example',
  // userinfo: the host check must not be fooled by `user:pass@` before the real host (security on #130).
  'http://localhost:1@evil.example', 'http://kong:x@8.8.8.8', 'http://10.0.0.5:a@evil.example/',
  'HTTP://localhost@evil.example', 'https://user:pw@fixture-ref.supabase.example',
  'https://fixture-ref.supabase.example@evil.example', 'http://[::1].evil.example', 'http://localhost:1x']) {
  ok(await sends(u) === 0, `non-https public URL ${u} is refused without breaking the caller`);
}
ok(notices.length > 0 && notices.every(n => !n.includes(SECRET) && !n.includes('fixture') && !n.includes('://') && n.includes('must use https')),
  'refusal warnings never contain the URL or secret');

// net exists but the call does not resolve: surfaced as a warning without URL/secret, write kept.
await setUrl('https://fixture-ref.supabase.example');
await db.exec('drop function net.http_post(text, jsonb, jsonb, jsonb, int)');
await db.exec(`create function net.http_post(url text, body jsonb) returns bigint language sql as $$ select 0::bigint $$`);
notices.length = 0;
ok(await call(notify) === null && await call(daily) === null, 'pg_net signature drift does not fail the caller');
ok(notices.length === 2 && notices.every(n => n.includes('pg_net call failed')), 'pg_net signature drift is surfaced as a warning, not swallowed');
ok(notices.every(n => !n.includes(SECRET) && !n.includes('fixture-ref') && !n.includes('Bearer')), 'drift warnings contain no URL, header or secret');

// ACLs unchanged; the new helper is internal.
const denied = async (role, sql) => {
  await db.exec(`set role ${role}`);
  try { await db.query(sql); return false; } catch (e) { return /permission denied/.test(e.message); } finally { await db.exec('reset role'); }
};
for (const role of ['anon', 'authenticated']) {
  ok(await denied(role, notify), `${role} cannot call dispatch_notify`);
  ok(await denied(role, daily), `${role} cannot call dispatch_daily_reminders`);
  ok(await denied(role, "select private.internal_url_allowed('https://x')"), `${role} cannot call internal_url_allowed`);
}
ok(await denied('service_role', daily), 'service_role cannot call dispatch_daily_reminders');
ok(await bool(`select bool_and(p.prosecdef and p.proconfig @> array['search_path=pg_catalog, extensions, public, pg_temp']) b
  from pg_proc p where p.oid in ('private.dispatch_notify(public.push_type,uuid,uuid,uuid,uuid)'::regprocedure,
  'private.dispatch_daily_reminders()'::regprocedure)`), 'both dispatchers stay SECURITY DEFINER with the pinned search_path');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
