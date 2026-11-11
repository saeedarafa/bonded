// BE-51 (D54): the PostHog deletion queue behind delete-account and the hourly analytics-deletions run.
//   A. analytics_deletion_request: service role only, idempotent, null is a no-op.
//   B. analytics_deletions_due: only rows whose Auth user is gone, only due rows, leased 10 min, limit clamp.
//   C. analytics_deletion_result: success removes the row; failure counts, stores the status, backs off
//      15 min, 30 min, ... capped at 24 h.
//   D. Privileges: anon and authenticated can call none of it and cannot read the private table.
//   E. Dispatcher: silent without Vault/pg_net, when nothing is due or only live users' rows are due; otherwise one pg_net call to
//      /functions/v1/analytics-deletions with the secret only in the Authorization header.
// Usage: node supabase/tests/analytics-deletions.test.mjs
import { createDb } from './pglite-supabase.mjs';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const section = async (name, fn) => { try { await fn(); } catch (e) { ok(false, `${name}: threw ${e.message}`); } };
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const svc = (sql, params) => run('service_role', null, sql, params);
const errOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e; } };
const owner = async (sql, params) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`); return db.query(sql, params); };
const denied = e => /permission denied/.test(e?.message ?? '');

const U = n => `00000000-0000-0000-0000-0000000051${String(n).padStart(2, '0')}`;
const [LIVE, GONE, GONE2, GONE3, NEVER] = [U(1), U(2), U(3), U(4), U(5)];
await owner(`insert into auth.users (id) values ${[LIVE, GONE, GONE2, GONE3].map(u => `('${u}')`).join(', ')}`);
const row = async id => (await owner(`select attempts, last_status, extract(epoch from (next_attempt_at - now()))::int as wait
  from private.analytics_deletions where distinct_id = $1`, [id])).rows[0];
const due = async (limit = 100) => (await svc('select d from analytics_deletions_due($1) d', [limit])).rows.map(r => r.d);
const count = async () => Number((await owner('select count(*)::int n from private.analytics_deletions')).rows[0].n);

await section('A. request', async () => {
  for (const id of [LIVE, GONE, GONE2, GONE3]) await svc('select analytics_deletion_request($1)', [id]);
  await svc('select analytics_deletion_request($1)', [GONE]);
  ok(await count() === 4, 'request records each user once (a retried delete-account keeps one row)');
  const r = await row(GONE);
  ok(r.attempts === 0 && r.last_status === null && r.wait <= 0, 'a new request is due at once with no attempts');
  await svc('select analytics_deletion_request(null)');
  ok(await count() === 4, 'request(null) is a no-op');
});

await section('B. due', async () => {
  ok((await due()).length === 0, 'nothing is handed out while every Auth user still exists');
  await owner(`delete from auth.users where id in ($1, $2, $3)`, [GONE, GONE2, GONE3]);
  const first = await due(2);
  ok(first.length === 2 && !first.includes(LIVE), 'limit 2 hands out two rows of deleted users, never the live one');
  ok((await row(first[0])).wait > 590 && (await row(first[0])).wait <= 600, 'a handed-out row is leased for 10 minutes');
  const second = await due();
  ok(second.length === 1 && !first.includes(second[0]) && second[0] !== LIVE, 'a second run gets only the unleased deleted row');
  ok((await due()).length === 0, 'leased rows are not handed out again');
  await owner(`update private.analytics_deletions set next_attempt_at = now() - interval '1 second'`);
  ok((await due(0)).length === 1, 'p_limit 0 is clamped to 1');
  ok((await due(100000)).length === 2, 'a huge p_limit is clamped (and takes the rest)');
});

await section('C. result', async () => {
  await svc('select analytics_deletion_result($1, true, 202)', [GONE]);
  ok(!(await row(GONE)), 'success removes the row');
  await svc('select analytics_deletion_result($1, true, 202)', [GONE]);
  ok(!(await row(GONE)), 'a repeated success is a no-op');
  await svc('select analytics_deletion_result($1, false, 503)', [GONE2]);
  let r = await row(GONE2);
  ok(r.attempts === 1 && r.last_status === 503 && r.wait > 890 && r.wait <= 900, 'first failure: attempts 1, status kept, retry in 15 min');
  await svc('select analytics_deletion_result($1, false, 0)', [GONE2]);
  r = await row(GONE2);
  ok(r.attempts === 2 && r.last_status === 0 && r.wait > 1790 && r.wait <= 1800, 'second failure: retry in 30 min, status 0 = network');
  await owner(`update private.analytics_deletions set attempts = 9 where distinct_id = $1`, [GONE2]);
  await svc('select analytics_deletion_result($1, false, 401)', [GONE2]);
  r = await row(GONE2);
  ok(r.attempts === 10 && r.wait > 86390 && r.wait <= 86400, 'backoff is capped at 24 h');
  await owner(`update private.analytics_deletions set attempts = 100000 where distinct_id = $1`, [GONE2]);
  await svc('select analytics_deletion_result($1, false, 500)', [GONE2]);
  ok((await row(GONE2)).wait <= 86400, 'a very high attempt count does not overflow');
  await svc('select analytics_deletion_result($1, false, 500)', [NEVER]);
  await svc('select analytics_deletion_result(null, true, 200)');
  ok(!(await row(NEVER)) && await count() === 3, 'a result for an unknown or null user changes nothing');
});

await section('D. privileges', async () => {
  for (const [role, uid] of [['anon', null], ['authenticated', LIVE]]) {
    for (const sql of [
      `select analytics_deletion_request('${LIVE}')`,
      'select analytics_deletions_due(10)',
      `select analytics_deletion_result('${GONE3}', true, 200)`,
      'select private.dispatch_analytics_deletions()',
      'select * from private.analytics_deletions',
    ]) ok(denied(await errOf(role, uid, sql)), `${role} cannot run: ${sql.slice(0, 48)}`);
  }
  ok(denied(await errOf('service_role', null, 'select * from private.analytics_deletions')), 'service_role cannot read the table directly');
  ok(denied(await errOf('service_role', null, 'select private.dispatch_analytics_deletions()')), 'service_role cannot run the dispatcher');
  const definer = (await owner(`select bool_and(prosecdef) b, bool_and(proconfig::text like '%search_path=pg_catalog%') s from pg_proc
    where proname in ('analytics_deletion_request', 'analytics_deletions_due', 'analytics_deletion_result', 'dispatch_analytics_deletions')`)).rows[0];
  ok(definer.b && definer.s, 'all four are SECURITY DEFINER with a pinned search_path');
  ok((await owner(`select relrowsecurity r from pg_class where oid = 'private.analytics_deletions'::regclass`)).rows[0].r, 'RLS is enabled on the queue');
});

await section('E. dispatcher', async () => {
  const dispatch = () => owner('select private.dispatch_analytics_deletions()');
  await dispatch();
  ok(true, 'without Vault and pg_net the dispatcher is a silent no-op');
  const SECRET = `FIXTURE-SECRET-${crypto.randomUUID()}`;
  await db.exec(`reset role;
    create schema vault;
    create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
    insert into vault.decrypted_secrets values ('functions_url', 'https://fixture-ref.supabase.example');
    create schema net;
    create table net.calls (id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds int);
    create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
      headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds int default 5000)
      returns bigint language sql as $$ insert into net.calls(url, body, params, headers, timeout_milliseconds)
      values (url, body, params, headers, timeout_milliseconds) returning id $$;`);
  await owner(`insert into vault.decrypted_secrets values ('internal_function_secret', $1)`, [SECRET]);
  const calls = async () => Number((await owner('select count(*)::int n from net.calls')).rows[0].n);
  await owner(`update private.analytics_deletions set next_attempt_at = now() + interval '1 hour'`);
  await dispatch();
  ok(await calls() === 0, 'nothing due: no pg_net call');
  await svc('select analytics_deletion_request($1)', [LIVE]);
  await owner(`update private.analytics_deletions set next_attempt_at = now() - interval '1 second' where distinct_id = $1`, [LIVE]);
  await dispatch();
  ok(await calls() === 0, 'a due row whose Auth user still exists: no pg_net call');
  await owner(`update private.analytics_deletions set next_attempt_at = now() + interval '1 hour' where distinct_id = $1`, [LIVE]);
  await owner(`update private.analytics_deletions set next_attempt_at = now() - interval '1 second' where distinct_id = $1`, [GONE3]);
  await dispatch();
  const c = (await owner('select * from net.calls order by id desc limit 1')).rows[0];
  ok(await calls() === 1 && c.url === 'https://fixture-ref.supabase.example/functions/v1/analytics-deletions',
    'a due row: one call to /functions/v1/analytics-deletions');
  ok(c.headers.Authorization === `Bearer ${SECRET}` && JSON.stringify(c.params) === '{}' && !JSON.stringify(c.body).includes(SECRET),
    'the secret is only in the Authorization header');
  await owner(`update vault.decrypted_secrets set decrypted_secret = 'http://fixture-ref.supabase.example' where name = 'functions_url'`);
  await dispatch();
  ok(await calls() === 1, 'a non-https functions_url is refused');
});

console.log(`\n${passed} passed, ${failed} failed`);
