// BE-46 / D51 (reverses D43 / BE-36): no pack question is free. start_pack_question raises
// PREMIUM_REQUIRED for every pack question unless the couple is Premium; rows a free couple already
// started under D43 stay answerable and revealable. Runs as `authenticated` with a JWT sub.
// Usage: node supabase/tests/no-free-packs.test.mjs   (after `npm --prefix supabase/tests ci`)
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
const as = (uid, sql, args) => run('authenticated', uid, sql, args);
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
  const c = (await as(a, "select create_couple('dating') c")).rows[0].c;
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
const answer = (uid, cq, body) => as(uid, `insert into answers(couple_question_id, user_id, body) values ($1, $2, $3)
  on conflict (couple_question_id, user_id) do update set body = excluded.body`, [cq, uid, body]);
const visible = async (uid, cq) => (await as(uid, 'select user_id from answers where couple_question_id = $1 order by user_id', [cq])).rows.map(r => r.user_id);

// Premium pack A (positions 1, 2, 3) and a pack flagged is_premium = false (no longer free, D51).
const q1 = await question('FIXTURE-BE46-A1'), q2 = await question('FIXTURE-BE46-A2'), q3 = await question('FIXTURE-BE46-A3');
await pack('fixture-be46-a', true, [[q1, 1], [q2, 2], [q3, 3]]);
const f1 = await question('FIXTURE-BE46-F1');
await pack('fixture-be46-flag-free', false, [[f1, 1]]);
const loose = await question('FIXTURE-BE46-LOOSE');

// ── Free couple: every pack question is PREMIUM_REQUIRED, no row is created ──
const free = await couple();
ok((await start(free.a, q1)).error === 'PREMIUM_REQUIRED', 'free couple: position 1 (former D43 free question) → PREMIUM_REQUIRED');
ok((await start(free.a, q2)).error === 'PREMIUM_REQUIRED', 'free couple: position 2 → PREMIUM_REQUIRED');
ok((await start(free.b, q1)).error === 'PREMIUM_REQUIRED', 'free couple: the partner is denied too');
ok((await start(free.a, f1)).error === 'PREMIUM_REQUIRED', 'free couple: a pack flagged is_premium = false is not free either (D51)');
ok(await rows(free.c, q1) + await rows(free.c, q2) + await rows(free.c, f1) === 0, 'free couple: denied calls create no couple_questions row');

// Solo couple and an expired entitlement are not Premium.
const solo = await couple(false);
ok((await start(solo.a, q1)).error === 'PREMIUM_REQUIRED', 'solo couple: position 1 → PREMIUM_REQUIRED');
const expired = await couple();
await premium(expired.b, '2020-01-01T00:00:00Z');
ok((await start(expired.a, q1)).error === 'PREMIUM_REQUIRED', 'expired partner entitlement: position 1 → PREMIUM_REQUIRED');

// ── Error order unchanged: availability first ──
ok((await start(free.a, loose)).error === 'QUESTION_UNAVAILABLE', 'question in no pack → QUESTION_UNAVAILABLE (not PREMIUM_REQUIRED)');
ok((await start(free.a, '00000000-0000-0000-0000-999999999999')).error === 'QUESTION_UNAVAILABLE', 'unknown id → QUESTION_UNAVAILABLE');
await owner("update question_packs set active = false where slug = 'fixture-be46-a'");
ok((await start(free.a, q1)).error === 'QUESTION_UNAVAILABLE', 'inactive pack → QUESTION_UNAVAILABLE');
await owner("update question_packs set active = true where slug = 'fixture-be46-a'");

// ── Premium couple: allowed on every position, idempotent, either partner entitled ──
const prem = await couple();
await premium(prem.b);
let r = await start(prem.a, q1);
ok(r.row?.source === 'pack' && r.row.couple_id === prem.c && r.row.question_id === q1 && r.row.assigned_for === null, 'premium couple (partner entitled): position 1 starts a pack row');
ok((await start(prem.a, q2)).row?.question_id === q2, 'premium couple: position 2 starts');
ok((await start(prem.a, f1)).row?.question_id === f1, 'premium couple: the is_premium = false pack starts');
ok((await start(prem.b, q1)).row?.id === r.row.id && await rows(prem.c, q1) === 1, 'premium retry by the partner returns the same row, no duplicate');

// ── Rows a free couple already started under D43 stay answerable and revealable ──
// The D43 start is replayed as the row BE-36 created (source = pack, no daily date).
const legacy = await couple();
const cq = (await owner("insert into couple_questions(couple_id, question_id, source) values ($1, $2, 'pack') returning id", [legacy.c, q1])).rows[0].id;
r = await start(legacy.b, q1);
ok(r.row?.id === cq, 'D43 row: start_pack_question returns the existing row to the partner (app opens it the same way)');
ok(await rows(legacy.c, q1) === 1, 'D43 row: no duplicate row');
ok((await start(legacy.a, q2)).error === 'PREMIUM_REQUIRED', 'D43 couple: a new pack question is still PREMIUM_REQUIRED');
await answer(legacy.a, cq, 'FIXTURE-BE46-LEGACY-A');
ok(JSON.stringify(await visible(legacy.b, cq)) === '[]', 'D43 row: reveal rule holds (partner cannot see the answer before answering)');
await answer(legacy.b, cq, 'FIXTURE-BE46-LEGACY-B');
ok((await visible(legacy.a, cq)).length === 2 && (await visible(legacy.b, cq)).length === 2, 'D43 row: free couple answers both sides and both answers reveal');
await answer(legacy.a, cq, 'FIXTURE-BE46-LEGACY-A-EDIT');
ok((await owner('select body from answers where couple_question_id = $1 and user_id = $2', [cq, legacy.a])).rows[0].body === 'FIXTURE-BE46-LEGACY-A-EDIT', 'D43 row: an answer can still be edited');
await as(legacy.a, 'insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, $3)', [cq, legacy.a, 'FIXTURE-BE46-THREAD']);
ok((await as(legacy.b, 'select count(*)::int n from thread_messages where couple_question_id = $1', [cq])).rows[0].n === 1, 'D43 row: the thread works after the reveal');

// A row started while Premium stays usable after the entitlement lapses.
const lapsed = await couple();
await premium(lapsed.a);
const lcq = (await start(lapsed.a, q3)).row?.id;
await premium(lapsed.a, '2020-01-01T00:00:00Z');
ok(lcq && (await start(lapsed.b, q3)).row?.id === lcq, 'lapsed Premium: an already-started row is still returned');
ok((await start(lapsed.b, q2)).error === 'PREMIUM_REQUIRED', 'lapsed Premium: a new pack question → PREMIUM_REQUIRED');
await answer(lapsed.a, lcq, 'FIXTURE-BE46-LAPSED-A');
await answer(lapsed.b, lcq, 'FIXTURE-BE46-LAPSED-B');
ok((await visible(lapsed.b, lcq)).length === 2, 'lapsed Premium: the started row is answered and revealed');

// ── Auth, pairing, isolation ──
const eve = await user();
ok((await start(eve, q1)).error === 'NOT_PAIRED', 'user without a couple → NOT_PAIRED');
ok((await start(null, q1)).error === 'NOT_AUTHENTICATED', 'authenticated role without a subject → NOT_AUTHENTICATED');
ok(/permission denied/.test((await start(null, q1, 'anon')).error ?? ''), 'anon cannot call start_pack_question');
ok((await start(free.a, q1)).error === 'PREMIUM_REQUIRED' && await rows(free.c, q1) === 0, "another couple's started row does not unlock the question for a free couple");
ok((await as(free.a, 'select count(*)::int n from couple_questions where couple_id = $1', [legacy.c])).rows[0].n === 0, "a free couple cannot see another couple's started rows");

// ── Function hygiene ──
const fn = (await owner(`select p.prosecdef d, p.proconfig c,
  has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
  from pg_proc p where p.oid = 'public.start_pack_question(uuid)'::regprocedure`)).rows[0];
ok(fn.d && (fn.c ?? []).some(s => s.startsWith('search_path=')) && !fn.anon && fn.auth, 'SECURITY DEFINER, fixed search_path, anon denied, authenticated granted');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
