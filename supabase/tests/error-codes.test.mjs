// BE-02: every live RPC raises exactly the codes in CONTRACTS §2 (D05, D16, D18).
// Usage: node supabase/tests/error-codes.test.mjs   (after `npm --prefix supabase/tests ci`)
// Time-dependent cases pin timestamps explicitly; nothing asserts on now().
import fs from 'fs';
import path from 'path';
import { createDb, supabaseDir } from './pglite-supabase.mjs';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };

// Run as an API role. uid null = no JWT subject.
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
// Returns the error message, or null when the call succeeded.
const errorOf = async (role, uid, sql, params) => {
  try { await run(role, uid, sql, params); return null; } catch (e) { return e.message; }
};
const raises = async (code, uid, sql, params, label) => {
  const got = await errorOf('authenticated', uid, sql, params);
  ok(got === code, `${label} → ${code}${got === code ? '' : ` (got ${got})`}`);
};
const anonDenied = async (sql, label) => {
  const got = await errorOf('anon', null, sql);
  ok(/permission denied/.test(got ?? ''), `${label}: anon denied`);
};

const U = n => `00000000-0000-0000-0000-0000000000${n}`;
const [MAYA, SAM, EVE, ZOE, LEO, MIA, IVY] = ['01', '02', '03', '04', '05', '06', '07'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, ZOE, LEO, MIA, IVY].map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) values ('FIXTURE-Q1', 1), ('FIXTURE-Q2', 2), ('FIXTURE-LOOSE', 3);
  insert into questions (body, sort_order, daily_eligible) values ('FIXTURE-PACKQ', 4, false);
  insert into question_packs (slug, title, is_premium) values ('fixture-premium', 'Premium', true);
  insert into pack_questions select p.id, q.id, 1 from question_packs p, questions q where p.slug = 'fixture-premium' and q.body = 'FIXTURE-PACKQ';`);
const qid = async body => (await db.query('select id from questions where body = $1', [body])).rows[0].id;

// ── Catalogue: enum == CONTRACTS §2 complete list ──
const contracts = fs.readFileSync(path.join(supabaseDir, '..', 'docs', 'CONTRACTS.md'), 'utf8');
const listLine = contracts.split('\n').find(l => l.includes('Complete list:')) ?? '';
const documented = [...listLine.slice(listLine.indexOf('Complete list:')).matchAll(/`([A-Z_]+)`/g)].map(m => m[1]).sort();
const catalogued = (await db.query(`select unnest(enum_range(null::public.error_code))::text c`)).rows.map(r => r.c).sort();
ok(documented.length > 0 && JSON.stringify(documented) === JSON.stringify(catalogued),
  `error_code enum matches CONTRACTS §2 (${catalogued.length} codes)${JSON.stringify(documented) === JSON.stringify(catalogued) ? '' : `: doc ${documented} vs db ${catalogued}`}`);
const decided = ['INVALID_CODE', 'INVITE_EXPIRED', 'COUPLE_FULL', 'OWN_CODE', 'ALREADY_PAIRED', 'RATE_LIMITED', // D05
  'NUDGE_LIMIT', // D16
  'PREMIUM_REQUIRED', 'SAVER_UNAVAILABLE']; // D18
const missing = decided.filter(c => !catalogued.includes(c));
ok(missing.length === 0, `D05, D16, D18 codes all catalogued${missing.length ? ` (missing ${missing})` : ''}`);

// ── Helper: message is exactly the code, SQLSTATE P0001; not callable from the API ──
try { await db.query(`select private.raise_error('NUDGE_LIMIT')`); ok(false, 'raise_error raises'); }
catch (e) { ok(e.message === 'NUDGE_LIMIT' && e.code === 'P0001', 'raise_error: message = code, SQLSTATE P0001'); }
try { await db.query(`select private.raise_error('NOT_A_CODE')`); ok(false, 'unknown code rejected'); }
catch (e) { ok(/invalid input value for enum/.test(e.message), 'raise_error rejects a code outside the catalogue'); }
ok(/permission denied/.test(await errorOf('authenticated', MAYA, `select private.raise_error('NOT_PAIRED')`) ?? ''), 'authenticated cannot call private.raise_error');
ok(/permission denied/.test(await errorOf('anon', null, `select private.raise_error('NOT_PAIRED')`) ?? ''), 'anon cannot call private.raise_error');

// ── No public function raises free text any more; definer functions pin search_path ──
const freeText = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ~* 'raise\\s+exception\\s+'''`)).rows.map(r => r.proname);
ok(freeText.length === 0, `no public function raises a free-text message${freeText.length ? ` (${freeText})` : ''}`);
const noPath = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')`)).rows.map(r => r.proname);
ok(noPath.length === 0, `every SECURITY DEFINER function sets search_path${noPath.length ? ` (${noPath})` : ''}`);

// ── anon is denied every live RPC (only invite_preview will allow anon, BE-04) ──
await anonDenied(`select create_couple('dating', '{}', null)`, 'create_couple');
await anonDenied('select create_invite()', 'create_invite');
await anonDenied(`select accept_invite('ABCDEF')`, 'accept_invite');
await anonDenied('select get_daily_question()', 'get_daily_question');
await anonDenied(`select start_pack_question('${U('99')}')`, 'start_pack_question');
await anonDenied('select unpair()', 'unpair');

// ── NOT_AUTHENTICATED: authenticated role without a subject ──
for (const [sql, label] of [[`select create_couple('dating', '{}', null)`, 'create_couple'], ['select create_invite()', 'create_invite'], [`select accept_invite('ABCDEF')`, 'accept_invite'],
  ['select get_daily_question()', 'get_daily_question'], [`select start_pack_question('${U('99')}')`, 'start_pack_question'], ['select unpair()', 'unpair']]) {
  await raises('NOT_AUTHENTICATED', null, sql, [], `${label} without a session`);
}

// ── NOT_PAIRED ──
await raises('NOT_PAIRED', EVE, 'select get_daily_question()', [], 'get_daily_question unpaired');
await raises('NOT_PAIRED', EVE, 'select start_pack_question($1)', [await qid('FIXTURE-PACKQ')], 'start_pack_question unpaired');
await raises('NOT_PAIRED', EVE, 'select unpair()', [], 'unpair unpaired');
await raises('NOT_PAIRED', EVE, 'select create_invite()', [], 'create_invite without a couple (create_couple first)');

// ── accept_invite (D05) ──
// An inviter has a (solo) couple first (D03); create_couple is idempotent, so calling it again is fine.
const invite = async uid => {
  await as(uid, `select create_couple('dating', '{}', null)`);
  return (await as(uid, 'select create_invite() c')).rows[0].c;
};
const mayaCode = await invite(MAYA);
await raises('INVALID_CODE', SAM, 'select accept_invite($1)', ['ZZZZZZ'], 'accept_invite unknown code');
await raises('INVALID_CODE', SAM, 'select accept_invite($1)', [''], 'accept_invite empty code');
await raises('OWN_CODE', MAYA, 'select accept_invite($1)', [mayaCode], 'accept_invite own code');
// Expiry with pinned timestamps (past, then far future); no assertion depends on now().
await db.query(`update pair_invites set expires_at = '2026-01-01T00:00:00Z' where code = $1`, [mayaCode]);
await raises('INVITE_EXPIRED', SAM, 'select accept_invite($1)', [mayaCode], 'accept_invite expired code');
await db.query(`update pair_invites set expires_at = '2099-01-01T00:00:00Z' where code = $1`, [mayaCode]);
ok((await as(SAM, 'select accept_invite($1) c', [` ${mayaCode.toLowerCase()} `])).rows[0].c, 'accept_invite valid code (case and spaces ignored)');
await raises('ALREADY_PAIRED', SAM, 'select accept_invite($1)', [mayaCode], 'accept_invite retry by the joiner');
await raises('COUPLE_FULL', EVE, 'select accept_invite($1)', [mayaCode], 'accept_invite used code');
await raises('ALREADY_PAIRED', MAYA, 'select accept_invite($1)', ['ZZZZZZ'], 'accept_invite while paired (checked before the code)');
// Inviter with two open invites: once one is used, the other leads to a full couple.
const zoeCode = await invite(ZOE);
const zoeCode2 = await invite(ZOE);
await as(LEO, 'select accept_invite($1)', [zoeCode2]);
await raises('COUPLE_FULL', MIA, 'select accept_invite($1)', [zoeCode], 'accept_invite inviter\'s couple already full');
// Until D04 (BE-04), a user with a solo couple can't accept an invite.
await as(IVY, `select create_couple('dating', '{}', null)`);
await raises('ALREADY_PAIRED', IVY, 'select accept_invite($1)', [zoeCode], 'accept_invite by a solo user (D04 relaxes this in BE-04)');
await as(IVY, 'select unpair()');
// A used code stays COUPLE_FULL even after it expired.
await db.query(`update pair_invites set expires_at = '2026-01-01T00:00:00Z' where code = $1`, [mayaCode]);
await raises('COUPLE_FULL', EVE, 'select accept_invite($1)', [mayaCode], 'accept_invite used and expired code');
ok((await db.query('select count(*)::int n from couple_members')).rows[0].n === 4, 'failed accepts created no members');

// ── create_invite ──
await raises('COUPLE_FULL', MAYA, 'select create_invite()', [], 'create_invite while paired');

// ── create_couple ──
await raises('ALREADY_PAIRED', SAM, `select create_couple('dating', '{}', null)`, [], 'create_couple by a member of a full couple');

// ── start_pack_question (D18 PREMIUM_REQUIRED) ──
await raises('QUESTION_UNAVAILABLE', MAYA, 'select start_pack_question($1)', [await qid('FIXTURE-LOOSE')], 'start_pack_question not in any pack');
await raises('QUESTION_UNAVAILABLE', MAYA, 'select start_pack_question($1)', [U('99')], 'start_pack_question unknown id');
await raises('PREMIUM_REQUIRED', MAYA, 'select start_pack_question($1)', [await qid('FIXTURE-PACKQ')], 'start_pack_question premium pack, free couple');
await db.exec(`insert into entitlements (user_id, is_active) values ('${SAM}', true)`);
ok((await as(MAYA, `select (start_pack_question($1)).source s`, [await qid('FIXTURE-PACKQ')])).rows[0].s === 'pack', 'start_pack_question premium pack, partner premium');
ok((await as(MAYA, `select (start_pack_question($1)).source s`, [await qid('FIXTURE-PACKQ')])).rows[0].s === 'pack', 'start_pack_question retry is idempotent');
await db.exec(`update question_packs set active = false where slug = 'fixture-premium'`);
await raises('QUESTION_UNAVAILABLE', MAYA, 'select start_pack_question($1)', [await qid('FIXTURE-PACKQ')], 'start_pack_question inactive pack');

// ── get_daily_question (LIBRARY_EXHAUSTED) ──
ok((await as(ZOE, 'select (get_daily_question()).id')).rows[0].id, 'get_daily_question paired');
await db.exec(`update questions set active = false`);
await raises('LIBRARY_EXHAUSTED', MAYA, 'select get_daily_question()', [], 'get_daily_question with no eligible question left');
ok((await as(ZOE, 'select (get_daily_question()).id')).rows[0].id, 'get_daily_question still returns today\'s question once assigned');
await db.exec(`update questions set active = true`);

// ── unpair ──
await as(ZOE, 'select unpair()');
await raises('NOT_PAIRED', ZOE, 'select unpair()', [], 'unpair retry after success');
await raises('NOT_PAIRED', LEO, 'select get_daily_question()', [], 'partner is unpaired too');

// ── Not built yet: these codes are catalogued for their tasks ──
console.log('TODO RATE_LIMITED on accept_invite / invite_preview (BE-04, D02)');
console.log('TODO PARTNER_ALREADY_ANSWERED, NUDGE_LIMIT on send_nudge (BE-10, D16)');
console.log('TODO PREMIUM_REQUIRED, SAVER_UNAVAILABLE on use_streak_saver (BE-11, D18)');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
