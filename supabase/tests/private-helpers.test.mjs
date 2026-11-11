// BE-24: the 0001 SECURITY DEFINER helpers live in `private`, not in the exposed API, and the
// RLS policies that use them still work.
// Usage: node supabase/tests/private-helpers.test.mjs   (after `npm --prefix supabase/tests ci`)
import fs from 'fs';
import path from 'path';
import { createDb, supabaseDir } from './pglite-supabase.mjs';

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

const HELPERS = [
  ['my_couple_id', '', []],
  ['is_cq_member', 'uuid', ['cq']],
  ['has_answered', 'uuid', ['cq']],
  ['both_answered', 'uuid', ['cq']],
  ['answer_cq', 'uuid', ['answer']],
  ['message_cq', 'uuid', ['message']],
  ['is_couple_premium', 'uuid', ['couple']],
];

// ── Catalogue: helpers moved, nothing left in public ──
const where = async name => (await db.query(`select n.nspname s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = $1`, [name])).rows.map(r => r.s);
for (const [name] of HELPERS) {
  const s = await where(name);
  ok(s.length === 1 && s[0] === 'private', `${name} lives only in private${s.join(',') === 'private' ? '' : ` (found in ${s})`}`);
}
const config = fs.readFileSync(path.join(supabaseDir, 'config.toml'), 'utf8');
const schemasLine = config.split('\n').find(l => /^schemas\s*=/.test(l)) ?? '';
ok(schemasLine && !schemasLine.includes('private'), `private is not an API schema (${schemasLine.trim()})`);

// Every SECURITY DEFINER function left in public is a contract RPC, a service-role-only wrapper, or a trigger function.
const allowedDefiners = ['accept_invite', 'apply_revenuecat_event', 'approve_join', 'claim_offer_screen', 'claim_push', 'claim_revenuecat_sync', 'create_couple', 'create_invite', 'decline_join', 'due_offer_endings', 'due_reminders', 'due_trial_endings', 'due_weekly_recaps', 'get_daily_question', 'get_offer', 'get_streak', 'invite_link', 'invite_preview', 'invite_preview_for_link', 'little_things_today', 'open_offer', 'pending_join_requests', 'register_push_token', 'send_little_thing', 'send_nudge', 'start_pack_question', 'start_voice_upload', 'undo_little_thing', 'unpair', 'unread_thread_counts', 'use_streak_saver', 'voice_objects_of_user', 'voice_sweep', 'weekly_recap'];
const definers = (await db.query(`select p.proname, p.prorettype = 'trigger'::regtype as trig from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef`)).rows;
const stray = definers.filter(r => !r.trig && !allowedDefiners.includes(r.proname)).map(r => r.proname);
ok(stray.length === 0, `public SECURITY DEFINER functions are contract RPCs, service-only wrappers, or triggers only${stray.length ? ` (stray: ${stray})` : ''}`);

// Every policy that used a helper now points at private.*, none at a public name.
const quals = (await db.query(`select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') q from pg_policies where schemaname = 'public'`)).rows;
const publicRefs = quals.filter(r => HELPERS.some(([n]) => new RegExp(`public\\.${n}\\(`).test(r.q))).map(r => r.policyname);
ok(publicRefs.length === 0, `no policy references a public helper${publicRefs.length ? ` (${publicRefs})` : ''}`);
ok(quals.filter(r => /private\./.test(r.q)).length >= 10, 'policies reference the private helpers');

// Grants: anon has no EXECUTE; authenticated keeps EXECUTE (policies run as the caller) but no USAGE on the schema.
for (const [name, sig] of HELPERS) {
  const r = (await db.query(`select has_function_privilege('anon', 'private.${name}(${sig})', 'execute') a,
    has_function_privilege('authenticated', 'private.${name}(${sig})', 'execute') u`)).rows[0];
  ok(!r.a && r.u, `${name}: anon no EXECUTE, authenticated EXECUTE (for policies)`);
}
const usage = (await db.query(`select has_schema_privilege('anon', 'private', 'usage') a, has_schema_privilege('authenticated', 'private', 'usage') u`)).rows[0];
ok(!usage.a && !usage.u, 'anon and authenticated have no USAGE on schema private');

// ── Fixtures: couple A+B with a revealed answer, thread message; couple C+D; E unpaired ──
const U = n => `00000000-0000-0000-0000-0000000001${n}`;
const [A, B, C, D, E] = ['0a', '0b', '0c', '0d', '0e'].map(U);
await db.exec(`insert into auth.users (id) values ${[A, B, C, D, E].map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) values ('PH-Q1', 1), ('PH-Q2', 2);`);
const pair = async (x, y) => {
  await as(x, `select create_couple('dating', '{}', null)`);
  const invite = (await as(x, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  return (await as(y, 'select accept_invite($1, $2, true) c', [invite.c, invite.t])).rows[0].c;
};
const coupleAB = await pair(A, B);
const coupleCD = await pair(C, D);
await db.exec(`insert into entitlements (user_id, is_active) values ('${A}', true)`);
const cq = (await as(A, 'select (get_daily_question()).id')).rows[0].id;
const answer = (await as(A, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'PH-A') returning id`, [cq, A])).rows[0].id;
ok((await as(B, 'select * from answers')).rows.length === 0, 'reveal rule: B cannot see A\'s answer before answering');
await as(B, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'PH-B')`, [cq, B]);
ok((await as(B, 'select * from answers')).rows.length === 2, 'reveal rule: B sees both after answering');
const message = (await as(A, `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, 'PH-M') returning id`, [cq, A])).rows[0].id;
ok((await as(B, 'select * from thread_messages')).rows.length === 1, 'thread policy (private.both_answered) works');
await as(B, `insert into reactions (user_id, message_id, kind) values ($1, $2, '😂')`, [B, message]);
ok((await as(A, 'select * from reactions where message_id = $1', [message])).rows.length === 1, 'reaction on a message (private.message_cq) works');
await as(A, `insert into reactions (user_id, answer_id, kind) values ($1, $2, '😮')`, [A, answer]);
ok((await as(B, 'select * from reactions where answer_id = $1', [answer])).rows.length === 1, 'reaction on an answer (private.answer_cq) works');
ok((await as(C, 'select * from reactions')).rows.length === 0, 'other couple sees no reactions');
ok((await as(C, 'select * from answers')).rows.length === 0 && (await as(C, 'select * from thread_messages')).rows.length === 0, 'other couple sees no answers or messages');
ok(/row-level security/.test(await errorOf('authenticated', C, `insert into reactions (user_id, answer_id, kind) values ($1, $2, '🔥')`, [C, answer]) ?? ''), 'other couple cannot react');
ok((await as(B, 'select count(*)::int n from profiles')).rows[0].n === 2, 'profiles policy (private.my_couple_id) works');
ok((await as(C, 'select id from couples')).rows.map(r => r.id).join() === coupleCD, 'couples policy scopes to own couple');

// ── Calls from the API roles: other couple (C), unpaired (E), anon ──
const argFor = { cq, answer, message, couple: coupleAB };
for (const [name, , kinds] of HELPERS) {
  const args = kinds.map((_, i) => `$${i + 1}`).join(', ');
  const params = kinds.map(k => argFor[k]);
  for (const [role, uid, who] of [['authenticated', C, 'other couple'], ['authenticated', E, 'unpaired user'], ['anon', null, 'anon']]) {
    const priv = await errorOf(role, uid, `select private.${name}(${args})`, params);
    ok(/permission denied for schema private/.test(priv ?? ''), `${who} cannot call private.${name}${priv ? '' : ' (call succeeded)'}`);
    const pub = await errorOf(role, uid, `select public.${name}(${args})`, params);
    ok(/does not exist/.test(pub ?? ''), `${who}: public.${name} is gone (no RPC)`);
  }
}

// ── RPCs that use the helpers still behave ──
ok((await as(C, 'select (get_daily_question()).id')).rows[0].id, 'get_daily_question works for another couple');
ok((await errorOf('authenticated', A, 'select create_invite()')) === 'COUPLE_FULL', 'create_invite still sees my_couple_id');
ok((await errorOf('authenticated', E, 'select unpair()')) === 'NOT_PAIRED', 'unpair still sees my_couple_id');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
