// BE-20: unread counts are active-couple-only and avatars stay scoped to their owner/couple.
import { createDb } from './pglite-supabase.mjs';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (condition, message) => {
  console.log((condition ? 'PASS ' : 'FAIL ') + message);
  if (condition) passed++; else { failed++; process.exitCode = 1; }
};
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errorOf = async (role, uid, sql, params) => {
  try { await run(role, uid, sql, params); return null; } catch (e) { return e.message; }
};

const [A, B, C] = ['00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000002003'];
const [COUPLE, OTHER] = ['10000000-0000-0000-0000-000000002001', '10000000-0000-0000-0000-000000002002'];
const [QUESTION, CQ] = ['20000000-0000-0000-0000-000000002001', '30000000-0000-0000-0000-000000002001'];
await db.exec(`
  insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
  insert into couples (id, status) values ('${COUPLE}', 'active'), ('${OTHER}', 'active');
  insert into couple_members (couple_id, user_id, joined_at) values
    ('${COUPLE}', '${A}', '2026-11-01T00:00:00Z'), ('${COUPLE}', '${B}', '2026-11-01T00:00:01Z'),
    ('${OTHER}', '${C}', '2026-11-01T00:00:00Z');
  insert into questions (id, body) values ('${QUESTION}', 'BE20 question');
  insert into couple_questions (id, couple_id, question_id, source) values ('${CQ}', '${COUPLE}', '${QUESTION}', 'pack');
  insert into answers (couple_question_id, user_id, body) values
    ('${CQ}', '${A}', 'A answer'), ('${CQ}', '${B}', 'B answer');
  insert into thread_messages (client_id, couple_question_id, user_id, body, created_at) values
    ('40000000-0000-0000-0000-000000002001', '${CQ}', '${B}', 'B message', '2026-11-02T10:00:00Z');
`);

const counts = async uid => (await as(uid, 'select * from unread_thread_counts()')).rows;
let rows = await counts(A);
ok(rows.length === 1 && rows[0].couple_question_id === CQ && rows[0].unread === 1,
  'a partner sees one unread count, never message text');
await as(A, `insert into thread_reads (couple_question_id, user_id, last_read_at) values ($1, $2, '2026-11-02T10:01:00Z')`, [CQ, A]);
ok((await counts(A)).length === 0, 'a read marker clears the count');
await db.query(`insert into thread_messages (client_id, couple_question_id, user_id, body, created_at) values
  ('40000000-0000-0000-0000-000000002002', $1, $2, 'later message', '2026-11-02T10:02:00Z'),
  ('40000000-0000-0000-0000-000000002003', $1, $3, 'own message', '2026-11-02T10:03:00Z')`, [CQ, B, A]);
rows = await counts(A);
ok(rows.length === 1 && rows[0].unread === 1, 'only partner messages after the marker count');
ok((await counts(C)).length === 0, 'another active couple sees no counts');
ok(/permission denied/.test(await errorOf('anon', null, 'select * from unread_thread_counts()') ?? ''), 'anon cannot call unread_thread_counts');

const avatar = `${A}/avatar.jpg`;
await as(A, "insert into storage.objects (bucket_id, name) values ('avatars', $1)", [avatar]);
ok((await as(A, 'select name from storage.objects')).rows.map(r => r.name).join() === avatar, 'owner uploads and reads only the canonical avatar path');
ok((await as(B, 'select name from storage.objects')).rows.map(r => r.name).join() === avatar, 'current partner reads the avatar');
ok((await as(C, 'select name from storage.objects')).rows.length === 0, 'other couples cannot read avatars');
ok(/row-level security/.test(await errorOf('authenticated', B, "insert into storage.objects (bucket_id, name) values ('avatars', $1)", [avatar]) ?? ''), 'a partner cannot overwrite the owner avatar');
ok(/row-level security/.test(await errorOf('authenticated', A, "insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${A}/other.jpg`]) ?? ''), 'only avatar.jpg is accepted');
ok(/permission denied/.test(await errorOf('anon', null, 'select * from storage.objects') ?? ''), 'anon cannot read avatars');

await db.exec(`update couples set status = 'ended', ended_at = '2026-11-03T00:00:00Z' where id = '${COUPLE}';
  update couple_members set left_at = '2026-11-03T00:00:00Z' where couple_id = '${COUPLE}';`);
ok((await errorOf('authenticated', A, 'select * from unread_thread_counts()')) === 'NOT_PAIRED', 'ended archives have no unread counts');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
