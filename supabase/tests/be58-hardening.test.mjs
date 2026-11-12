// BE-58: hardening from SEC-18 (#330) and QA #307.
// (a) pack_questions rows are readable by signed-in users only while their pack is active; anon reads nothing.
// (b) get_daily_question never returns an all-null row when the couple already has the first_day question:
//     it falls through to the normal daily pick (or raises LIBRARY_EXHAUSTED).
// Runs as `authenticated` / `anon` with a JWT sub, like rls.test.mjs.
// Usage: node supabase/tests/be58-hardening.test.mjs   (after `npm --prefix supabase/tests ci`)
// Without this task's migration (to show the tests fail): BE58_WITHOUT=1 node supabase/tests/be58-hardening.test.mjs
import { createDb, defaultMigrations } from './pglite-supabase.mjs';

const files = process.env.BE58_WITHOUT ? defaultMigrations().filter(f => !f.includes('_be58_hardening')) : defaultMigrations();
let db;
try { db = await createDb(files); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
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
const errorOf = async (role, uid, sql, args) => {
  try { await run(role, uid, sql, args); return null; } catch (e) { return e.message; }
};
const user = async () => {
  const id = `00000000-0000-0000-0058-${String(++seq).padStart(12, '0')}`;
  await owner('insert into auth.users(id) values ($1)', [id]);
  return id;
};
const couple = async () => {
  const a = await user();
  const c = (await as(a, "select create_couple('dating') c")).rows[0].c;
  const b = await user();
  await owner('insert into couple_members(couple_id, user_id) values ($1, $2)', [c, b]);
  return { a, b, c };
};
const question = async (body, sort, opts = {}) => (await owner(
  `insert into questions(body, sort_order, daily_eligible, special) values ($1, $2, $3, $4) returning id`,
  [body, sort, opts.daily ?? false, opts.special ?? null])).rows[0].id;
const pack = async (slug, active, items) => {
  const p = (await owner('insert into question_packs(slug, title, is_premium, active) values ($1, $1, true, $2) returning id', [slug, active])).rows[0].id;
  for (const [q, pos] of items) await owner('insert into pack_questions(pack_id, question_id, position) values ($1, $2, $3)', [p, q, pos]);
  return p;
};
const packRows = async (role, uid, p) => {
  try { return (await run(role, uid, 'select count(*)::int n from pack_questions where pack_id = $1', [p])).rows[0].n; }
  catch (e) { return `error: ${e.message}`; }
};
const daily = async uid => (await as(uid, 'select (x).* from (select get_daily_question() x) s')).rows[0];
const isAllNull = row => row && Object.values(row).every(v => v === null);

// ── Content fixture ──
// first_day special (not daily-eligible) and three daily questions, sorted before anything else.
let firstDay = (await owner("select id from questions where special = 'first_day' and active limit 1")).rows[0]?.id;
if (!firstDay) firstDay = await question('FIXTURE-BE58-FIRST-DAY', -1000, { special: 'first_day' });
const d1 = await question('FIXTURE-BE58-D1', -900, { daily: true });
const d2 = await question('FIXTURE-BE58-D2', -899, { daily: true });
const p1 = await question('FIXTURE-BE58-P1', 900), p2 = await question('FIXTURE-BE58-P2', 901), p3 = await question('FIXTURE-BE58-P3', 902);
const activePack = await pack('fixture-be58-active', true, [[p1, 1], [p2, 2]]);
const inactivePack = await pack('fixture-be58-inactive', false, [[p3, 1], [p1, 2]]);

// ═══ (a) pack_questions follows the pack's active flag ═══
const pair = await couple();
const solo = await user();
ok(await packRows('authenticated', pair.a, activePack) === 2, '(a) paired member: both rows of an active pack are visible');
ok(await packRows('authenticated', solo, activePack) === 2, '(a) signed-in user without a couple: active pack rows visible (unchanged)');
ok(await packRows('authenticated', pair.a, inactivePack) === 0, '(a) paired member: rows of an inactive pack are invisible');
ok(await packRows('authenticated', solo, inactivePack) === 0, '(a) signed-in user without a couple: rows of an inactive pack are invisible');
ok((await as(pair.a, 'select count(*)::int n from pack_questions where question_id = $1', [p3])).rows[0].n === 0,
  '(a) a question only in an inactive pack cannot be found through pack_questions');
ok((await as(pair.a, 'select count(*)::int n from pack_questions where question_id = $1', [p1])).rows[0].n === 1,
  '(a) a question in an active and an inactive pack: only the active pack row is visible');
const anonActive = await packRows('anon', null, activePack), anonInactive = await packRows('anon', null, inactivePack);
ok(anonActive === 0 || String(anonActive).startsWith('error:'), `(a) anon reads no active pack rows (${anonActive})`);
ok(anonInactive === 0 || String(anonInactive).startsWith('error:'), `(a) anon reads no inactive pack rows (${anonInactive})`);

// The app's embed query: inactive packs and their items do not appear at all.
const embed = (await as(pair.a, `select slug, (select count(*)::int from pack_questions pq where pq.pack_id = p.id) n
  from question_packs p where slug like 'fixture-be58-%' order by slug`)).rows;
ok(embed.length === 1 && embed[0].slug === 'fixture-be58-active' && embed[0].n === 2, '(a) pack list + items: only the active pack and its 2 items');

// Toggling the pack toggles its rows.
await owner('update question_packs set active = false where id = $1', [activePack]);
ok(await packRows('authenticated', pair.a, activePack) === 0, '(a) pack deactivated: its rows disappear');
await owner('update question_packs set active = true where id = $1', [activePack]);
ok(await packRows('authenticated', pair.a, activePack) === 2, '(a) pack reactivated: its rows are back');
await owner('update question_packs set active = true where id = $1', [inactivePack]);
ok(await packRows('authenticated', pair.a, inactivePack) === 2, '(a) a launched pack: its rows become visible');
await owner('update question_packs set active = false where id = $1', [inactivePack]);

// Writes stay denied; owner sees everything.
ok(await errorOf('authenticated', pair.a, 'insert into pack_questions(pack_id, question_id, position) values ($1, $2, 9)', [activePack, d2]) !== null,
  '(a) authenticated cannot insert pack_questions');
const upd = await errorOf('authenticated', pair.a, 'update pack_questions set position = 7 where pack_id = $1', [activePack]);
ok(upd !== null || (await owner('select count(*)::int n from pack_questions where position = 7')).rows[0].n === 0, '(a) authenticated cannot update pack_questions');
ok((await owner('select count(*)::int n from pack_questions where pack_id = any($1)', [[activePack, inactivePack]])).rows[0].n === 4, '(a) owner still sees all 4 rows');

const pol = (await owner(`select policyname, roles::text r, cmd, qual from pg_policies where tablename = 'pack_questions'`)).rows;
ok(pol.length === 1 && pol[0].cmd === 'SELECT' && pol[0].r === '{authenticated}' && pol[0].qual !== 'true' && /active/.test(pol[0].qual),
  `(a) one SELECT policy, authenticated only, scoped to active packs (${JSON.stringify(pol.map(p => [p.policyname, p.qual]))})`);

// ═══ (b) get_daily_question with the first_day question already taken ═══
// Regression: an untouched couple still gets first_day on day 1.
const fresh = await couple();
const r0 = await daily(fresh.a);
ok(r0?.question_id === firstDay && r0.source === 'daily' && r0.assigned_for !== null, '(b) fresh couple: day 1 is first_day (D12 unchanged)');
ok((await daily(fresh.b)).id === r0.id, '(b) the partner gets the same row');

// QA #307: the couple already has the first_day question (as a pack row).
const taken = await couple();
await owner("insert into couple_questions(couple_id, question_id, source) values ($1, $2, 'pack')", [taken.c, firstDay]);
let r1, e1 = null;
try { r1 = await daily(taken.a); } catch (e) { e1 = e.message; }
ok(e1 === null && !isAllNull(r1) && r1?.id, `(b) first_day already used: a real row, not an all-null row (${e1 ?? JSON.stringify(r1)})`);
ok(r1?.question_id === d1 && r1.source === 'daily' && r1.couple_id === taken.c && r1.assigned_for !== null,
  '(b) it falls through to the normal pick (first daily-eligible question)');
const r1b = await daily(taken.b);
ok(r1?.id && r1b?.id === r1.id,'(b) idempotent: the partner and a repeat call get the same row');
ok(r1?.id && (await daily(taken.a))?.id === r1.id,'(b) a repeat call by the same member returns it again');
ok((await owner("select count(*)::int n from couple_questions where couple_id = $1 and source = 'daily'", [taken.c])).rows[0].n === 1,
  '(b) exactly one daily row was created');
// The answer path QA saw failing now works (couple_question_id is not null).
let ans = null;
try { await as(taken.b, 'insert into answers(couple_question_id, user_id, body) values ($1, $2, $3)', [r1?.id, taken.b, 'fixture']); }
catch (e) { ans = e.message; }
ok(ans === null, `(b) the member can answer the returned row (${ans})`);

// first_day taken and the daily library empty: an error code, never an all-null row.
const empty = await couple();
await owner("insert into couple_questions(couple_id, question_id, source) values ($1, $2, 'pack')", [empty.c, firstDay]);
await owner('update questions set active = false where daily_eligible');
let r2 = null, e2 = null;
try { r2 = await daily(empty.a); } catch (e) { e2 = e.message; }
ok(e2 === 'LIBRARY_EXHAUSTED', `(b) first_day used and no daily question left → LIBRARY_EXHAUSTED (${e2 ?? JSON.stringify(r2)})`);
await owner('update questions set active = true where id = any($1)', [[d1, d2]]);

// Function properties are unchanged.
const fn = (await owner(`select p.prosecdef d, p.proconfig c,
    has_function_privilege('authenticated', 'private.get_daily_question_at(timestamptz)', 'execute') a,
    has_function_privilege('authenticated', 'public.get_daily_question()', 'execute') pub,
    has_function_privilege('anon', 'public.get_daily_question()', 'execute') an
  from pg_proc p where p.oid = 'private.get_daily_question_at(timestamptz)'::regprocedure`)).rows[0];
ok(fn.d && fn.c.some(s => s.startsWith('search_path=')) && !fn.a && fn.pub && !fn.an,
  '(b) private.get_daily_question_at stays definer with search_path and no client grant; public wrapper: authenticated only');
ok(await errorOf('anon', null, 'select get_daily_question()') !== null, '(b) anon cannot call get_daily_question');

console.log(`\n${passed} passed, ${failed} failed`);
