// BE-38: couples.ended_by / ended_reason, ended_partner_name(), Realtime on end (D08, D09; MOB-18).
// Usage: node supabase/tests/ended-by.test.mjs
import { createDb } from './pglite-supabase.mjs';

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
const one = async (uid, sql, params) => (await as(uid, sql, params)).rows[0];
const U = n => `00000000-0000-0000-0000-0000000038${n}`;
const [MAYA, SAM, EVE, FINN, OLLY, PIA, RAY, TESS] = ['01', '02', '03', '04', '05', '06', '07', '08'].map(U);
const NAMES = { [MAYA]: 'Maya Lopez', [SAM]: '  Sam Rivers ', [EVE]: 'Eve', [FINN]: 'Finnegan-Alexander-Bartholomews Smith', [OLLY]: 'Olly', [PIA]: 'Pia', [RAY]: 'Ray', [TESS]: '' };

await db.exec(`insert into auth.users (id) values ${Object.keys(NAMES).map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) values ('EB-Q1', 1);`);
for (const [id, name] of Object.entries(NAMES)) await db.query('update profiles set display_name = $2 where id = $1', [id, name]);

const pair = async (first, second) => {
  const couple = (await one(first, `select create_couple('dating', '{}', 'Partner') c`)).c;
  const invite = await one(first, 'select (x).code c, (x).token t from (select create_invite() x) s');
  ok((await one(second, 'select accept_invite($1, $2, true) c', [invite.c, invite.t])).c === couple, 'pair formed');
  return couple;
};
const endFields = async (uid, couple) => (await as(uid, 'select ended_by, ended_reason::text r from couples where id = $1', [couple])).rows[0];
const partnerName = async (uid, couple) => (await one(uid, 'select ended_partner_name($1) n', [couple])).n;

// ═══ Schema ═══
ok((await db.query(`select array_agg(e.enumlabel::text order by e.enumsortorder) l from pg_enum e
  where e.enumtypid = 'public.couple_end_reason'::regtype`)).rows[0].l.join(',') === 'unpaired,deleted', 'enum couple_end_reason = unpaired | deleted');
ok((await db.query(`select count(*)::int n from pg_constraint where conrelid = 'public.couples'::regclass and contype = 'f'
  and conkey @> array[(select attnum from pg_attribute where attrelid = 'public.couples'::regclass and attname = 'ended_by')]`)).rows[0].n === 0,
  'ended_by has no foreign key (survives the account deletion)');

// ═══ Active couple: nothing set, nothing exposed ═══
const couple = await pair(MAYA, SAM);
const active = await endFields(MAYA, couple);
ok(active.ended_by === null && active.r === null, 'active couple: ended_by and ended_reason are null');
ok(await partnerName(MAYA, couple) === null, 'ended_partner_name is null for an active couple');
ok(/couples_end_fields_only_when_ended/.test(await errorOf('postgres', null, `update couples set ended_by = $1 where id = $2`, [MAYA, couple]) ?? ''),
  'check: an active couple cannot carry ended_by');
ok(/permission denied/.test(await errorOf('authenticated', MAYA, `update couples set ended_by = $1, ended_reason = 'deleted' where id = $2`, [SAM, couple]) ?? ''),
  'members cannot write ended_by / ended_reason');

// ═══ Unpair ═══
await as(MAYA, 'select unpair()');
const mine = await endFields(MAYA, couple), theirs = await endFields(SAM, couple);
ok(mine.ended_by === MAYA && mine.r === 'unpaired', 'unpair: ended_by = caller, ended_reason = unpaired');
ok(theirs.ended_by === MAYA && theirs.r === 'unpaired', 'unpair: the other former member reads the same ended_by');
ok((await as(EVE, 'select ended_by from couples where id = $1', [couple])).rows.length === 0, 'unpair: an outsider cannot read ended_by');
ok(await errorOf('authenticated', MAYA, 'select unpair()') === 'NOT_PAIRED' && (await endFields(SAM, couple)).ended_by === MAYA,
  'unpair retry: NOT_PAIRED, ended_by unchanged');
ok(/permission denied/.test(await errorOf('authenticated', SAM, `update couples set ended_by = $1 where id = $2`, [SAM, couple]) ?? ''),
  'a former member cannot rewrite ended_by');

ok(await partnerName(SAM, couple) === 'Maya' && await partnerName(MAYA, couple) === 'Sam', 'after unpair each former member gets the other first name (trimmed)');
ok(await partnerName(EVE, couple) === null, 'an outsider gets null for a foreign ended couple');
ok(await partnerName(EVE, '00000000-0000-0000-0000-000000000000') === null, 'unknown couple: null (no existence oracle)');
ok(/permission denied/.test(await errorOf('anon', null, 'select ended_partner_name($1)', [couple]) ?? ''), 'anon cannot call ended_partner_name');
ok(await errorOf('authenticated', null, 'select ended_partner_name($1)', [couple]) === 'NOT_AUTHENTICATED', 'no JWT subject: NOT_AUTHENTICATED');

// Realtime: the remaining member's own couple_members row changed (left_at) and RLS admits it.
ok((await db.query(`select array_agg(tablename::text) t from pg_publication_tables where pubname = 'supabase_realtime'`)).rows[0].t.includes('couple_members'),
  'couple_members is in supabase_realtime');
const samRow = (await as(SAM, 'select left_at from couple_members where couple_id = $1 and user_id = $2', [couple, SAM])).rows;
ok(samRow.length === 1 && samRow[0].left_at !== null, 'unpair: the remaining member can read their changed membership row (Realtime RLS check)');
ok((await as(EVE, 'select 1 from couple_members where couple_id = $1', [couple])).rows.length === 0, 'unpair: an outsider sees no membership change');

// After re-pairing, the old archive's ended_by and name stay scoped to the old couple.
const mayaNew = await pair(MAYA, EVE);
ok(await partnerName(MAYA, couple) === 'Sam' && await partnerName(MAYA, mayaNew) === null, 'a new active couple does not change the old archive answer');
ok(await partnerName(EVE, couple) === null, 'the new partner cannot read the old archive name');

// ═══ Account deletion ═══
const del = await pair(OLLY, FINN);
await db.query('delete from auth.users where id = $1', [FINN]);
const afterDel = await endFields(OLLY, del);
ok(afterDel.ended_by === FINN && afterDel.r === 'deleted', 'delete-account: ended_by = the deleted user, ended_reason = deleted');
ok((await db.query('select count(*)::int n from profiles where id = $1', [FINN])).rows[0].n === 0, 'the deleted profile is gone');
ok((await as(OLLY, 'select 1 from profiles where id = $1', [FINN])).rows.length === 0, 'the deleted profile is not readable');
ok(await partnerName(OLLY, del) === 'Finnegan-Alexander-Bartholomew', 'delete-account: the remaining member gets the first name only, at most 30 characters');
ok((await db.query('select first_name from private.ended_couple_names where couple_id = $1', [del])).rows[0]?.first_name === 'Finnegan-Alexander-Bartholomew',
  'only the first name is kept');
ok(await partnerName(EVE, del) === null, 'an outsider gets null for the deleted partner name');
ok(/permission denied/.test(await errorOf('authenticated', OLLY, 'select * from private.ended_couple_names') ?? ''), 'the name snapshot is not readable directly');
const ollyRow = (await as(OLLY, 'select left_at from couple_members where couple_id = $1 and user_id = $2', [del, OLLY])).rows;
ok(ollyRow.length === 1 && ollyRow[0].left_at !== null, 'delete-account: the remaining member can read their changed membership row (Realtime RLS check)');

// A user with an empty display name: no snapshot, null name; ended_by still set.
const blank = await pair(PIA, TESS);
await db.query('delete from auth.users where id = $1', [TESS]);
ok((await endFields(PIA, blank)).ended_by === TESS && await partnerName(PIA, blank) === null, 'empty display name: ended_by set, name null');
ok((await db.query('select count(*)::int n from private.ended_couple_names where couple_id = $1', [blank])).rows[0].n === 0, 'empty display name: nothing stored');

// A former partner who deletes their account after an unpair: the live profile is gone, no snapshot is made (erasure wins).
const later = await pair(RAY, PIA);
await as(RAY, 'select unpair()');
await db.query('delete from auth.users where id = $1', [PIA]);
const laterFields = await endFields(RAY, later);
ok(laterFields.ended_by === RAY && laterFields.r === 'unpaired', 'a later deletion does not rewrite an unpair ended_by');
ok(await partnerName(RAY, later) === null, 'a later deletion leaves no name for the unpaired archive');

// ═══ Window and purge ═══
await db.query(`update couples set ended_at = now() - interval '31 days' where id = $1`, [del]);
ok((await as(OLLY, 'select 1 from couples where id = $1', [del])).rows.length === 0 && await partnerName(OLLY, del) === null,
  'after 30 days: neither ended_by nor the name is readable');
await db.query('select private.purge_ended_couples()');
ok((await db.query('select count(*)::int n from private.ended_couple_names where couple_id = $1', [del])).rows[0].n === 0, 'the purge removes the name snapshot');

// ═══ Backfill ═══
ok(!(await errorOf('postgres', null, `update couples set ended_by = null, ended_reason = null where id = $1`, [couple])), 'an ended couple may keep null (pre-BE-38 rows)');
ok(await partnerName(SAM, couple) === 'Maya', 'a null ended_by still resolves the live former partner name');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
