// BE-36 / D43: the lowest-position active question of every active pack is free; every other
// question of a premium pack still raises PREMIUM_REQUIRED. Runs as `authenticated` with a JWT sub.
// Usage: node supabase/tests/free-pack-question.test.mjs   (after `npm --prefix supabase/tests ci`)
import { createDb } from './pglite-supabase.mjs';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0, seq = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const owner = async (sql, args) => {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)");
  return db.query(sql, args);
};
const run = async (role, uid, sql, args) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`);
  try { return await db.query(sql, args); } finally { await db.exec('reset role'); }
};
const start = async (uid, q, role = 'authenticated') => {
  try { return { row: (await run(role, uid, 'select (x).* from (select start_pack_question($1) x) s', [q])).rows[0] }; }
  catch (e) { return { error: e.message }; }
};
const user = async () => {
  const id = `00000000-0000-0000-0000-${String(++seq).padStart(12, '0')}`;
  await owner('insert into auth.users(id) values ($1)', [id]);
  return id;
};
const couple = async (paired = true) => {
  const a = await user();
  const c = (await run('authenticated', a, "select create_couple('dating') c")).rows[0].c;
  const b = paired ? await user() : null;
  if (b) await owner('insert into couple_members(couple_id, user_id) values ($1, $2)', [c, b]);
  return { a, b, c };
};
const premium = (uid, expires = null) => owner(`insert into entitlements(user_id, is_active, expires_at) values ($1, true, $2)
  on conflict(user_id) do update set is_active = true, expires_at = excluded.expires_at`, [uid, expires]);
const question = async body => (await owner("insert into questions(body, sort_order, daily_eligible) values ($1, 900, false) returning id", [body])).rows[0].id;
const pack = async (slug, isPremium, items) => {
  const p = (await owner('insert into question_packs(slug, title, is_premium) values ($1, $1, $2) returning id', [slug, isPremium])).rows[0].id;
  for (const [q, pos] of items) await owner('insert into pack_questions(pack_id, question_id, position) values ($1, $2, $3)', [p, q, pos]);
  return p;
};
const rows = async (c, q) => (await owner('select count(*)::int n from couple_questions where couple_id = $1 and question_id = $2', [c, q])).rows[0].n;

// Premium pack A: positions are not 1-based on purpose (first = lowest, not "position 1").
const q1 = await question('FIXTURE-BE36-A1'), q2 = await question('FIXTURE-BE36-A2'), q3 = await question('FIXTURE-BE36-A3');
await pack('fixture-be36-a', true, [[q2, 20], [q1, 10], [q3, 30]]);
// Free pack F and a second premium pack B (q2 is first of B, second of A).
const f1 = await question('FIXTURE-BE36-F1'), f2 = await question('FIXTURE-BE36-F2');
await pack('fixture-be36-free', false, [[f1, 1], [f2, 2]]);
const b2 = await question('FIXTURE-BE36-B2');
await pack('fixture-be36-b', true, [[q2, 5], [b2, 6]]);
const loose = await question('FIXTURE-BE36-LOOSE');

const free = await couple(), other = await couple();

// ── Free couple: first question of a premium pack ──
let r = await start(free.a, q1);
ok(r.row?.source === 'pack' && r.row.couple_id === free.c && r.row.question_id === q1, 'free couple starts the lowest-position question of a premium pack');
ok(!('assigned_for' in (r.row ?? {})) || r.row.assigned_for === null, 'started pack question has no daily date');
r = await start(free.a, q1);
ok(r.row?.id && await rows(free.c, q1) === 1, 'retry is idempotent (same row, no duplicate)');
r = await start(free.b, q1);
ok(r.row?.couple_id === free.c && await rows(free.c, q1) === 1, 'partner starting the same free question gets the same row');
ok((await start(free.a, q3)).error === 'PREMIUM_REQUIRED', 'free couple: last question of a premium pack → PREMIUM_REQUIRED');
ok((await start(free.a, b2)).error === 'PREMIUM_REQUIRED', 'free couple: second question of pack B → PREMIUM_REQUIRED');

// ── Multi-pack: q2 is second in A but first in B → free (first of ANY active pack) ──
ok((await start(free.a, q2)).row?.question_id === q2, 'question first in one active pack and second in another is free');
await owner("update question_packs set active = false where slug = 'fixture-be36-b'");
ok((await start(other.a, q2)).error === 'PREMIUM_REQUIRED', 'once that pack is inactive, it is only the second question of A → PREMIUM_REQUIRED');
ok((await start(other.a, b2)).error === 'QUESTION_UNAVAILABLE', 'question only in an inactive pack → QUESTION_UNAVAILABLE');
await owner("update question_packs set active = true where slug = 'fixture-be36-b'");

// ── Free pack: every question stays free ──
ok((await start(free.a, f2)).row?.question_id === f2, 'free pack: any question is startable by a free couple');

// ── Inactive questions are ignored when computing "first" ──
await owner('update questions set active = false where id = $1', [q1]);
ok((await start(other.a, q1)).error === 'QUESTION_UNAVAILABLE', 'inactive question → QUESTION_UNAVAILABLE');
await owner("update question_packs set active = false where slug = 'fixture-be36-b'");
ok((await start(other.a, q2)).row?.question_id === q2, 'with q1 inactive, the next active question of A becomes the free one');
ok((await start(other.a, q3)).error === 'PREMIUM_REQUIRED', '…and the rest of A stays premium');
await owner('update questions set active = true where id = $1', [q1]);
await owner("update question_packs set active = true where slug = 'fixture-be36-b'");

// ── Ties on position: exactly one question is free (lowest id) ──
const t1 = await question('FIXTURE-BE36-T1'), t2 = await question('FIXTURE-BE36-T2');
await pack('fixture-be36-tie', true, [[t1, 1], [t2, 1]]);
const [lo, hi] = [t1, t2].sort();
const tie = await couple();
ok((await start(tie.a, lo)).row?.question_id === lo && (await start(tie.a, hi)).error === 'PREMIUM_REQUIRED', 'tied positions: only the lowest question id is free');

// ── Inactive premium pack ──
await owner("update question_packs set active = false where slug = 'fixture-be36-a'");
ok((await start(tie.a, q1)).error === 'QUESTION_UNAVAILABLE', 'first question of an inactive pack → QUESTION_UNAVAILABLE');
ok((await start(free.a, q1)).error === 'QUESTION_UNAVAILABLE', 'retry after the pack is deactivated → QUESTION_UNAVAILABLE (unchanged rule)');
await owner("update question_packs set active = true where slug = 'fixture-be36-a'");
ok((await start(tie.a, loose)).error === 'QUESTION_UNAVAILABLE', 'question in no pack → QUESTION_UNAVAILABLE');

// ── Premium couples unchanged ──
const prem = await couple(), partner = await couple(), expired = await couple();
await premium(prem.a);
ok((await start(prem.a, q3)).row?.question_id === q3, 'premium couple starts any question of a premium pack');
await premium(partner.b);
ok((await start(partner.a, q3)).row?.question_id === q3, 'partner premium covers the caller');
ok((await start(partner.a, q3)).row?.question_id === q3 && await rows(partner.c, q3) === 1, 'premium retry is idempotent');
await premium(expired.b, '2020-01-01T00:00:00Z');
ok((await start(expired.a, q3)).error === 'PREMIUM_REQUIRED', 'expired partner entitlement → PREMIUM_REQUIRED');
ok((await start(expired.a, q1)).row?.question_id === q1, 'expired-premium couple can still start the free first question');

// ── Solo couple: same rules as before (has a couple, not premium) ──
const solo = await couple(false);
ok((await start(solo.a, q1)).row?.couple_id === solo.c, 'solo couple starts the free first question');
ok((await start(solo.a, q3)).error === 'PREMIUM_REQUIRED', 'solo couple: other premium questions → PREMIUM_REQUIRED');

// ── Auth, pairing, isolation ──
const eve = await user();
ok((await start(eve, q1)).error === 'NOT_PAIRED', 'user without a couple → NOT_PAIRED');
ok((await start(null, q1)).error === 'NOT_AUTHENTICATED', 'authenticated role without a subject → NOT_AUTHENTICATED');
ok(/permission denied/.test((await start(null, q1, 'anon')).error ?? ''), 'anon cannot call start_pack_question');
const seen = (await run('authenticated', other.a, 'select count(*)::int n from couple_questions where couple_id = $1', [free.c])).rows[0].n;
ok(seen === 0, "another couple cannot see the free couple's started questions");

// ── Function hygiene ──
const fn = (await owner(`select p.prosecdef d, p.proconfig c,
  has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
  from pg_proc p where p.oid = 'public.start_pack_question(uuid)'::regprocedure`)).rows[0];
ok(fn.d && (fn.c ?? []).some(s => s.startsWith('search_path=')) && !fn.anon && fn.auth, 'SECURITY DEFINER, fixed search_path, anon denied, authenticated granted');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
