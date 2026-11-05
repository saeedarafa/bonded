// BE-33 / D38: own-only versioned onboarding, including screen03 last_learned.
import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';
const db = await createDb();
const A = '00000000-0000-4000-a000-000000003301';
const B = '00000000-0000-4000-a000-000000003302';
const C = '00000000-0000-4000-a000-000000003303';
const AT = '2026-11-04T10:00:00Z';
let passed = 0;
const ok = (v, label) => { assert.ok(v, label); passed++; console.log('PASS ' + label); };
const run = async (role, user, sql, params = []) => {
  await db.exec(`set role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
    return await db.query(sql, params);
  } finally { await db.exec('reset role'); }
};
const as = (user, sql, params) => run('authenticated', user, sql, params);
const save = (actor, owner, question, version, answer, at = AT) => as(actor, `
  insert into onboarding_answers(user_id,question_id,questionnaire_version,answer,answered_at)
  values($1,$2,$3,$4::jsonb,$5::timestamptz)
  on conflict(user_id,question_id,questionnaire_version) do update set
    user_id=excluded.user_id,question_id=excluded.question_id,
    questionnaire_version=excluded.questionnaire_version,answer=excluded.answer,
    answered_at=excluded.answered_at returning *`, [owner, question, version, JSON.stringify(answer), at]);
const denied = async (call, pattern, label) => { await assert.rejects(call, pattern); passed++; console.log('PASS ' + label); };
try {
  await db.query('insert into auth.users(id) values($1),($2),($3)', [A,B,C]);
  const couple = (await as(A,"select create_couple('dating') id")).rows[0].id;
  await db.query('insert into couple_members(couple_id,user_id) values($1,$2)',[couple,B]);
  const first = (await save(A,A,'last_learned',1,'this_week')).rows[0];
  ok(first.answer === 'this_week' && first.answered_at.toISOString() === new Date(AT).toISOString(), 'owner stores last_learned and its stable answer time');
  const retry = (await save(A,A,'last_learned',1,'this_week')).rows[0];
  assert.deepEqual(retry,first); passed++;
  ok((await as(A,'select * from onboarding_answers')).rows.length === 1, 'retry upserts one answer without duplicating it');
  await save(A,A,'stage',1,'dating');
  await save(A,A,'goals',1,['deep_talks','learning']);
  await save(A,A,'last_learned',2,{ choice: 'this_month' });
  ok((await as(A,"select * from onboarding_answers where question_id='last_learned' order by questionnaire_version")).rows.map(r=>r.questionnaire_version).join() === '1,2', 'old and new questionnaire versions stay readable side by side');
  await save(A,A,'last_learned',2,{ choice: 'this_week' },'2026-11-04T11:00:00Z');
  ok((await as(A,"select answer from onboarding_answers where question_id='last_learned' and questionnaire_version=1")).rows[0].answer === 'this_week', 'editing one version preserves the other version');
  ok((await as(A,"select answer from onboarding_answers where question_id='goals'")).rows[0].answer.join() === 'deep_talks,learning', 'goals retain structured JSON values');
  for (const user of [B,C]) {
    ok((await as(user,'select * from onboarding_answers')).rows.length === 0, 'partner/outsider cannot read owner answers');
    ok((await as(user,"update onboarding_answers set answer='false'::jsonb where user_id=$1 returning *",[A])).rows.length === 0, 'partner/outsider cannot update hidden answers');
    await denied(save(user,A,'stage',1,'long_distance'),/row-level security/, 'partner/outsider cannot overwrite through upsert');
    await denied(save(user,A,'forged',1,true),/row-level security/, 'partner/outsider cannot insert for another owner');
  }
  await save(B,B,'last_learned',1,'cant_remember');
  ok((await as(A,'select user_id from onboarding_answers')).rows.every(r=>r.user_id === A), 'own select never includes partner answers');
  await denied(as(A,'update onboarding_answers set user_id=$1 where user_id=$2',[B,A]),/row-level security/,'owner cannot reassign answers to partner');
  await denied(as(A,'delete from onboarding_answers where user_id=$1',[A]),/permission denied/,'client delete is not granted');
  for (const sql of [
    'select * from onboarding_answers',
    `insert into onboarding_answers values('${A}','last_learned',1,'true',now())`,
    "update onboarding_answers set answer='true'",
    'delete from onboarding_answers',
  ]) await denied(run('anon',null,sql),/permission denied/,'anon has no onboarding access');
  ok((await run('authenticated',null,'select * from onboarding_answers')).rows.length === 0, 'authenticated role without subject cannot read answers');
  await denied(save(null,A,'last_learned',1,true),/row-level security/,'authenticated role without subject cannot write answers');
  await save(A,A,'q'.repeat(64),2147483647,'x'.repeat(8190));
  for (const [question,version,answer,at] of [
    ['',1,true,AT],['Q',1,true,AT],['q'.repeat(65),1,true,AT],['stage',0,true,AT],
    ['stage',-1,true,AT],['stage',1,null,AT],['stage',1,'x'.repeat(8191),AT],
    ['stage',1,'é'.repeat(4096),AT],['stage',1,true,'infinity'],['stage',1,true,'-infinity'],
  ]) await denied(save(A,A,question,version,answer,at),/check constraint/,'invalid identifier/version/JSON/byte size/time is rejected');
  await denied(as(A,`insert into onboarding_answers(user_id,question_id,questionnaire_version,answer)
    values($1,'missing',1,null)`,[A]),/not-null constraint/,'SQL null answer is rejected');
  ok((await db.query("select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename='onboarding_answers'")).rows[0].n === 0,'private onboarding rows are not published to Realtime');
  await db.query('delete from auth.users where id=$1',[A]);
  ok((await db.query('select * from onboarding_answers where user_id=$1',[A])).rows.length === 0,'account deletion cascades all questionnaire versions');
  ok((await as(B,'select * from onboarding_answers')).rows.length === 1,'deleting one account preserves partner private answers');
  console.log(`${passed} passed, 0 failed`);
} finally { await db.close(); }
