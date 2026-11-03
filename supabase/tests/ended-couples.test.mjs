// BE-09: ended couples retain a read-only archive for 30 days, then the purge removes it.
// Usage: node supabase/tests/ended-couples.test.mjs
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
const U = n => `00000000-0000-0000-0000-0000000004${n}`;
const [MAYA, SAM, EVE, FINN] = ['01', '02', '03', '04'].map(U);

await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, FINN].map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) values ('EC-Q1', 1), ('EC-Q2', 2);`);
const pair = async (first, second) => {
  const couple = (await one(first, `select create_couple('dating', '{}', 'Partner') c`)).c;
  const invite = await one(first, 'select (x).code c, (x).token t from (select create_invite() x) s');
  ok((await one(second, 'select accept_invite($1, $2) c', [invite.c, invite.t])).c === couple, 'pair formed');
  return couple;
};

const couple = await pair(MAYA, SAM);
const cq = await one(MAYA, 'select (get_daily_question()).*');
await as(MAYA, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'Maya archive answer')`, [cq.id, MAYA]);
await as(SAM, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'Sam archive answer')`, [cq.id, SAM]);
await as(MAYA, `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, 'Archive thread')`, [cq.id, MAYA]);

await as(MAYA, 'select unpair()');
const ended = await one(MAYA, 'select status, ended_at from couples where id = $1', [couple]);
ok(ended.status === 'ended' && ended.ended_at !== null, 'unpair sets ended status and timestamp');
ok((await as(MAYA, 'select left_at from couple_members where couple_id = $1', [couple])).rows.every(r => r.left_at !== null), 'unpair timestamps both memberships');
ok((await as(MAYA, 'select * from couple_questions where couple_id = $1', [couple])).rows.length === 1
  && (await as(SAM, 'select * from answers where couple_question_id = $1', [cq.id])).rows.length === 2
  && (await as(SAM, 'select * from thread_messages where couple_question_id = $1', [cq.id])).rows.length === 1,
  'both former partners can read the ended archive for 30 days');
ok((await as(EVE, 'select * from couples where id = $1', [couple])).rows.length === 0, 'outsider cannot read ended archive');

ok(/row-level security/.test(await errorOf('authenticated', MAYA,
  `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'late')`, [cq.id, MAYA]) ?? ''),
  'ended archive rejects answer writes');
ok(/row-level security/.test(await errorOf('authenticated', SAM,
  `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, 'late')`, [cq.id, SAM]) ?? ''),
  'ended archive rejects thread writes');
ok(await errorOf('authenticated', MAYA, 'select unpair()') === 'NOT_PAIRED', 'unpair retry returns NOT_PAIRED');

const mayaNew = (await one(MAYA, `select create_couple('long_distance', '{}', 'Sam') c`)).c;
const samNew = (await one(SAM, `select create_couple('dating', '{}', 'Maya') c`)).c;
ok(mayaNew !== couple && samNew !== couple, 'former partners can create new active couples');
const mayaInvite = await one(MAYA, 'select (x).code c, (x).token t from (select create_invite() x) s');
ok((await one(SAM, 'select accept_invite($1, $2) c', [mayaInvite.c, mayaInvite.t])).c === mayaNew, 'former partners can pair again');

const purgeCouple = await pair(EVE, FINN);
await as(EVE, 'select unpair()');
const edge = '2040-01-31T00:00:00Z';
await db.query(`update couples set ended_at = $1 where id = $2`, [edge, purgeCouple]);
await db.query(`select private.purge_ended_couples($1::timestamptz) n`, ['2040-03-01T00:00:00Z']);
ok((await db.query('select count(*)::int n from couples where id = $1', [purgeCouple])).rows[0].n === 1,
  'purge keeps an archive at the 30-day boundary');
ok((await db.query(`select private.purge_ended_couples($1::timestamptz) n`, ['2040-03-01T00:00:01Z'])).rows[0].n === 1,
  'purge removes an archive after 30 days');
ok((await db.query('select count(*)::int n from couples where id = $1', [purgeCouple])).rows[0].n === 0,
  'purge cascades the expired archive');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
