// BE-39 / MOB-49: answering a pack question (couple_questions.source = 'pack', started through
// start_pack_question) dispatches the same notify events as the daily question: the first answer
// sends `partner_answered`, the second `both_answered`, each carrying the pack row's
// couple_question_id (which `notify` turns into bonded://question/<id>, see notify/links_test.ts).
// pg_net and Vault are stubbed with pg_net's real signature; nothing leaves the process.
// Usage: node supabase/tests/pack-notify.test.mjs   (after `npm --prefix supabase/tests ci`)
import { createDb } from './pglite-supabase.mjs';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0, seq = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const owner = async (sql, args) => {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)");
  return db.query(sql, args);
};
const run = async (uid, sql, args) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return await db.query(sql, args); } finally { await db.exec('reset role'); }
};
const user = async () => {
  const id = `00000000-0000-0000-0000-${String(0xb390 + ++seq).padStart(12, '0')}`;
  await owner('insert into auth.users(id) values ($1)', [id]);
  return id;
};

// Vault + pg_net stub (same shape as pgnet-headers.test.mjs).
await db.exec(`
  create schema vault;
  create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
  insert into vault.decrypted_secrets values ('functions_url', 'https://fixture-ref.supabase.example'),
    ('internal_function_secret', 'FIXTURE-BE39-SECRET');
  create schema net;
  create table net.calls (id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds int);
  create function net.http_post(
    url text,
    body jsonb default '{}'::jsonb,
    params jsonb default '{}'::jsonb,
    headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds int default 5000
  ) returns bigint language sql as $$
    insert into net.calls(url, body, params, headers, timeout_milliseconds)
      values (url, body, params, headers, timeout_milliseconds) returning id $$;`);
const calls = async after => (await owner(
  "select body from net.calls where id > $1 and url = 'https://fixture-ref.supabase.example/functions/v1/notify' order by id", [after])).rows.map(r => r.body);
const mark = async () => (await owner('select coalesce(max(id), 0)::int n from net.calls')).rows[0].n;

// A paired couple (A created it, B joined).
const a = await user(), b = await user();
const couple = (await run(a, "select create_couple('dating') c")).rows[0].c;
await owner('insert into couple_members(couple_id, user_id) values ($1, $2)', [couple, b]);

// D51 (BE-46): every pack question needs Premium, so the couple is Premium (A's entitlement).
// Two packs (is_premium false and true) give two pack rows to check.
await owner('insert into entitlements(user_id, is_active) values ($1, true)', [a]);
const question = async body => (await owner("insert into questions(body, sort_order, daily_eligible) values ($1, 900, false) returning id", [body])).rows[0].id;
const pack = async (slug, isPremium, q) => {
  const p = (await owner('insert into question_packs(slug, title, is_premium) values ($1, $1, $2) returning id', [slug, isPremium])).rows[0].id;
  await owner('insert into pack_questions(pack_id, question_id, position) values ($1, $2, 1)', [p, q]);
};
const qFree = await question('FIXTURE-BE39-FREE'), qPrem = await question('FIXTURE-BE39-PREMIUM-FIRST');
await pack('fixture-be39-free', false, qFree);
await pack('fixture-be39-premium', true, qPrem);

const answer = (uid, cq, body) => run(uid, `insert into answers(couple_question_id, user_id, body, client_written_at)
  values ($1, $2, $3, now()) on conflict (couple_question_id, user_id) do update set body = excluded.body`, [cq, uid, body]);
const canon = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
const expected = (type, cq, actor, record) => ({ type, record_id: record, couple_id: couple, couple_question_id: cq, actor_user_id: actor });
const answerId = async (cq, uid) => (await owner('select id from answers where couple_question_id = $1 and user_id = $2', [cq, uid])).rows[0].id;

for (const [label, q, first, second] of [['free pack', qFree, a, b], ['premium pack', qPrem, b, a]]) {
  const cqRow = (await run(first, 'select (x).* from (select start_pack_question($1) x) s', [q])).rows[0];
  ok(cqRow?.source === 'pack' && cqRow.couple_id === couple && cqRow.assigned_for === null, `${label}: start_pack_question creates a pack row without a daily date`);
  const cq = cqRow.id;

  let m = await mark();
  await answer(first, cq, `FIXTURE-BE39-${label}-ANSWER-1`);
  let got = await calls(m);
  ok(got.length === 1, `${label}: the first answer dispatches exactly one notify event`);
  ok(canon(got[0]) === canon(expected('partner_answered', cq, first, await answerId(cq, first))),
    `${label}: first answer -> partner_answered with the pack couple_question_id, couple and actor`);

  m = await mark();
  await answer(first, cq, `FIXTURE-BE39-${label}-EDIT`);
  ok((await calls(m)).length === 0, `${label}: editing an answer (upsert update) does not send another push`);

  m = await mark();
  await answer(second, cq, `FIXTURE-BE39-${label}-ANSWER-2`);
  got = await calls(m);
  ok(got.length === 1, `${label}: the second answer dispatches exactly one notify event`);
  ok(canon(got[0]) === canon(expected('both_answered', cq, second, await answerId(cq, second))),
    `${label}: second answer -> both_answered with the pack couple_question_id, couple and actor`);
  ok(!(await owner("select bool_or(position('FIXTURE-BE39' in body::text) > 0) b from net.calls")).rows[0].b,
    `${label}: no answer text in any notify body`);
}

// Parity: a daily row sends the same event shape, so the app opens both the same way.
const qDaily = (await owner("insert into questions(body, sort_order) values ('FIXTURE-BE39-DAILY', 9002) returning id")).rows[0].id;
const daily = (await owner("insert into couple_questions(couple_id, question_id, source, assigned_for) values ($1,$2,'daily','2026-11-10') returning id", [couple, qDaily])).rows[0].id;
let m = await mark();
await answer(a, daily, 'FIXTURE-BE39-DAILY-1');
await answer(b, daily, 'FIXTURE-BE39-DAILY-2');
const got = await calls(m);
ok(got.length === 2 && got[0].type === 'partner_answered' && got[1].type === 'both_answered'
  && got.every(e => e.couple_question_id === daily && Object.keys(e).sort().join() === 'actor_user_id,couple_id,couple_question_id,record_id,type'),
  'daily question: same two events with the same keys (pack and daily are handled alike)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
