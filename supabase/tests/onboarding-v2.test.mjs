// BE-48 / D50: onboarding questionnaire version 2 (validated keys) and the documented call order
// right after sign-in: profile → solo couple → ritual time → v2 answers → T1 day-1 answer.
import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';
const db = await createDb();
const A = '00000000-0000-4000-a000-000000004801';
const B = '00000000-0000-4000-a000-000000004802';
const C = '00000000-0000-4000-a000-000000004803';
const AT = '2026-11-11T09:00:00Z';
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
const save = (user, question, answer, version = 2, at = AT) => as(user, `
  insert into onboarding_answers(user_id,question_id,questionnaire_version,answer,answered_at)
  values($1,$2,$3,$4::jsonb,$5::timestamptz)
  on conflict(user_id,question_id,questionnaire_version) do update set
    answer=excluded.answer,answered_at=excluded.answered_at returning *`,
  [user, question, version, JSON.stringify(answer), at]);
const denied = async (call, pattern, label) => {
  await assert.rejects(call, pattern); passed++; console.log('PASS ' + label);
};
try {
  await db.exec(`insert into questions (external_id, body, sort_order, daily_eligible, special)
    values ('special-first_day', 'What did you notice first about me?', 0, false, 'first_day'),
           ('d-001', 'OB-Q1', 1, true, null);`);
  await db.query('insert into auth.users(id) values($1),($2),($3)', [A, B, C]);

  // ─── (c) version 2 keys ───
  for (const [question, answer] of [
    ['last_learned', 'this_week'], ['last_learned', 'this_month'], ['last_learned', 'cant_remember'],
    ['stage', 'dating'], ['stage', 'living_together'], ['stage', 'engaged_married'], ['stage', 'long_distance'],
    ['goals', []], ['goals', ['deep_talks']],
    ['goals', ['deep_talks', 'laughing', 'romance', 'future', 'hard_conversations', 'learning']],
  ]) {
    const row = (await save(C, question, answer)).rows[0];
    assert.deepEqual(row.answer, answer); passed++;
  }
  ok(true, 'v2 accepts every documented key for last_learned, stage and goals (incl. none picked)');
  const bad = [
    ['last_learned', 'recently'], ['last_learned', 'This week'], ['last_learned', ['this_week']],
    ['last_learned', { choice: 'this_week' }], ['last_learned', 1], ['last_learned', true],
    ['stage', 'married'], ['stage', 'Dating'], ['stage', ['dating']],
    ['goals', 'deep_talks'], ['goals', ['deep_talks', 'deep_talks']], ['goals', ['play']],
    ['goals', [['deep_talks']]], ['goals', [1]], ['goals', [null]], ['goals', { deep_talks: true }],
    ['goals', ['deep_talks', 'laughing', 'romance', 'future', 'hard_conversations', 'learning', 'learning']],
    ['names', 'Maya'], ['ritual_time', '21:00'], ['day1_answer', 'x'],
  ];
  for (const [question, answer] of bad) {
    await denied(save(C, question, answer), /^error: INVALID_ONBOARDING_ANSWER$|INVALID_ONBOARDING_ANSWER/,
      `v2 rejects ${question}=${JSON.stringify(answer)} with INVALID_ONBOARDING_ANSWER`);
  }
  const before = (await as(C, "select answer from onboarding_answers where question_id='stage' and questionnaire_version=2")).rows[0].answer;
  await denied(as(C, "update onboarding_answers set answer='\"married\"' where question_id='stage' and questionnaire_version=2"),
    /INVALID_ONBOARDING_ANSWER/, 'v2 update to an unknown key is rejected');
  ok((await as(C, "select answer from onboarding_answers where question_id='stage' and questionnaire_version=2")).rows[0].answer === before,
    'a rejected edit leaves the stored v2 answer');
  await save(C, 'last_learned', { free: 'form' }, 1);
  await save(C, 'anything_else', 'x', 3);
  ok((await as(C, 'select count(*)::int n from onboarding_answers where questionnaire_version<>2')).rows[0].n === 2,
    'version 1 (shipped) and other versions keep the BE-33 format checks only');
  await db.exec('alter table onboarding_answers disable trigger onboarding_answers_validate');
  try {
    await denied(db.query(`insert into onboarding_answers(user_id,question_id,questionnaire_version,answer)
      values($1,'stage',2,'"married"')`, [C]), /onboarding_answers_v2_keys/, 'check constraint backs the trigger');
  } finally { await db.exec('alter table onboarding_answers enable trigger onboarding_answers_validate'); }
  ok((await db.query("select convalidated from pg_constraint where conname='onboarding_answers_v2_keys'")).rows[0].convalidated === false,
    'constraint is NOT VALID (old dev rows tolerated, new rows checked)');
  await denied(run('anon', null, `insert into onboarding_answers values('${C}','stage',2,'"dating"',now())`),
    /permission denied/, 'anon still cannot write v2 answers');
  await denied(save(A, 'stage', 'dating').then(() => as(A, `update onboarding_answers set user_id=$1`, [C])),
    /row-level security|duplicate key/, 'owner cannot move v2 answers to another user');
  ok((await as(A, 'select * from onboarding_answers where user_id=$1', [C])).rows.length === 0,
    'another user cannot read v2 answers');
  await denied(as(C, 'select private.onboarding_answer_v2_valid($1,$2)', ['stage', '"dating"']),
    /permission denied/, 'the validator is not callable through the private schema');

  // ─── (d) call order right after sign-in (CONTRACTS §2) ───
  const signedIn = (await db.query('select timezone from profiles where id=$1', [A])).rows[0];
  ok(signedIn && (await db.query('select ritual_time from notification_prefs where user_id=$1', [A])).rows.length === 1,
    '1. sign-in creates the profile and notification_prefs row');
  await as(A, "update profiles set display_name='Maya', timezone='Europe/Berlin' where id=$1", [A]);
  const couple = (await as(A, "select create_couple('long_distance', array['deep_talks','learning'], 'Sam') id")).rows[0].id;
  const again = (await as(A, "select create_couple('long_distance', array['deep_talks','learning'], 'Sam') id")).rows[0].id;
  const c = (await db.query('select * from couples where id=$1', [couple])).rows[0];
  ok(couple === again && c.timezone === 'Europe/Berlin' && c.stage === 'long_distance' && c.partner_name === 'Sam'
    && c.goals.join() === 'deep_talks,learning', '2-3. profile timezone then create_couple: solo couple in that timezone; retry returns it');
  await as(A, `insert into notification_prefs(user_id,ritual_time,daily_reminder) values($1,'12:30',false)
    on conflict(user_id) do update set ritual_time=excluded.ritual_time,daily_reminder=excluded.daily_reminder`, [A]);
  await as(A, `insert into notification_prefs(user_id,ritual_time,daily_reminder) values($1,'12:30',false)
    on conflict(user_id) do update set ritual_time=excluded.ritual_time,daily_reminder=excluded.daily_reminder`, [A]);
  const prefs = (await db.query('select ritual_time,daily_reminder from notification_prefs where user_id=$1', [A])).rows[0];
  ok(prefs.ritual_time === '12:30:00' && prefs.daily_reminder === false, '4. ritual_time (N) upserts on the existing prefs row (idempotent)');
  for (const [q, a] of [['stage', 'long_distance'], ['last_learned', 'cant_remember'], ['goals', ['deep_talks', 'learning']]]) {
    await save(A, q, a); await save(A, q, a);
  }
  ok((await as(A, 'select count(*)::int n from onboarding_answers where questionnaire_version=2')).rows[0].n === 3,
    '5. v2 answers sync once (retry idempotent)');
  const cq = (await as(A, 'select * from get_daily_question()')).rows[0];
  const special = (await db.query('select special from questions where id=$1', [cq.question_id])).rows[0].special;
  ok(special === 'first_day', '6. get_daily_question on the new solo couple is the first_day question (T1, D12)');
  const answerSql = `insert into answers(couple_question_id,user_id,body) values($1,$2,$3)
    on conflict(couple_question_id,user_id) do update set body=excluded.body returning *`;
  const first = (await as(A, answerSql, [cq.id, A, 'Your laugh.'])).rows[0];
  const retry = (await as(A, answerSql, [cq.id, A, 'Your laugh.'])).rows[0];
  ok(first.id === retry.id && first.counts_for_streak === true,
    '7. T1 answer without client_written_at is saved once and counts for the couple\'s first day');
  ok((await as(A, 'select count(*)::int n from answers where couple_question_id=$1', [cq.id])).rows[0].n === 1,
    'no duplicate day-1 answer after a retry');
  const ownCouple = (await as(C, "select create_couple(null) id")).rows[0].id;
  const cCq = (await as(C, 'select * from get_daily_question()')).rows[0];
  const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const early = (await as(C, `insert into answers(couple_question_id,user_id,body,client_written_at)
    values($1,$2,'Early',$3) returning counts_for_streak`, [cCq.id, C, twoDaysAgo])).rows[0];
  ok(ownCouple && early.counts_for_streak === false,
    'caveat: a T1 answer stamped with an earlier device day is saved but does not count (so omit client_written_at)');
  await db.query('insert into couple_members(couple_id,user_id) values($1,$2)', [couple, B]);
  const joinerCq = (await as(B, 'select * from get_daily_question()')).rows[0];
  ok(joinerCq.id === cq.id, 'the joiner gets the same day-1 question');
  ok((await as(B, 'select * from answers where couple_question_id=$1', [cq.id])).rows.length === 0,
    'reveal rule: the joiner cannot see the T1 answer before answering');
  await as(B, answerSql, [cq.id, B, 'Your smile.']);
  ok((await as(B, 'select * from answers where couple_question_id=$1', [cq.id])).rows.length === 2,
    'reveal rule: both answers visible once the joiner answered');
  ok((await as(B, 'select * from onboarding_answers where user_id=$1', [A])).rows.length === 0,
    'the partner never reads the onboarding answers');
  await denied(as(B, "select create_couple('dating')"), /ALREADY_PAIRED/, 'create_couple after pairing is ALREADY_PAIRED (app skips onboarding sync for paired users)');
  console.log(`${passed} passed, 0 failed`);
} finally { await db.close(); }
