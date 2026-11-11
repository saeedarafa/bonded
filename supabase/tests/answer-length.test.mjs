// BE-41 (D46, D11 amended): answers are 1–500 characters for a free couple and 1–2000 while the couple
// is Premium at write time; after a lapse long answers stay readable and may only be edited down to
// ≤ 500. Too long raises ANSWER_TOO_LONG with DETAIL {"max":n}. Thread messages stay 1–2000. Pack
// answers follow the same rule. Entitlement dates are fixed far in the past/future; nothing asserts on now().
// Usage: node supabase/tests/answer-length.test.mjs
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
const errOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e; } };
const owner = (sql, params) => db.query(sql, params);

const U = n => `00000000-0000-0000-0000-0000000041${n}`;
const [MAYA, SAM, EVE, OUT] = ['01', '02', '03', '04'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, OUT].map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) values ('LEN-Q1', 1), ('LEN-Q2', 2);
  insert into questions (body, sort_order, daily_eligible) values ('LEN-PACKQ', 3, false);
  insert into question_packs (slug, title, is_premium) values ('fixture-be41', 'BE-41', true);
  insert into pack_questions select p.id, q.id, 1 from question_packs p, questions q where p.slug = 'fixture-be41' and q.body = 'LEN-PACKQ';`);
const packQ = (await owner(`select id from questions where body = 'LEN-PACKQ'`)).rows[0].id;

const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  return couple;
};
const couple = await pair(MAYA, SAM);
await pair(EVE, OUT);
const cq = (await as(MAYA, 'select (get_daily_question()).id i')).rows[0].i;

const UPSERT = `insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)
  on conflict (couple_question_id, user_id) do update set body = excluded.body returning char_length(body) n`;
const upsert = (uid, q, body) => as(uid, UPSERT, [q, uid, body]);
const upsertErr = (uid, q, body) => errOf('authenticated', uid, UPSERT, [q, uid, body]);
const editErr = (uid, q, body) => errOf('authenticated', uid, 'update answers set body = $1 where couple_question_id = $2 and user_id = $3', [body, q, uid]);
const tooLong = (e, max) => e?.message === 'ANSWER_TOO_LONG' && e.code === 'P0001' && e.detail === JSON.stringify({ max });
const lenOf = async (viewer, q, author) => (await as(viewer, 'select char_length(body) n from answers where couple_question_id = $1 and user_id = $2', [q, author])).rows[0]?.n;
const setPremium = async (uid, expires) => owner(
  `insert into entitlements (user_id, is_active, expires_at) values ($1, true, $2)
   on conflict (user_id) do update set is_active = true, expires_at = excluded.expires_at`, [uid, expires]);

// ═══ Free couple: 500 ok, 501 rejected (insert, upsert, edit) ═══
ok((await upsert(MAYA, cq, 'a'.repeat(500))).rows[0].n === 500, 'free: a 500-character answer is accepted');
let e = await upsertErr(SAM, cq, 'b'.repeat(501));
ok(tooLong(e, 500), `free: 501 → ANSWER_TOO_LONG, P0001, details {"max":500} (got ${e?.message} ${e?.code} ${e?.detail})`);
ok(tooLong(await errOf('authenticated', SAM, 'insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)', [cq, SAM, 'b'.repeat(501)]), 500), 'free: plain insert of 501 → ANSWER_TOO_LONG');
ok((await upsertErr(SAM, cq, ''))?.code === '23514', 'empty answer is still the 23514 check violation');
ok(tooLong(await editErr(MAYA, cq, 'a'.repeat(501)), 500), 'free: editing my answer to 501 → ANSWER_TOO_LONG');
ok(tooLong(await upsertErr(MAYA, cq, 'a'.repeat(2001)), 500), 'free: 2001 reports max 500 (the free limit, not the backstop)');
// Reveal rule: Sam has not answered, so Maya's answer is invisible to him.
ok(await lenOf(SAM, cq, MAYA) === undefined, 'reveal rule: partner cannot read my answer before answering');

// ═══ Premium couple (one partner entitled): 2000 ok, 2001 rejected ═══
await setPremium(SAM, '2999-01-01T00:00:00Z');
ok((await upsert(SAM, cq, 'b'.repeat(2000))).rows[0].n === 2000, 'premium: a 2000-character answer is accepted');
e = await upsertErr(SAM, cq, 'b'.repeat(2001));
ok(tooLong(e, 2000), `premium: 2001 → ANSWER_TOO_LONG with {"max":2000} (got ${e?.message} ${e?.detail})`);
ok((await upsert(MAYA, cq, 'a'.repeat(1800))).rows[0].n === 1800, 'premium: the partner of the entitled user may write 1800 too (couple-level Premium)');
ok(await lenOf(SAM, cq, MAYA) === 1800 && await lenOf(MAYA, cq, SAM) === 2000, 'both answered: long answers revealed to the partner');

// Pack question (shares the answers table): same rule.
const pcq = (await as(MAYA, 'select (x).id i from (select start_pack_question($1) x) s', [packQ])).rows[0].i;
ok((await upsert(MAYA, pcq, 'p'.repeat(2000))).rows[0].n === 2000, 'premium: a 2000-character pack answer is accepted');
ok(tooLong(await upsertErr(MAYA, pcq, 'p'.repeat(2001)), 2000), 'premium: a 2001-character pack answer → ANSWER_TOO_LONG {"max":2000}');

// Another couple's member cannot learn this couple's Premium state from the error: RLS answers first.
for (const len of [501, 2001]) {
  const x = await upsertErr(EVE, cq, 'e'.repeat(len));
  ok(x && x.message !== 'ANSWER_TOO_LONG' && /row-level security/.test(x.message), `other couple writing ${len} characters: RLS error, not ANSWER_TOO_LONG (${x?.message})`);
}
ok(/permission denied/.test((await errOf('anon', null, UPSERT, [cq, OUT, 'x'.repeat(501)]))?.message ?? ''), 'anon cannot write answers');

// ═══ Lapse: long answers stay readable; new or edited text is held to 500 ═══
await owner('update entitlements set expires_at = $2 where user_id = $1', [SAM, '2000-01-01T00:00:00Z']);
ok(await lenOf(MAYA, cq, MAYA) === 1800 && await lenOf(SAM, cq, MAYA) === 1800, 'lapsed: the existing 1800-character answer is still readable (owner and partner)');
ok(await lenOf(SAM, cq, SAM) === 2000 && await lenOf(MAYA, pcq, MAYA) === 2000, 'lapsed: 2000-character daily and pack answers still readable');
ok(tooLong(await editErr(MAYA, cq, 'a'.repeat(501)), 500), 'lapsed: editing the 1800 answer to 501 → ANSWER_TOO_LONG {"max":500}');
ok(tooLong(await editErr(MAYA, cq, 'a'.repeat(1700)), 500), 'lapsed: editing it shorter but still over 500 (1700) is rejected');
ok(tooLong(await upsertErr(MAYA, cq, 'c'.repeat(1800)), 500), 'lapsed: changing the text at the same length (1800) is rejected');
ok((await upsert(MAYA, cq, 'a'.repeat(1800))).rows[0].n === 1800, 'lapsed: re-sending the unchanged 1800 answer (upsert retry) is accepted');
await as(MAYA, 'update answers set client_written_at = client_written_at where couple_question_id = $1 and user_id = $2', [cq, MAYA]);
ok(await lenOf(MAYA, cq, MAYA) === 1800, 'lapsed: an update that does not touch body is accepted');
ok(tooLong(await upsertErr(SAM, pcq, 'q'.repeat(501)), 500), 'lapsed: a new 501-character pack answer → ANSWER_TOO_LONG');
ok((await upsert(SAM, pcq, 'q'.repeat(500))).rows[0].n === 500, 'lapsed: a new 500-character answer is accepted');
ok((await upsert(MAYA, cq, 'a'.repeat(500))).rows[0].n === 500, 'lapsed: the long answer may be edited down to 500');
ok(tooLong(await upsertErr(MAYA, cq, 'a'.repeat(1800)), 500), 'lapsed: once shortened it cannot grow back');
// is_active false also counts as lapsed.
await owner('update entitlements set expires_at = $2, is_active = false where user_id = $1', [SAM, '2999-01-01T00:00:00Z']);
ok(tooLong(await editErr(SAM, cq, 'b'.repeat(501)), 500), 'inactive entitlement: 501 edit rejected');
// Renewed: the limit is 2000 again.
await owner('update entitlements set is_active = true where user_id = $1', [SAM]);
ok((await upsert(MAYA, cq, 'a'.repeat(1999))).rows[0].n === 1999, 'renewed Premium: long edits allowed again');

// ═══ Thread messages unchanged; server writes follow the same rule ═══
await owner('update entitlements set is_active = false where user_id = $1', [SAM]);
const msg = body => errOf('authenticated', SAM, 'insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, $3)', [cq, SAM, body]);
ok(await msg('m'.repeat(2000)) === null, 'free couple: a 2000-character thread message is still accepted');
ok((await msg('m'.repeat(2001)))?.code === '23514', 'thread messages: 2001 still the 23514 check');
const cq2 = (await owner(`insert into couple_questions (couple_id, question_id, source, assigned_for)
  select $1, id, 'daily', '2000-01-01' from questions where body = 'LEN-Q2' returning id`, [couple])).rows[0].id;
let ownerErr = null;
try { await owner('insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)', [cq2, MAYA, 'z'.repeat(501)]); } catch (x) { ownerErr = x; }
ok(tooLong(ownerErr, 500), 'no JWT (seed/service): the free limit still applies');

// ═══ BE-41b (SEC-11 Low): no exact-guess oracle on the partner's locked answer ═══
// Sam locks a long answer while the couple is Premium; Maya has not answered. Maya inserts rows that
// claim Sam's user_id with the correct text and with a wrong text: both must fail the same way.
await owner(`insert into questions (body, sort_order) values ('LEN-Q3', 4)`);
// A pack question started today: its day stays open after the lapse, so only BE-41 decides here
// (BE-55/D55 locks days older than yesterday for a free couple).
const cq3 = (await owner(`insert into couple_questions (couple_id, question_id, source)
  select $1, id, 'pack' from questions where body = 'LEN-Q3' returning id`, [couple])).rows[0].id;
await owner('update entitlements set is_active = true, expires_at = $2 where user_id = $1', [SAM, '2999-01-01T00:00:00Z']);
const secret = 's'.repeat(700) + ' my locked answer';
const wrong = 's'.repeat(700) + ' not the answer!';
ok((await upsert(SAM, cq3, secret)).rows[0].n === secret.length, 'BE-41b: Sam locks a 717-character answer (Premium)');
ok(await lenOf(MAYA, cq3, SAM) === undefined, 'BE-41b: reveal rule, Maya cannot read it before answering');
const INSERT = 'insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)';
const guess = (body, sql) => errOf('authenticated', MAYA, sql, [cq3, SAM, body]);
const same = (a, b) => a && b && a.message === b.message && a.code === b.code && (a.detail ?? null) === (b.detail ?? null);
const isRls = x => /row-level security/.test(x?.message ?? '');
for (const [label, until] of [['Premium', '2999-01-01T00:00:00Z'], ['lapsed', '2000-01-01T00:00:00Z']]) {
  await owner('update entitlements set expires_at = $2 where user_id = $1', [SAM, until]);
  for (const [kind, sql] of [['upsert', UPSERT], ['insert', INSERT]]) {
    const right = await guess(secret, sql), bad = await guess(wrong, sql);
    ok(same(right, bad), `BE-41b ${label} ${kind}: correct and wrong guesses give the same error (${right?.message} | ${bad?.message})`);
    ok(label === 'Premium' ? isRls(right) : tooLong(right, 500),
      `BE-41b ${label} ${kind}: the error is ${label === 'Premium' ? 'the RLS violation' : 'ANSWER_TOO_LONG {"max":500}'} (${right?.message})`);
  }
}
ok(await lenOf(SAM, cq3, SAM) === secret.length, 'BE-41b: Sam\'s answer is unchanged by the guesses');
ok((await upsert(SAM, cq3, secret)).rows[0].n === secret.length, 'BE-41b: lapsed, Sam re-sending his own unchanged long answer still succeeds');
ok(tooLong(await upsertErr(SAM, cq3, wrong), 500), 'BE-41b: lapsed, Sam changing it at the same length is still rejected');
let seedErr = null;
try { await owner(`${INSERT} on conflict (couple_question_id, user_id) do update set body = excluded.body`, [cq3, SAM, secret]); } catch (x) { seedErr = x; }
ok(seedErr === null, `BE-41b: no JWT (seed/service) re-sending the stored long text still succeeds (${seedErr?.message})`);

// ═══ Catalogue, backstop, grants ═══
ok((await owner(`select 'ANSWER_TOO_LONG'::public.error_code::text c`)).rows[0].c === 'ANSWER_TOO_LONG', 'ANSWER_TOO_LONG is in public.error_code');
ok(/>= 1\).*<= 2000/.test((await owner(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'answers_body_length'`)).rows[0].d)
  && (await owner(`select convalidated v from pg_constraint where conname = 'answers_body_length'`)).rows[0].v, 'CHECK backstop is 1–2000 and validated');
ok(/permission denied/.test((await errOf('authenticated', MAYA, 'select private.answers_validate_length()'))?.message ?? ''), 'authenticated cannot call the trigger function');

console.log(`\n${passed} passed, ${failed} failed`);
