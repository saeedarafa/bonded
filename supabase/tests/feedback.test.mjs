// BE-15: private feedback and monthly check-ins (D22).
// Usage: node supabase/tests/feedback.test.mjs
import { createDb } from './pglite-supabase.mjs';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (condition, message) => {
  console.log((condition ? 'PASS ' : 'FAIL ') + message);
  if (condition) passed++; else { failed++; process.exitCode = 1; }
};

const MAYA = '00000000-0000-0000-0000-000000001501';
const SAM = '00000000-0000-0000-0000-000000001502';
const EVE = '00000000-0000-0000-0000-000000001503';
await db.exec(`insert into auth.users (id) values ('${MAYA}'), ('${SAM}'), ('${EVE}');`);

const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errorOf = async (role, uid, sql, params) => {
  try { await run(role, uid, sql, params); return null; } catch (error) { return error.message; }
};

// The monthly check-in is a score only; private feedback can carry a bounded set of
// selected tags, optional text, and the app version for support follow-up.
await as(MAYA, `insert into feedback (user_id, kind, score, app_version)
  values ($1, 'check_in', 4, '1.2.3')`, [MAYA]);
await as(MAYA, `insert into feedback (user_id, kind, tags, body, app_version)
  values ($1, 'feedback', $2, $3, '1.2.3')`, [MAYA, ['partner_forgets', 'reminders_wrong_time'], 'Evening reminders are difficult this week.']);
{
  const rows = (await db.query(`select user_id, kind, score, tags, body, app_version from feedback order by created_at, id`)).rows;
  ok(rows.length === 2 && rows[0].user_id === MAYA && rows[0].kind === 'check_in' && rows[0].score === 4
    && rows[1].kind === 'feedback' && rows[1].tags.join() === 'partner_forgets,reminders_wrong_time'
    && rows[1].body === 'Evening reminders are difficult this week.' && rows[1].app_version === '1.2.3',
  'the owner can submit a check-in and private feedback');
}

// It is deliberately write-only to every client, including the submitting account.
ok(/permission denied/.test(await errorOf('authenticated', MAYA, 'select * from feedback') ?? ''), 'the submitting user cannot read feedback');
ok(/permission denied/.test(await errorOf('authenticated', SAM, 'select * from feedback') ?? ''), 'another authenticated user cannot read feedback');
ok(/permission denied/.test(await errorOf('anon', null, 'select * from feedback') ?? ''), 'anon cannot read feedback');

// RLS also prevents claiming another account's identity on insert.
ok(/row-level security/.test(await errorOf('authenticated', SAM, `insert into feedback (user_id, kind, score) values ($1, 'check_in', 5)`, [MAYA]) ?? ''), 'a user cannot submit feedback as another account');
ok(/permission denied/.test(await errorOf('anon', null, `insert into feedback (user_id, kind, score) values ('${EVE}', 'check_in', 5)`) ?? ''), 'anon cannot submit feedback');

// Submissions are immutable once sent, which keeps support records trustworthy.
ok(/permission denied/.test(await errorOf('authenticated', MAYA, 'update feedback set score = 1') ?? ''), 'the owner cannot alter a submitted record');
ok(/permission denied/.test(await errorOf('authenticated', MAYA, 'delete from feedback') ?? ''), 'the owner cannot delete a submitted record');

// Boundary validation prevents malformed reports and unbounded sensitive text.
await as(MAYA, `insert into feedback (user_id, kind, score, tags, body)
  values ($1, 'check_in', 1, $2, $3)`, [MAYA, Array.from({ length: 12 }, (_, i) => `tag-${i}`), 'x'.repeat(2000)]);
ok((await db.query(`select count(*)::int n from feedback where user_id = $1`, [MAYA])).rows[0].n === 3, 'score and metadata boundaries are accepted');
ok(/feedback_score_check/.test(await errorOf('authenticated', MAYA, `insert into feedback (user_id, kind, score) values ($1, 'check_in', 0)`, [MAYA]) ?? ''), 'score must be from 1 to 5 when supplied');
ok(/feedback_tags_valid/.test(await errorOf('authenticated', MAYA, `insert into feedback (user_id, kind, tags) values ($1, 'feedback', $2)`, [MAYA, Array.from({ length: 13 }, (_, i) => `tag-${i}`)]) ?? ''), 'at most 12 tags are accepted');
ok(/feedback_body_check/.test(await errorOf('authenticated', MAYA, `insert into feedback (user_id, kind, body) values ($1, 'feedback', $2)`, [MAYA, 'x'.repeat(2001)]) ?? ''), 'feedback body is bounded');

await db.close();
console.log(`\n${passed} passed, ${failed} failed`);
