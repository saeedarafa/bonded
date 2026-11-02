// RLS + RPC behaviour tests, run in PGlite (Postgres in WASM) with Supabase auth stand-ins. No Docker needed.
// Usage (from the repo root):
//   npm --prefix supabase/tests ci
//   node supabase/tests/rls.test.mjs                       # MVP: every file in supabase/migrations/, in order
//   node supabase/tests/rls.test.mjs supabase/migrations/*.sql supabase/migrations_phase2/*.sql   # plus the AI phase
// Exits non-zero if any check fails.
import path from 'path';
import { createDb, defaultMigrations } from './pglite-supabase.mjs';

const files = process.argv.length > 2 ? process.argv.slice(2) : defaultMigrations();
let db;
try { db = await createDb(files); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const aiPhase = (await db.query(`select to_regclass('public.ai_jobs') is not null as on`)).rows[0].on;
console.log(`applied ${files.map(f => path.basename(f)).join(', ')}${aiPhase ? ' (AI phase on)' : ''}`);

const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', C = '00000000-0000-0000-0000-00000000000c';
await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
  insert into questions (body, sort_order) values ('Q1', 1), ('Q2', 2);
  insert into questions (body, sort_order, is_premium) values ('PremiumQ', 0, true);
  insert into question_packs (slug, title) values ('deep', 'Deep');
  insert into pack_questions select (select id from question_packs), id, 1 from questions where body = 'Q2';`);
ok((await db.query('select count(*)::int n from profiles')).rows[0].n === 3, 'profiles auto-created on sign-up');

const as = async (uid, sql, params) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const fails = async (uid, sql, params) => { try { await as(uid, sql, params); return false; } catch { return true; } };

await as(A, `select create_couple('dating', '{}', 'B')`);  // solo couple first (D03)
const code = (await as(A, 'select (create_invite()).code c')).rows[0].c;
ok(/^[0-9]{4}$/.test(code), `invite code generated: 4 digits (${code})`);
ok(await fails(A, 'select accept_invite($1)', [code]), 'cannot accept own invite');
await as(B, 'select accept_invite($1)', ['bnd·' + code]);
// A used code is answered with the error body (a counted failure, see invites-v2.test.mjs), not a join.
ok((await as(C, 'select accept_invite($1) j', [code])).rows[0].j.message === 'COUPLE_FULL', 'used invite rejected');
ok((await as(C, 'select count(*)::int n from couple_members')).rows[0].n === 0, 'rejected joiner is in no couple');

const d1 = (await as(A, 'select (get_daily_question()).*')).rows[0];
const d2 = (await as(B, 'select (get_daily_question()).*')).rows[0];
ok(d1.id === d2.id, 'both partners get the same daily question');
ok((await db.query('select body from questions where id=$1', [d1.question_id])).rows[0].body === 'Q1', 'free couple skips premium question');
ok(await fails(C, 'select get_daily_question()'), 'unpaired user cannot get a daily question');

await as(A, 'insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)', [d1.id, A, 'A answer']);
ok((await as(B, 'select * from answers')).rows.length === 0, 'B cannot see A\'s answer before answering');
ok((await as(B, 'select answer_count from couple_questions where id=$1', [d1.id])).rows[0].answer_count === 1, 'B sees answer_count=1 (partner answered signal)');
ok((await as(C, 'select * from answers')).rows.length === 0, 'outsider sees nothing');
ok(await fails(C, 'insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)', [d1.id, C, 'x']), 'outsider cannot answer');
ok(await fails(A, 'insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, $3)', [d1.id, A, 'hi']), 'thread closed until both answered');

await as(B, 'insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)', [d1.id, B, 'B answer']);
ok((await as(B, 'select * from answers')).rows.length === 2, 'B sees both answers after answering');
ok((await as(A, 'select current from couple_streaks')).rows[0].current === 1, 'streak = 1 after both answered');
await as(A, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'A edited') on conflict (couple_question_id, user_id) do update set body = excluded.body`, [d1.id, A]);
ok((await as(B, 'select body from answers where user_id=$1', [A])).rows[0].body === 'A edited', 'upsert edits answer (idempotent retry)');
const cid = '11111111-1111-1111-1111-111111111111';
await as(A, 'insert into thread_messages (client_id, couple_question_id, user_id, body) values ($1, $2, $3, $4)', [cid, d1.id, A, 'hi']);
ok(await fails(A, 'insert into thread_messages (client_id, couple_question_id, user_id, body) values ($1, $2, $3, $4)', [cid, d1.id, A, 'hi']), 'duplicate client_id rejected');
ok((await as(B, 'select * from thread_messages')).rows.length === 1, 'partner reads thread');
const ans = (await as(B, 'select id from answers where user_id=$1', [A])).rows[0].id;
await as(B, 'insert into reactions (user_id, answer_id, emoji) values ($1, $2, $3)', [B, ans, '❤️']);
ok((await as(A, 'select * from reactions')).rows.length === 1, 'reaction visible to partner');

ok(await fails(A, 'select start_pack_question(id) from questions where body = $1', ['Q2']), 'premium pack blocked for free couple');
await db.exec(`insert into entitlements (user_id, is_active) values ('${B}', true)`);
const pq = (await as(A, `select (start_pack_question(id)).* from questions where body = 'Q2'`)).rows[0];
ok(pq && pq.source === 'pack', 'partner B subscription unlocks pack for A');

if (aiPhase) await db.exec(`insert into ai_consents (user_id, profile_analysis) values ('${A}', true)`);
await as(A, 'insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)', [pq.id, A, 'pack answer']);
await as(B, 'insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)', [pq.id, B, 'pack answer B']);
ok((await as(A, 'select * from answers where couple_question_id = $1', [pq.id])).rows.length === 2, 'pack question answered by both partners');
if (aiPhase) {
  ok((await db.query(`select count(*)::int n from ai_jobs where kind = 'analyze_answer'`)).rows[0].n === 1, 'AI job queued only for consenting user');
  ok((await as(A, 'select * from ai_jobs')).rows.length === 0, 'clients cannot read ai_jobs');
}

await as(A, 'select unpair()');
ok((await db.query('select count(*)::int n from couple_members')).rows[0].n === 0 && (await db.query('select count(*)::int n from answers')).rows[0].n === 0, 'unpair removes couple data');
await db.close();
console.log(`\n${passed} passed, ${failed} failed`);
