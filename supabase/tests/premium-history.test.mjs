// BE-55 (D55): History is Premium beyond yesterday.
// For a member of a free couple the content of a couple question older than yesterday (couple-local
// day) is never returned: answers (text and voice, own and partner), thread messages, reactions and
// voice objects. The day stays listable (couple_questions, history_days: who answered, message count,
// `locked`). Writing into a locked day → PREMIUM_REQUIRED. Premium (is_couple_premium) reads all; a
// lapse relocks and deletes nothing; an ended couple's archive follows the READER's own entitlement;
// the reveal rule still applies on top. Day boundaries are tested with a pinned clock
// (private.cq_content_open_at / history_days_at); the RLS cases use days relative to the couple's
// local today with whole-day margins.
// Usage: node supabase/tests/premium-history.test.mjs
import { createDb } from './pglite-supabase.mjs';
import { randomUUID } from 'node:crypto';

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
// The server: no JWT, no role (seeds, service code).
const owner = async (sql, params) => { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); return db.query(sql, params); };
const rls = e => /row-level security/.test(e?.message ?? '');

const U = n => `00000000-0000-0000-0000-0000000055${n}`;
const [F1, F2, P1, P2, O1, O2, E1, E2, N1, N2] = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map(U);
await db.exec(`insert into auth.users (id) values ${[F1, F2, P1, P2, O1, O2, E1, E2, N1, N2].map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) select 'HIST-Q' || g, g from generate_series(1, 40) g;`);

const pair = async (a, b, tz) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  // Paired 20 days ago, so every test day is inside the pair period (D37).
  await owner(`update couples set timezone = $2, paired_at = now() - interval '20 days' where id = $1`, [couple, tz]);
  return couple;
};
const setPremium = (uid, expires = '2999-01-01T00:00:00Z', active = true) => owner(
  `insert into entitlements (user_id, is_active, expires_at) values ($1, $3, $2)
   on conflict (user_id) do update set is_active = excluded.is_active, expires_at = excluded.expires_at`, [uid, expires, active]);
const dropPremium = uid => owner('delete from entitlements where user_id = $1', [uid]);

const localDate = async (tz, offset) => (await owner(`select ((now() at time zone $1)::date + $2::int)::text d`, [tz, offset])).rows[0].d;
let qn = 0;
// A daily question k days ago (couple-local), created that day; or a pack question created k days ago.
const day = async (couple, tz, k, source = 'daily') => {
  const d = await localDate(tz, -k);
  return (await owner(`insert into couple_questions (couple_id, question_id, source, assigned_for, created_at)
    select $1, id, $2, $3::date, now() - make_interval(days => $4) from questions where body = $5 returning id`,
    [couple, source, source === 'daily' ? d : null, k, `HIST-Q${++qn}`])).rows[0].id;
};
const answer = (cq, uid, body) => owner(
  `insert into answers (couple_question_id, user_id, body) values ($1, $2, $3) returning id`, [cq, uid, body]).then(r => r.rows[0].id);
const message = (cq, uid, body) => owner(
  `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, $3) returning id`, [cq, uid, body]).then(r => r.rows[0].id);
const react = (uid, target, kind = '❤️') => owner(
  `insert into reactions (user_id, ${target.answer ? 'answer_id' : 'message_id'}, kind) values ($1, $2, $3) returning id`,
  [uid, target.answer ?? target.message, kind]).then(r => r.rows[0].id);
const voiceObject = async (couple, uid) => {
  const name = `${couple}/${uid}/${randomUUID()}.m4a`;
  await owner(`insert into storage.objects (bucket_id, name, metadata) values ('voice', $1, '{"size":1000}')`, [name]);
  return name;
};
const canReadObject = async (uid, name) => (await as(uid, `select 1 from storage.objects where bucket_id = 'voice' and name = $1`, [name])).rows.length === 1;
const ids = async (uid, table, col, cq) => (await as(uid, `select id from ${table} where ${col} = $1`, [cq])).rows.map(r => r.id);

// ═══ Fixture: a free couple (UTC+14) with today, yesterday, day −2, day −5 and pack questions ═══
const TZF = 'Pacific/Kiritimati';
const free = await pair(F1, F2, TZF);
const fq = {};
for (const [label, k, src] of [['d0', 0], ['d1', 1], ['d2', 2], ['d5', 5], ['packToday', 0, 'pack'], ['packOld', 3, 'pack']]) {
  fq[label] = await day(free, TZF, k, src);
}
const fa = {}, fm = {}, fr = {}, fv = {};
for (const [label, cq] of Object.entries(fq)) {
  fa[label] = { f1: await answer(cq, F1, `F1-${label}`), f2: await answer(cq, F2, `F2-${label}`) };
  fm[label] = [await message(cq, F1, `MSG1-${label}`), await message(cq, F2, `MSG2-${label}`)];
  fr[label] = { onAnswer: await react(F2, { answer: fa[label].f1 }), onMessage: await react(F1, { message: fm[label][1] }) };
}
// Voice on yesterday and day −2 (attaching a NEW voice reference needs Premium at write time, BE-42).
await setPremium(F1);
for (const label of ['d1', 'd2']) {
  const ans = await voiceObject(free, F1), msg = await voiceObject(free, F2);
  await owner(`update answers set kind = 'voice', body = null, voice_path = $2, voice_duration_ms = 4000 where id = $1`, [fa[label].f1, ans]);
  await owner(`insert into thread_messages (client_id, couple_question_id, user_id, kind, voice_path, voice_duration_ms)
    values (gen_random_uuid(), $1, $2, 'voice', $3, 3000)`, [fq[label], F2, msg]);
  fv[label] = { answer: ans, message: msg };
}
await dropPremium(F1);
const looseTake = await voiceObject(free, F1);  // an upload not attached to any row
const totals = async () => (await owner(`select (select count(*) from answers a join couple_questions q on q.id = a.couple_question_id where q.couple_id = $1)::int a,
  (select count(*) from thread_messages m join couple_questions q on q.id = m.couple_question_id where q.couple_id = $1)::int m,
  (select count(*) from storage.objects where bucket_id = 'voice' and name like $1::text || '/%')::int o`, [free])).rows[0];
const before = await totals();

const OPEN = ['d0', 'd1', 'packToday'], LOCKED = ['d2', 'd5', 'packOld'];

// ═══ Free couple: reads ═══
for (const [who, uid] of [['F1', F1], ['F2', F2]]) {
  for (const l of OPEN) {
    ok((await ids(uid, 'answers', 'couple_question_id', fq[l])).length === 2, `free ${who}: both answers of ${l} readable`);
    ok((await ids(uid, 'thread_messages', 'couple_question_id', fq[l])).length >= 2, `free ${who}: thread of ${l} readable`);
  }
  for (const l of LOCKED) {
    ok((await ids(uid, 'answers', 'couple_question_id', fq[l])).length === 0, `free ${who}: no answer of ${l} (own or partner)`);
    ok((await ids(uid, 'thread_messages', 'couple_question_id', fq[l])).length === 0, `free ${who}: no message of ${l}`);
    const r = (await as(uid, 'select id from reactions where id = any($1)', [[fr[l].onAnswer, fr[l].onMessage]])).rows;
    ok(r.length === 0, `free ${who}: no reaction of ${l} (on answer or message)`);
  }
  ok((await as(uid, 'select id from reactions where id = any($1)', [[fr.d1.onAnswer, fr.d1.onMessage]])).rows.length === 2, `free ${who}: reactions of yesterday readable`);
  ok(await canReadObject(uid, fv.d1.answer) && await canReadObject(uid, fv.d1.message), `free ${who}: yesterday's voice objects readable (answer + message)`);
  ok(!(await canReadObject(uid, fv.d2.answer)) && !(await canReadObject(uid, fv.d2.message)), `free ${who}: day −2 voice objects not readable (also the owner's own)`);
  const listed = (await as(uid, 'select id from couple_questions where couple_id = $1', [free])).rows.length;
  ok(listed === Object.keys(fq).length, `free ${who}: couple_questions still lists every day (${listed})`);
  const body = (await as(uid, `select string_agg(coalesce(a.body, ''), ',') b from couple_questions q left join answers a on a.couple_question_id = q.id where q.couple_id = $1`, [free])).rows[0].b ?? '';
  ok(!LOCKED.some(l => body.includes(l)), `free ${who}: the History select (couple_questions + answers) embeds no locked answer`);
}
ok(await canReadObject(F1, looseTake), 'free: the owner still reads an unattached upload');
ok(!(await canReadObject(F2, looseTake)), 'free: the partner cannot read an unattached upload');

// ═══ history_days ═══
const hist = async (uid, args = '') => (await as(uid, `select *, day::text day_text from history_days(${args})`)).rows;
{
  const rows = await hist(F1);
  ok(rows.length === Object.keys(fq).length, `history_days lists every day (${rows.length})`);
  const by = Object.fromEntries(rows.map(r => [r.couple_question_id, r]));
  ok(OPEN.every(l => by[fq[l]].locked === false) && LOCKED.every(l => by[fq[l]].locked === true), 'history_days: locked = older than yesterday (daily and pack)');
  ok(rows.every(r => r.my_answered === true && r.partner_answered === true), 'history_days: who answered is visible on locked days too');
  ok(by[fq.d2].message_count === 3 && by[fq.d5].message_count === 2, `history_days: message count on locked days (${by[fq.d2].message_count}, ${by[fq.d5].message_count})`);
  ok(by[fq.d5].question?.body?.startsWith('HIST-Q') && by[fq.d5].source === 'daily', 'history_days: the question row is returned for a locked day');
  ok(by[fq.d5].day_text === await localDate(TZF, -5), 'history_days: day = assigned_for (couple-local)');
  ok(by[fq.packOld].day_text === await localDate(TZF, -3), 'history_days: a pack question\'s day = its couple-local start date');
  ok(!JSON.stringify(rows).includes('F1-') && !JSON.stringify(rows).includes('MSG'), 'history_days returns no answer or message text');
  const times = rows.map(r => new Date(r.created_at).getTime());
  ok(times.every((t, i) => i === 0 || times[i - 1] >= t), 'history_days: newest first');
  const page = await hist(F1, 'p_limit => 2, p_offset => 2');
  ok(page.length === 2 && page[0].couple_question_id === rows[2].couple_question_id, 'history_days: limit/offset paging');
  ok((await hist(F1, 'p_limit => 1000')).length === rows.length && (await hist(F1, 'p_limit => 0')).length === 1, 'history_days: limit clamped to 1–100');
  const one = await hist(F2, `p_couple_question_id => '${fq.d5}'`);
  ok(one.length === 1 && one[0].locked === true, 'history_days(p_couple_question_id): one day, locked');
  ok((await hist(F2, `p_couple_id => '${free}'`)).length === rows.length, 'history_days(p_couple_id) for my couple');
}

// ═══ Free couple: writes into a locked day ═══
const MSG = `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, 'late') returning id`;
const UPSERT = `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'edited')
  on conflict (couple_question_id, user_id) do update set body = excluded.body returning id`;
for (const l of LOCKED) {
  ok((await errOf('authenticated', F1, MSG, [fq[l], F1]))?.message === 'PREMIUM_REQUIRED', `free: a thread message on ${l} → PREMIUM_REQUIRED`);
  // A past daily day answers DAY_ENDED first (BE-57, D56: no paywall); an old pack question keeps PREMIUM_REQUIRED.
  const want = l === 'packOld' ? 'PREMIUM_REQUIRED' : 'DAY_ENDED';
  ok((await errOf('authenticated', F2, UPSERT, [fq[l], F2]))?.message === want, `free: editing an answer of ${l} (upsert) → ${want}`);
}
ok((await errOf('authenticated', F2, `insert into reactions (user_id, answer_id, kind) values ($1, $2, '🔥')`, [F2, fa.d2.f1]))?.message === 'PREMIUM_REQUIRED', 'free: reacting to a day −2 answer → PREMIUM_REQUIRED');
ok((await errOf('authenticated', F2, `insert into reactions (user_id, message_id, kind) values ($1, $2, '🔥')
  on conflict (message_id, user_id) do update set kind = excluded.kind`, [F2, fm.d2[0]]))?.message === 'PREMIUM_REQUIRED', 'free: reacting to a day −2 message (upsert) → PREMIUM_REQUIRED');
ok((await as(F1, `update thread_messages set body = 'x', edited_at = now() where id = $1 returning id`, [fm.d2[0]])).rows.length === 0, 'free: editing a day −2 message matches nothing');
ok((await as(F1, `update answers set body = 'x' where id = $1 returning id`, [fa.d2.f1])).rows.length === 0, 'free: a plain update of a day −2 answer matches nothing');
ok((await as(F1, `delete from reactions where id = $1 returning id`, [fr.d2.onMessage])).rows.length === 0, 'free: deleting a day −2 reaction matches nothing');
await as(F1, `update thread_messages set body = 'x'`);  // no filter at all: still only open days
ok((await owner(`select count(*)::int n from thread_messages where body = 'x' and couple_question_id = any($1)`, [LOCKED.map(l => fq[l])])).rows[0].n === 0, 'free: an unfiltered update leaves locked days untouched');
ok((await as(F1, MSG, [fq.d1, F1])).rows.length === 1, 'free: a message on yesterday\'s thread still works');
ok((await as(F2, `insert into reactions (user_id, message_id, kind) values ($1, $2, '😂') returning id`, [F2, fm.d1[0]])).rows.length === 1, 'free: reacting on yesterday still works');
ok((await owner(`insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, 'server') returning id`, [fq.d5, F1])).rows.length === 1, 'server writes (no JWT) are not affected');

// ═══ Other couple and anon ═══
const other = await pair(O1, O2, 'UTC');
for (const l of ['d1', 'd2']) {
  const e = await errOf('authenticated', O1, MSG, [fq[l], O1]);
  ok(rls(e), `other couple: a message on the free couple's ${l} is an RLS error, not PREMIUM_REQUIRED (${e?.message})`);
}
ok((await hist(O1, `p_couple_id => '${free}'`)).length === 0 && (await hist(O1, `p_couple_question_id => '${fq.d1}'`)).length === 0, 'other couple: history_days of a foreign couple/day is empty');
ok((await hist(O1)).length === 0, 'other couple: its own empty history');
ok(/permission denied/.test((await errOf('anon', null, 'select * from history_days()'))?.message ?? ''), 'anon cannot call history_days');
const solo = (await errOf('authenticated', U('99'), 'select * from history_days()'));
ok(solo?.message === 'NOT_PAIRED', `no couple: history_days → NOT_PAIRED (${solo?.message})`);
ok(/permission denied/.test((await errOf('authenticated', F1, `select * from private.history_days_at(null, 30, 0, null, now())`))?.message ?? ''), 'authenticated cannot call private.history_days_at');
ok(/permission denied/.test((await errOf('authenticated', F1, `select private.history_write_guard()`))?.message ?? ''), 'authenticated cannot call the guard');

// ═══ Premium: everything opens (either member, D29) ═══
await setPremium(F2);
for (const [who, uid] of [['F1', F1], ['F2', F2]]) {
  ok((await Promise.all(LOCKED.map(l => ids(uid, 'answers', 'couple_question_id', fq[l])))).every(x => x.length === 2), `premium ${who}: all old answers readable`);
  ok((await ids(uid, 'thread_messages', 'couple_question_id', fq.d5)).length >= 2, `premium ${who}: old thread readable`);
  ok((await as(uid, 'select id from reactions where id = any($1)', [[fr.d5.onAnswer, fr.d5.onMessage]])).rows.length === 2, `premium ${who}: old reactions readable`);
  ok(await canReadObject(uid, fv.d2.answer) && await canReadObject(uid, fv.d2.message), `premium ${who}: day −2 voice objects readable`);
  ok((await hist(uid)).every(r => r.locked === false), `premium ${who}: history_days locks nothing`);
}
ok((await as(F1, MSG, [fq.d5, F1])).rows.length === 1, 'premium: writing to an old thread works');

// ═══ Lapse relocks, nothing deleted ═══
await setPremium(F2, '2000-01-01T00:00:00Z');
ok((await ids(F1, 'answers', 'couple_question_id', fq.d5)).length === 0 && !(await canReadObject(F2, fv.d2.answer)), 'lapsed (expired): old days lock again');
ok((await hist(F1)).filter(r => r.locked).length === LOCKED.length, 'lapsed: history_days locks the old days again');
await setPremium(F2, '2999-01-01T00:00:00Z', false);
ok((await ids(F2, 'answers', 'couple_question_id', fq.d5)).length === 0, 'lapsed (is_active false): old days locked');
const after = await totals();
ok(after.a === before.a && after.o === before.o && after.m >= before.m, `lapse deleted nothing (answers ${after.a}/${before.a}, objects ${after.o}/${before.o})`);
await dropPremium(F2);

// ═══ Reveal rule on top of Premium ═══
const TZP = 'America/Los_Angeles';
const prem = await pair(P1, P2, TZP);
await setPremium(P1);
const pOld = await day(prem, TZP, 4), pToday = await day(prem, TZP, 0);
await setPremium(P2);
const p2voice = await voiceObject(prem, P2);
await owner(`insert into answers (couple_question_id, user_id, kind, voice_path, voice_duration_ms) values ($1, $2, 'voice', $3, 5000)`, [pOld, P2, p2voice]);
await dropPremium(P2);
await answer(pToday, P2, 'P2-today');
ok((await ids(P1, 'answers', 'couple_question_id', pOld)).length === 0, 'reveal rule: Premium P1 cannot read P2\'s old answer before answering');
ok(!(await canReadObject(P1, p2voice)), 'reveal rule: nor its voice object');
ok((await ids(P1, 'answers', 'couple_question_id', pToday)).length === 0, 'reveal rule: nor today\'s partner answer');
ok((await ids(P2, 'answers', 'couple_question_id', pOld)).length === 1 && await canReadObject(P2, p2voice), 'Premium couple: P2 reads own old voice answer');
{
  const row = (await hist(P1, `p_couple_question_id => '${pOld}'`))[0];
  ok(row.my_answered === false && row.partner_answered === true && row.locked === false && row.message_count === 0, 'history_days: partner answered, mine not, unlocked (Premium)');
}
await answer(pOld, P1, 'P1-old');
ok((await ids(P1, 'answers', 'couple_question_id', pOld)).length === 2 && await canReadObject(P1, p2voice), 'reveal rule: after answering, Premium P1 reads both');
await dropPremium(P1);
ok((await ids(P1, 'answers', 'couple_question_id', pOld)).length === 0, 'lapse: the revealed old day locks again');

// ═══ Ended couple archive: the reader's own entitlement ═══
const ended = await pair(E1, E2, 'UTC');
const eOld = await day(ended, 'UTC', 6), eYest = await day(ended, 'UTC', 1);
for (const cq of [eOld, eYest]) { await answer(cq, E1, 'E1'); await answer(cq, E2, 'E2'); await message(cq, E1, 'EM'); }
await setPremium(E1);
await as(E2, 'select unpair()');
ok((await owner('select status from couples where id = $1', [ended])).rows[0].status === 'ended', 'the couple is ended');
ok((await ids(E1, 'answers', 'couple_question_id', eOld)).length === 2 && (await ids(E1, 'thread_messages', 'couple_question_id', eOld)).length === 1, 'ended archive: the reader with own Premium reads old days');
ok((await ids(E2, 'answers', 'couple_question_id', eOld)).length === 0 && (await ids(E2, 'thread_messages', 'couple_question_id', eOld)).length === 0, 'ended archive: the free reader does not (the ex-partner\'s Premium does not count)');
ok((await ids(E2, 'answers', 'couple_question_id', eYest)).length === 2, 'ended archive: the free reader still reads yesterday');
{
  const e1 = Object.fromEntries((await hist(E1, `p_couple_id => '${ended}'`)).map(r => [r.couple_question_id, r.locked]));
  const e2 = Object.fromEntries((await hist(E2, `p_couple_id => '${ended}'`)).map(r => [r.couple_question_id, r.locked]));
  ok(e1[eOld] === false && e2[eOld] === true && e2[eYest] === false, 'history_days on the archive: locked per reader');
}
ok(rls(await errOf('authenticated', E1, MSG, [eYest, E1])), 'ended archive: writes stay refused by RLS (read-only, BE-09)');
await dropPremium(E1);
ok((await ids(E1, 'answers', 'couple_question_id', eOld)).length === 0, 'ended archive: the reader\'s lapse relocks');

// ═══ Day boundary (pinned clock, couple timezone) ═══
{
  const nyc = await pair(N1, N2, 'America/New_York');
  const q = (await owner(`insert into couple_questions (couple_id, question_id, source, assigned_for, created_at)
    select $1, id, 'daily', '2026-03-10', '2026-03-10T12:00:00Z' from questions where body = 'HIST-Q40' returning id`, [nyc])).rows[0].id;
  const pq = (await owner(`insert into couple_questions (couple_id, question_id, source, created_at)
    select $1, id, 'pack', '2026-03-10T03:30:00Z' from questions where body = 'HIST-Q39' returning id`, [nyc])).rows[0].id;
  // As the server with N1's JWT claim (private is not callable by API roles; RLS reaches it by oid).
  const openAt = async (cq, at) => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${N1}', false)`);
    return (await db.query('select private.cq_content_open_at($1, $2) o', [cq, at])).rows[0].o;
  };
  // EDT (UTC−4) from 2026-03-08: local midnight of 12 March is 04:00Z.
  ok(await openAt(q, '2026-03-12T03:59:59Z') === true, 'boundary: day 10 March is still "yesterday" at 23:59:59 local on 11 March');
  ok(await openAt(q, '2026-03-12T04:00:00Z') === false, 'boundary: locked at local midnight of 12 March');
  ok(await openAt(q, '2026-03-10T04:00:00Z') === true, 'boundary: open on its own day');
  // The pack question started 9 March 23:30 local (03:30Z on the 10th): its day is 9 March.
  ok(await openAt(pq, '2026-03-11T03:59:59Z') === true && await openAt(pq, '2026-03-11T04:00:00Z') === false, 'boundary: a pack question\'s day is its couple-local start date');
  await db.exec(`select set_config('request.jwt.claim.sub', '${N1}', false)`);
  const h = (await db.query(`select day::text d, locked from private.history_days_at(null, 100, 0, $1, '2026-03-12T04:00:00Z')`, [pq])).rows[0];
  ok(h.d === '2026-03-09' && h.locked === true, `boundary: history_days_at day and locked (${h.d}, ${h.locked})`);
}

// ═══ Realtime ═══
// postgres_changes delivers a row only if the subscriber's SELECT policies admit it (the same reads
// tested above); the published tables are unchanged.
const pub = (await owner(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)).rows.map(r => r.tablename);
ok(['answers', 'reactions', 'thread_messages'].every(t => pub.includes(t)), 'realtime: answers, thread_messages, reactions stay published (RLS filters each event)');

console.log(`\n${passed} passed, ${failed} failed`);
