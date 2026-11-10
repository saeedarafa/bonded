// BE-38: couples.ended_by / ended_reason and Realtime on end (D08, D09; MOB-18).
// D09 (lead 2026-11-10): nothing of a deleted user is kept: no uuid, no name.
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
const [MAYA, SAM, EVE, FINN, OLLY, RAY, PIA] = ['01', '02', '03', '04', '05', '06', '07'].map(U);
const NAMES = { [MAYA]: 'Maya Lopez', [SAM]: 'Sam Rivers', [EVE]: 'Eve', [FINN]: 'Finnegan Smith', [OLLY]: 'Olly', [RAY]: 'Ray', [PIA]: 'Pia' };

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
const partnerName = async (uid, couple, partner) =>
  (await as(uid, `select p.display_name from couple_members m join profiles p on p.id = m.user_id
    where m.couple_id = $1 and m.user_id = $2`, [couple, partner])).rows[0]?.display_name ?? null;
// Every trace of a user id anywhere in public.couples (any column, as text).
const tracesIn = async id => (await db.query(`select count(*)::int n from couples c where position($1 in row_to_json(c)::text) > 0`, [id])).rows[0].n;

// ═══ Schema ═══
ok((await db.query(`select array_agg(e.enumlabel::text order by e.enumsortorder) l from pg_enum e
  where e.enumtypid = 'public.couple_end_reason'::regtype`)).rows[0].l.join(',') === 'unpaired,deleted', 'enum couple_end_reason = unpaired | deleted');
ok((await db.query(`select count(*)::int n from pg_proc where proname = 'ended_partner_name'`)).rows[0].n === 0, 'no ended_partner_name RPC');
ok((await db.query(`select to_regclass('private.ended_couple_names') r`)).rows[0].r === null, 'no name snapshot table');

// ═══ Active couple: nothing set ═══
const couple = await pair(MAYA, SAM);
const active = await endFields(MAYA, couple);
ok(active.ended_by === null && active.r === null, 'active couple: ended_by and ended_reason are null');
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
ok(await partnerName(SAM, couple, MAYA) === 'Maya Lopez' && await partnerName(MAYA, couple, SAM) === 'Sam Rivers',
  'after unpair each former member reads the other profile (existing RLS)');
ok(await partnerName(EVE, couple, SAM) === null, 'an outsider cannot read the former partner profile');

// Realtime: the remaining member's own couple_members row changed (left_at) and RLS admits it.
ok((await db.query(`select array_agg(tablename::text) t from pg_publication_tables where pubname = 'supabase_realtime'`)).rows[0].t.includes('couple_members'),
  'couple_members is in supabase_realtime');
const samRow = (await as(SAM, 'select left_at from couple_members where couple_id = $1 and user_id = $2', [couple, SAM])).rows;
ok(samRow.length === 1 && samRow[0].left_at !== null, 'unpair: the remaining member can read their changed membership row (Realtime RLS check)');
ok((await as(EVE, 'select 1 from couple_members where couple_id = $1', [couple])).rows.length === 0, 'unpair: an outsider sees no membership change');

// ═══ Account deletion: nothing of the deleted user remains ═══
const del = await pair(OLLY, FINN);
await db.query('delete from auth.users where id = $1', [FINN]);
const afterDel = await endFields(OLLY, del);
ok(afterDel.ended_by === null && afterDel.r === 'deleted', 'delete-account: ended_reason = deleted, ended_by = null');
ok(await tracesIn(FINN) === 0, 'delete-account: no uuid of the deleted user in couples');
ok((await db.query('select count(*)::int n from couple_members where user_id = $1', [FINN])).rows[0].n === 0
  && (await db.query('select count(*)::int n from profiles where id = $1', [FINN])).rows[0].n === 0, 'delete-account: no membership or profile left');
const dump = (await db.query(`select string_agg(row_to_json(c)::text, ' ') t from couples c`)).rows[0].t ?? '';
ok(!/Finnegan/.test(dump), 'delete-account: no name of the deleted user in couples');
ok(/couples_deleted_keeps_no_actor/.test(await errorOf('postgres', null, `update couples set ended_by = $1 where id = $2`, [OLLY, del]) ?? ''),
  'check: a deleted-ended couple cannot carry an actor');
const ollyRow = (await as(OLLY, 'select left_at from couple_members where couple_id = $1 and user_id = $2', [del, OLLY])).rows;
ok(ollyRow.length === 1 && ollyRow[0].left_at !== null, 'delete-account: the remaining member can read their changed membership row (Realtime RLS check)');
ok((await as(OLLY, 'select 1 from couples where id = $1', [del])).rows.length === 1, 'delete-account: the remaining member still reads the ended couple');

// The unpair caller later deletes their account: their uuid is cleared from the old archive.
const later = await pair(RAY, PIA);
await as(RAY, 'select unpair()');
ok((await endFields(PIA, later)).ended_by === RAY, 'later deletion: ended_by is the unpair caller before the deletion');
await db.query('delete from auth.users where id = $1', [RAY]);
const laterFields = await endFields(PIA, later);
ok(laterFields.ended_by === null && laterFields.r === 'unpaired', 'later deletion: ended_by cleared, ended_reason stays unpaired');
ok(await tracesIn(RAY) === 0, 'later deletion: no uuid of the deleted user in couples');
ok(await partnerName(PIA, later, RAY) === null, 'later deletion: no profile of the deleted user');
ok((await endFields(SAM, couple)).ended_by === MAYA, 'another user deletion leaves unrelated archives alone');

// ═══ Window ═══
await db.query(`update couples set ended_at = now() - interval '31 days' where id = $1`, [couple]);
ok((await as(SAM, 'select 1 from couples where id = $1', [couple])).rows.length === 0, 'after 30 days ended_by is no longer readable');

// ═══ Backfill ═══
ok(!(await errorOf('postgres', null, `update couples set ended_by = null, ended_reason = null where id = $1`, [del])), 'an ended couple may keep null (pre-BE-38 rows)');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
