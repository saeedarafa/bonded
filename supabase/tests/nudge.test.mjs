// BE-10 / D16: database-enforced nudge eligibility, once per local day and atomic dispatch.
import { createDb } from './pglite-supabase.mjs';
const db = await createDb();
let passed = 0, failed = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'} ${label}`); c ? passed++ : failed++; };
const [A, B, C, D, E, F, G, H] = Array.from({ length: 8 }, (_, i) => `00000000-0000-0000-0000-0000000009${String(i + 1).padStart(2, '0')}`);
await db.query(`insert into auth.users (id) select unnest($1::uuid[])`, [[A, B, C, D, E, F, G, H]]);
const run = async (role, uid, sql, params = []) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errorOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const nudge = async (uid, at) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  return db.query('select private.send_nudge_at($1::timestamptz)', [at]);
};
const pair = async (a, b) => {
  const cid = (await as(a, `select create_couple('dating', '{}', null) id`)).rows[0].id;
  const inv = (await as(a, 'select (i).code, (i).token from (select create_invite() i) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.code, inv.token]);
  return cid;
};
const T0 = '2026-12-10T10:00:00Z';
const count = async (table) => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;

// Capture exactly what would reach BE-08. Isolated PGlite only: no Vault, network or push.
await db.exec(`create table private.nudge_test_events (
  type public.push_type, record_id uuid, couple_id uuid, couple_question_id uuid, actor_user_id uuid
);
create or replace function private.dispatch_notify(p_type public.push_type, p_record_id uuid, p_couple_id uuid, p_couple_question_id uuid, p_actor_user_id uuid)
returns void language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  insert into private.nudge_test_events select $1, $2, $3, $4, $5 where $1 = 'nudge';
$$;`);

ok(/permission denied/.test(await errorOf(() => run('anon', null, 'select send_nudge()')) ?? ''), 'anon cannot call send_nudge');
ok(await errorOf(() => as(null, 'select send_nudge()')) === 'NOT_AUTHENTICATED', 'missing JWT subject → NOT_AUTHENTICATED');
ok(await errorOf(() => as(A, 'select send_nudge()')) === 'NOT_PAIRED', 'unpaired user → NOT_PAIRED');
await as(A, `select create_couple('dating', '{}', null)`);
ok(await errorOf(() => as(A, 'select send_nudge()')) === 'NOT_PAIRED', 'solo user cannot nudge a nonexistent partner');
for (const role of ['anon', 'authenticated']) {
  ok(/permission denied/.test(await errorOf(() => run(role, A, `select * from private.nudge_log`)) ?? ''), `${role} cannot read the nudge ledger`);
  ok(/permission denied/.test(await errorOf(() => run(role, A, `select private.send_nudge_at($1)`, [T0])) ?? ''), `${role} cannot forge the clock through the private core`);
}
ok((await db.query(`select relrowsecurity r from pg_class where oid = 'private.nudge_log'::regclass`)).rows[0].r, 'private nudge ledger has RLS enabled');
ok((await db.query(`select count(*)::int n from information_schema.role_table_grants
  where table_schema = 'private' and table_name = 'nudge_log' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')`)).rows[0].n === 0, 'API roles have no direct ledger privileges');

const ab = await pair(A, B);
const cd = await pair(C, D);
await db.query(`update couples set timezone = 'Europe/Berlin' where id = $1`, [ab]);
await db.query(`update profiles set timezone = 'Pacific/Auckland' where id in ($1, $2)`, [A, B]);
const question = async (cid, date = null) => {
  const q = (await db.query(`insert into questions (body) values ('FIXTURE-NUDGE-Q') returning id`)).rows[0].id;
  return (await db.query(`insert into couple_questions (couple_id, question_id, source, assigned_for)
    values ($1, $2, $3, $4) returning id`, [cid, q, date ? 'daily' : 'pack', date])).rows[0].id;
};
const answer = async (cq, uid) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  return db.query(`insert into answers (couple_question_id, user_id, body) values ($1, $2, 'FIXTURE-NUDGE-ANSWER')`, [cq, uid]);
};
// Answers to yesterday, packs or another couple must not block today's nudge.
await answer(await question(ab, '2026-12-09'), B);
await answer(await question(ab), B);
await answer(await question(cd, '2026-12-10'), D);
await nudge(A, T0);
ok(await count('private.nudge_log') === 1, 'first nudge succeeds even before today has a question; unrelated answers do not block it');
const ledger = (await db.query(`select *, local_date::text d from private.nudge_log`)).rows[0];
ok(ledger.sender_id === A && ledger.recipient_id === B && ledger.couple_id === ab && ledger.d === '2026-12-10', 'ledger is bound to the caller, current partner and couple-local date');
const event = (await db.query('select * from private.nudge_test_events')).rows[0];
ok(event.type === 'nudge' && event.record_id === ledger.id && event.couple_id === ab && event.actor_user_id === A && event.couple_question_id === null, 'dispatch uses the ledger id and Today routing without content');
ok(await errorOf(() => nudge(A, T0)) === 'NUDGE_LIMIT', 'same-input retry → NUDGE_LIMIT');
ok(await count('private.nudge_test_events') === 1 && await count('private.nudge_log') === 1, 'retry causes no duplicate dispatch or ledger row');
ok(await errorOf(() => nudge(A, '2026-12-10T22:59:59Z')) === 'NUDGE_LIMIT', 'one second before couple-local midnight is still the same quota day');
await nudge(A, '2026-12-10T23:00:00Z');
ok(await count('private.nudge_log') === 2, 'quota resets at exact Berlin midnight, before UTC midnight');
await nudge(B, '2026-12-10T23:00:00Z');
ok(await count('private.nudge_log') === 3, 'each sender has their own daily quota');
const dec11 = await question(ab, '2026-12-11');
await answer(dec11, B);
ok(await errorOf(() => nudge(A, '2026-12-11T12:00:00Z')) === 'PARTNER_ALREADY_ANSWERED', 'partner answered today → PARTNER_ALREADY_ANSWERED, before quota check');
ok(await count('private.nudge_test_events') === 3, 'answered-partner refusal cannot dispatch');
await as(A, 'select unpair()');
ok(await errorOf(() => as(A, 'select send_nudge()')) === 'NOT_PAIRED', 'ended couple is not eligible');
ok(await errorOf(() => as(B, 'select send_nudge()')) === 'NOT_PAIRED', 'former partner cannot nudge through the archive');

// A fresh couple cannot bypass a sender's already-used local-date quota.
await as(C, 'select unpair()');
const ac = await pair(A, C);
await db.query(`update couples set timezone = 'Europe/Berlin' where id = $1`, [ac]);
ok(await errorOf(() => nudge(A, '2026-12-11T12:00:00Z')) === 'NUDGE_LIMIT', 'unpairing/re-pairing does not reset the sender daily quota');
await nudge(A, '2026-12-12T12:00:00Z');
ok((await db.query(`select recipient_id from private.nudge_log where couple_id = $1`, [ac])).rows[0].recipient_id === C, 'next day targets only the new current partner');

// DST fall-back has one 25-hour quota day (America/New_York, 2026-11-01).
const ef = await pair(E, F);
await db.query(`update couples set timezone = 'America/New_York' where id = $1`, [ef]);
await nudge(E, '2026-11-01T04:00:00Z');
ok(await errorOf(() => nudge(E, '2026-11-02T04:59:59Z')) === 'NUDGE_LIMIT', 'DST fall-back: 25-hour local day retains the quota');
await nudge(E, '2026-11-02T05:00:00Z');
ok((await db.query('select count(*)::int n from private.nudge_log where sender_id = $1', [E])).rows[0].n === 2, 'DST quota resets at the next local midnight');

// Public wrapper and concurrent submissions: one dispatch, no controllable user/date args.
await pair(G, H);
const outcomes = await Promise.allSettled([as(G, 'select send_nudge()'), as(G, 'select send_nudge()')]);
ok(outcomes.filter(r => r.status === 'fulfilled').length === 1 && outcomes.some(r => r.status === 'rejected' && r.reason.message === 'NUDGE_LIMIT'), 'two queued public calls produce one success and one NUDGE_LIMIT');
ok((await db.query('select count(*)::int n from private.nudge_test_events where actor_user_id = $1', [G])).rows[0].n === 1, 'public retries dispatch only once');

// Dispatch and the ledger commit together; a failed enqueue must leave the quota available.
await db.exec(`create or replace function private.dispatch_notify(p_type public.push_type, p_record_id uuid, p_couple_id uuid, p_couple_question_id uuid, p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin raise exception 'FIXTURE-DISPATCH-FAILED'; end $$;`);
ok(await errorOf(() => nudge(H, T0)) === 'FIXTURE-DISPATCH-FAILED', 'enqueue failure propagates');
ok((await db.query('select count(*)::int n from private.nudge_log where sender_id = $1', [H])).rows[0].n === 0, 'enqueue failure rolls back the quota claim');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
if (failed) process.exitCode = 1;
