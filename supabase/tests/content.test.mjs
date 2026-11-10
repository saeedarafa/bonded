// BE-05: content model (D11 answers 1–500, D12 first_day, D14 reaction kinds (now D45 emoji), D33 age gate) and the
// idempotent content loader. Usage: node supabase/tests/content.test.mjs
// Nothing asserts on now(); "tomorrow" is made by moving assigned_for back a day.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDb } from './pglite-supabase.mjs';
import { contentDir, contentSql, parseCsv, readContent } from '../scripts/content-sql.mjs';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errorOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e.message; } };
const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;

const U = n => `00000000-0000-0000-0000-0000000005${n}`;
const [MAYA, SAM, EVE, FINN, LEA] = ['01', '02', '03', '04', '05'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, FINN, LEA].map(u => `('${u}')`).join(', ')}`);

// ═══ Loader: CSV parser ═══
{
  const rows = parseCsv('a,b,c\r\n1,"x, y",3\n"say ""hi""","line1\nline2",\n\n');
  ok(rows.length === 2 && rows[0].b === 'x, y' && rows[1].a === 'say "hi"' && rows[1].b === 'line1\nline2' && rows[1].c === '', 'parseCsv: quotes, "" escapes, commas and newlines in quotes, CRLF, empty fields, blank lines');
  ok(parseCsv('\uFEFFa,b\n1,2')[0].a === '1', 'parseCsv: BOM ignored');
  ok(/unterminated/.test((() => { try { parseCsv('a\n"x'); return ''; } catch (e) { return e.message; } })()), 'parseCsv: unterminated quote is an error');
  ok(/header has 2/.test((() => { try { parseCsv('a,b\n1,2,3'); return ''; } catch (e) { return e.message; } })()), 'parseCsv: ragged row is an error');
}

// ═══ Loader: validation (against copies of the content) ═══
const withContent = (edit, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bonded-content-'));
  for (const f of ['packs.csv', 'questions.csv', 'badges.csv']) fs.copyFileSync(path.join(contentDir, f), path.join(dir, f));
  edit(dir);
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const rewrite = (dir, file, fn) => fs.writeFileSync(path.join(dir, file), fn(fs.readFileSync(path.join(dir, file), 'utf8')));
const throwsWith = (re, fn) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
ok(throwsWith(/unknown stage "married"/, () => withContent(d => rewrite(d, 'questions.csv', t => t.replace('long_distance,false', 'married,false')), d => contentSql({ dir: d }))), 'validation: unknown stage');
ok(throwsWith(/duplicate external_id/, () => withContent(d => rewrite(d, 'questions.csv', t => t.replace('d002,', 'd001,')), d => contentSql({ dir: d }))), 'validation: duplicate external_id');
ok(throwsWith(/unknown pack/, () => withContent(d => rewrite(d, 'questions.csv', t => t.replace(',gratitude,1,', ',nope,1,')), d => contentSql({ dir: d }))), 'validation: unknown pack');
ok(throwsWith(/depth/, () => withContent(d => rewrite(d, 'questions.csv', t => t.replace('appreciation,1,all', 'appreciation,9,all')), d => contentSql({ dir: d }))), 'validation: depth 1–3');
ok(throwsWith(/age_gate must be/, () => withContent(d => rewrite(d, 'packs.csv', t => t.replace(',18+,spicy', ',21+,spicy')), d => contentSql({ dir: d }))), 'validation: age_gate is empty or 18+');
ok(throwsWith(/not daily_eligible/, () => withContent(d => rewrite(d, 'questions.csv', t => t.replace('connection,1,all,false,false,,,first_day', 'connection,1,all,false,true,,,first_day')), d => contentSql({ dir: d }))), 'validation: a special question is not daily_eligible');

// ═══ Loader: what the real content yields ═══
const def = readContent();
const all = readContent({ includeAgeGated: true });
ok(all.packs.length === 7 && def.packs.length === 6 && def.skippedPacks.map(p => p.slug).join() === 'spicy', 'D33: 7 packs in the file, 6 without the 18+ pack');
ok(all.questions.length === 161 && def.questions.length === 153 && def.skippedQuestions.length === 8, 'D33: the 18+ pack\'s 8 questions are skipped too (161 → 153)');
ok(all.questions.filter(r => r.daily_eligible === 'true').length === 100 && all.questions.filter(r => r.special).length === 5, '100 daily questions and 5 special questions');
ok(def.badges.length === 15 && def.badges.filter(b => b.kind === 'streak').map(b => Number(b.threshold)).join() === '1,3,7,14,21,30,50,100,365', 'D19: badge catalogue has the nine streak thresholds');
for (const p of all.packs) {
  const qs = all.questions.filter(r => r.pack_slug === p.slug);
  ok(qs.length === 8 && qs.filter(r => r.pack_position === '1').every(r => r.is_premium === 'false') && qs.filter(r => r.pack_position !== '1').every(r => r.is_premium === 'true'), `pack ${p.slug}: 8 questions, position 1 is the free preview`);
}

// ═══ Loader: idempotent against the database ═══
const sqlDefault = contentSql();
await db.exec(sqlDefault);
const snapshot = async () => JSON.stringify([
  (await db.query(`select slug, title, is_premium, sort_order, age_gate, icon, active from question_packs order by slug`)).rows,
  (await db.query(`select external_id, body, category, depth, stages::text, is_premium, daily_eligible, special::text, age_gate, sort_order, active from questions order by external_id`)).rows,
  (await db.query(`select p.slug, q.external_id, pq.position from pack_questions pq join question_packs p on p.id = pq.pack_id join questions q on q.id = pq.question_id order by 1, 2`)).rows,
  (await db.query(`select slug, kind::text, owner::text, threshold, priority, status from badges order by slug`)).rows,
]);
const first = await snapshot();
const ids1 = JSON.stringify((await db.query('select id from questions order by external_id')).rows);
await db.exec(sqlDefault);
await db.exec(sqlDefault);
ok(await snapshot() === first, 'loading three times changes nothing');
ok(JSON.stringify((await db.query('select id from questions order by external_id')).rows) === ids1, 'row ids are stable across loads (upsert, not delete+insert)');
ok(await count('select count(*)::int n from question_packs') === 6 && await count('select count(*)::int n from questions') === 153 && await count('select count(*)::int n from pack_questions') === 48, 'default load: 6 packs, 153 questions, 48 pack memberships');
ok(await count('select count(*)::int n from badges') === 15, 'D19: all badge catalogue rows are loaded');
ok(await count(`select count(*)::int n from question_packs where slug = 'spicy'`) === 0 && await count(`select count(*)::int n from questions where age_gate is not null`) === 0, 'default load: nothing age-gated reaches the database');
ok(await count(`select count(*)::int n from questions where special is not null`) === 5 && await count(`select count(*)::int n from questions where special = 'first_day' and body = 'What did you notice first about me?' and not daily_eligible`) === 1, 'the special questions are loaded; first_day is "What did you notice first about me?"');
ok(await count(`select count(*)::int n from questions where stages = '{long_distance}'`) === 8, 'stage-specific questions keep their stages');
ok(await count(`select count(*)::int n from questions where body like '%''%'`) > 20, 'apostrophes survive quoting');

// Changing the CSV updates rows in place; nothing is duplicated.
withContent(d => rewrite(d, 'questions.csv', t => t.replace("What's a small thing I do that makes your day better?", "What's a tiny thing I do that makes your day better? (it's \"edited\")")), d => db.exec(contentSql({ dir: d })));
ok(await count(`select count(*)::int n from questions where external_id = 'd001' and body like '%tiny thing%edited%'`) === 1 && await count('select count(*)::int n from questions') === 153, 'an edited question is updated in place');
await db.exec(sqlDefault);

// Turning the flag on loads the 18+ pack; turning it off again deactivates it.
await db.exec(contentSql({ includeAgeGated: true }));
ok(await count(`select count(*)::int n from question_packs where slug = 'spicy' and age_gate = '18+' and active`) === 1 && await count(`select count(*)::int n from questions where age_gate = '18+' and active`) === 8, 'CONTENT_INCLUDE_AGE_GATED=true loads the pack and its 8 questions');
ok((await as(MAYA, `select slug from question_packs where slug = 'spicy'`)).rows.length === 1, '... visible to clients while the flag is on');
await db.exec(contentSql({ includeAgeGated: false }));
ok(await count(`select count(*)::int n from question_packs where slug = 'spicy' and active`) === 0 && await count(`select count(*)::int n from questions where age_gate = '18+' and active`) === 0, 'flag off again: the pack and its questions are deactivated');
ok((await as(MAYA, `select slug from question_packs where slug = 'spicy'`)).rows.length === 0 && (await as(MAYA, `select 1 from questions where age_gate = '18+'`)).rows.length === 0, '... and invisible to clients (RLS shows active rows only)');
ok(await count(`select count(*)::int n from questions where active`) === 153, 'back to 153 active questions');

// ═══ D12: day 1 is first_day; then the daily library, never a special, respecting stages ═══
const solo = async (uid, stage) => (await as(uid, `select create_couple($1::couple_stage, '{}', null) c`, [stage])).rows[0].c;
const mayaCouple = await solo(MAYA, 'dating');
const tomorrow = async couple => db.query(`update couple_questions set assigned_for = assigned_for - 1 where couple_id = $1 and source = 'daily'`, [couple]);
const todaysBody = async uid => {
  const id = (await as(uid, 'select (get_daily_question()).id i')).rows[0].i;
  return (await as(uid, `select q.external_id e from couple_questions cq join questions q on q.id = cq.question_id where cq.id = $1`, [id])).rows[0].e;
};
ok(await todaysBody(MAYA) === 'special-first_day', 'D12: day 1 of a (solo) couple is the first_day question');
ok(await todaysBody(MAYA) === 'special-first_day', 'D12: asking again the same day returns it (idempotent)');
await tomorrow(mayaCouple);
ok(await todaysBody(MAYA) === 'd001', 'day 2 is the first daily question, in sort order');
await tomorrow(mayaCouple);
ok(await todaysBody(MAYA) === 'd002', 'day 3 is the next one');
// The joiner gets the question the inviter already answered, so first_day survives the join.
const invite = (await as(MAYA, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
await as(SAM, 'select accept_invite($1, $2, true)', [invite.c, invite.t]);
ok(await todaysBody(SAM) === 'd002', 'the partner gets the same daily question');
// A couple that has only ever had specials/dailies never gets another special as a daily.
const dailyIds = (await db.query(`select external_id from questions where daily_eligible order by sort_order`)).rows.map(r => r.external_id);
ok(dailyIds.length === 100 && !dailyIds.some(e => e.startsWith('special-')), 'specials are not daily-eligible');
for (let i = 0; i < 98; i++) { await tomorrow(mayaCouple); await as(MAYA, 'select get_daily_question()'); }
ok(await count(`select count(*)::int n from couple_questions cq join questions q on q.id = cq.question_id where cq.couple_id = $1 and q.special is not null`, [mayaCouple]) === 1, 'a hundred days in: the only special asked was first_day');
await tomorrow(mayaCouple);
ok(await errorOf('authenticated', MAYA, 'select get_daily_question()') === 'LIBRARY_EXHAUSTED', 'after the 100 free dailies the library is exhausted (premium dailies don\'t exist)');

// Stages: '{}' fits everyone; a stage list only fits those couples; a couple without a stage only gets "all".
await db.exec(`insert into questions (external_id, body, sort_order, stages) values ('t-ld', 'STAGE-LD', 1, '{long_distance}'), ('t-all', 'STAGE-ALL', 3, '{}'), ('t-dl', 'STAGE-DL', 2, '{dating,living_together}')`);
await db.exec(`update questions set active = false where external_id like 'd%' or external_id = 'special-first_day'`);
const evCouple = await solo(EVE, 'long_distance'), fnCouple = await solo(FINN, 'dating'), leaCouple = await solo(LEA, null);
const seq = async (uid, couple, n) => { const out = []; for (let i = 0; i < n; i++) { out.push(await todaysBody(uid)); await tomorrow(couple); } return out; };
ok((await seq(EVE, evCouple, 2)).join() === 't-ld,t-all', 'long-distance couple: the LD question then the "all" one');
ok((await seq(FINN, fnCouple, 2)).join() === 't-dl,t-all', 'dating couple: its stage question, never the LD one');
ok((await seq(LEA, leaCouple, 1)).join() === 't-all', 'no stage: only questions that fit all');
await db.exec(`update questions set active = true where external_id like 'd%' or external_id = 'special-first_day'; update questions set active = false where external_id like 't-%'`);

// ═══ D11: answers 1–500, messages 1–2000 ═══
const cq = (await db.query(`select (cq).id from (select couple_questions cq from couple_questions where couple_id = $1 limit 1) s`, [mayaCouple])).rows[0].id;
await as(MAYA, `insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)`, [cq, MAYA, 'a'.repeat(500)]);
ok((await as(MAYA, 'select char_length(body) n from answers where couple_question_id = $1 and user_id = $2', [cq, MAYA])).rows[0].n === 500, 'D11: a 500-character answer is accepted');
ok(/check constraint/.test(await errorOf('authenticated', SAM, `insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)`, [cq, SAM, 'a'.repeat(501)]) ?? ''), 'D11: 501 characters rejected');
ok(/check constraint/.test(await errorOf('authenticated', SAM, `insert into answers (couple_question_id, user_id, body) values ($1, $2, '')`, [cq, SAM]) ?? ''), 'D11: an empty answer is rejected');
await as(SAM, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'x')`, [cq, SAM]);
ok(/check constraint/.test(await errorOf('authenticated', SAM, `update answers set body = $1 where user_id = $2`, ['b'.repeat(501), SAM]) ?? ''), 'D11: editing an answer past 500 is rejected');
ok(/check constraint/.test(await errorOf('authenticated', SAM, `insert into answers (couple_question_id, user_id, body) values ($1, $2, $3) on conflict (couple_question_id, user_id) do update set body = excluded.body`, [cq, SAM, 'c'.repeat(501)]) ?? ''), 'D11: the client upsert path is limited too');
await as(SAM, `insert into answers (couple_question_id, user_id, body) values ($1, $2, $3) on conflict (couple_question_id, user_id) do update set body = excluded.body`, [cq, SAM, 'd'.repeat(500)]);
ok((await as(SAM, 'select char_length(body) n from answers where user_id = $1', [SAM])).rows[0].n === 500, 'D11: upsert to exactly 500 works');
await as(SAM, `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, $3)`, [cq, SAM, 'm'.repeat(2000)]);
ok(/check constraint/.test(await errorOf('authenticated', SAM, `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, $3)`, [cq, SAM, 'm'.repeat(2001)]) ?? ''), 'D11: thread messages stay 1–2000 (2001 rejected, 2000 accepted)');

// ═══ D14 → D45: reaction kinds are now one emoji (BE-40; validator cases in emoji-reactions.test.mjs) ═══
const ansMaya = (await as(MAYA, 'select id from answers where user_id = $1', [MAYA])).rows[0].id;
const msg = (await as(SAM, 'select id from thread_messages where user_id = $1', [SAM])).rows[0].id;
const react = (uid, target, id, kind) => as(uid, `insert into reactions (user_id, ${target}, kind) values ($1, $2, $3) on conflict (${target}, user_id) do update set kind = excluded.kind returning kind`, [uid, id, kind]);
ok(!(await db.query(`select 1 from pg_type where typname = 'reaction_kind'`)).rows.length, 'D45: the reaction_kind enum is gone');
ok((await react(SAM, 'answer_id', ansMaya, '❤️')).rows[0].kind === '❤️', 'D45: react to the partner\'s answer with ❤️');
ok((await react(SAM, 'answer_id', ansMaya, '🔥')).rows[0].kind === '🔥' && await count('select count(*)::int n from reactions where answer_id = $1', [ansMaya]) === 1, 'D45: reacting with another emoji replaces it (upsert), still one row');
ok((await react(MAYA, 'message_id', msg, '😂')).rows[0].kind === '😂' && (await react(MAYA, 'message_id', msg, '😮')).rows[0].kind === '😮' && await count('select count(*)::int n from reactions where message_id = $1', [msg]) === 1, 'D45: the same for a thread message');
await react(MAYA, 'answer_id', ansMaya, '❤️');
ok(await count('select count(*)::int n from reactions where answer_id = $1', [ansMaya]) === 2, 'D45: one per user per target (each partner has their own)');
ok(await errorOf('authenticated', SAM, `insert into reactions (user_id, answer_id, kind) values ($1, $2, 'love') on conflict (answer_id, user_id) do update set kind = excluded.kind`, [SAM, ansMaya]) === 'INVALID_REACTION', 'D45: an old kind word is now rejected as text');
ok(!(await db.query(`select 1 from information_schema.columns where table_name = 'reactions' and column_name = 'emoji'`)).rows.length, 'D14: reactions.emoji is gone');
// Partner can't change my reaction; removal is own-only.
await as(SAM, `update reactions set kind = '😮' where user_id = $1`, [MAYA]);
ok((await db.query(`select kind::text k from reactions where user_id = $1 and answer_id = $2`, [MAYA, ansMaya])).rows[0].k === '❤️', 'a partner cannot change my reaction');
await as(SAM, `delete from reactions where user_id = $1`, [MAYA]);
ok(await count('select count(*)::int n from reactions where user_id = $1', [MAYA]) === 2, 'a partner cannot delete my reaction');
ok(/row-level security/.test(await errorOf('authenticated', SAM, `update reactions set user_id = $1 where user_id = $2`, [MAYA, SAM]) ?? ''), 'a reaction cannot be handed to the partner');
ok(/permission denied/.test(await errorOf('authenticated', SAM, `update reactions set created_at = now()`) ?? ''), 'only user_id, answer_id, message_id, kind are updatable');
// The reveal rule still governs reactions: a user who hasn't answered can't react (or upsert a change).
await solo(LEA, 'dating').catch(() => {});
const other = (await db.query(`select (cq).id from (select couple_questions cq from couple_questions where couple_id = $1 limit 1) s`, [leaCouple])).rows[0]?.id;
const otherAns = (await db.query(`insert into answers (couple_question_id, user_id, body) values ($1, $2, 'D14-OTHER') returning id`, [other, LEA])).rows[0].id;
ok(/row-level security/.test(await errorOf('authenticated', SAM, `insert into reactions (user_id, answer_id, kind) values ($1, $2, '❤️')`, [SAM, otherAns]) ?? ''), 'D14: another couple\'s answer cannot be reacted to');
ok(/row-level security/.test(await errorOf('authenticated', SAM, `update reactions set answer_id = $1 where user_id = $2 and answer_id = $3`, [otherAns, SAM, ansMaya]) ?? ''), 'D14: a reaction cannot be moved to another couple\'s answer');
ok((await run('anon', null, `select * from reactions`).then(r => r.rows.length, () => 0)) === 0, 'anon sees no reactions');
// Reveal rule: Eve and Finn are not Maya's partner; a fresh partner who hasn't answered can't react.
{
  const NOA = U('09');
  await db.exec(`insert into auth.users (id) values ('${NOA}')`);
  await solo(NOA, 'dating');
  const c2 = (await as(NOA, 'select (get_daily_question()).id i')).rows[0].i;
  const invite2 = (await as(NOA, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  const PART = U('08');
  await db.exec(`insert into auth.users (id) values ('${PART}')`);
  await as(PART, 'select accept_invite($1, $2, true)', [invite2.c, invite2.t]);
  const a2 = (await db.query(`insert into answers (couple_question_id, user_id, body) values ($1, $2, 'D14-LOCKED') returning id`, [c2, NOA])).rows[0].id;
  ok(/row-level security/.test(await errorOf('authenticated', PART, `insert into reactions (user_id, answer_id, kind) values ($1, $2, '❤️')`, [PART, a2]) ?? ''), 'reveal rule: a partner who has not answered cannot react to the locked answer');
  ok((await as(PART, 'select * from reactions')).rows.length === 0 && (await as(PART, 'select * from answers')).rows.length === 0, 'reveal rule: ... and sees nothing');
}

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
