// BE-42 (D46): voice answers and voice thread messages in the private `voice` bucket.
// Storage RLS: upload only into {active couple}/{me}/ while Premium; owner reads always; the partner
// reads a voice ANSWER only when the reveal rule lets them read the row; thread voice like thread
// text (incl. the 30-day ended archive); lapsed couples keep read access; other couples/anon denied.
// Rows: text XOR voice (23514); new voice needs Premium (PREMIUM_REQUIRED) and an uploaded object in
// the writer's own folder used by no other row (INVALID_VOICE). Dates are fixed; nothing asserts on now().
// Usage: node supabase/tests/voice-storage.test.mjs
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
const owner = (sql, params) => db.query(sql, params);
const code = e => e?.message;
const rls = e => /row-level security/.test(e?.message ?? '');

const U = n => `00000000-0000-0000-0000-0000000042${n}`;
const [MAYA, SAM, EVE, OUT, FREE1, FREE2, SOLO] = ['01', '02', '03', '04', '05', '06', '07'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, OUT, FREE1, FREE2, SOLO].map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) values ('VOICE-Q1', 1), ('VOICE-Q2', 2);`);

const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  return couple;
};
const setPremium = (uid, expires) => owner(
  `insert into entitlements (user_id, is_active, expires_at) values ($1, true, $2)
   on conflict (user_id) do update set is_active = true, expires_at = excluded.expires_at`, [uid, expires]);
const FUTURE = '2999-01-01T00:00:00Z', PAST = '2000-01-01T00:00:00Z';

const couple = await pair(MAYA, SAM);
const otherCouple = await pair(EVE, OUT);
const freeCouple = await pair(FREE1, FREE2);
await setPremium(MAYA, FUTURE);
await setPremium(EVE, FUTURE);
const cq = (await as(MAYA, 'select (get_daily_question()).id i')).rows[0].i;
const freeCq = (await as(FREE1, 'select (get_daily_question()).id i')).rows[0].i;
const otherCq = (await as(EVE, 'select (get_daily_question()).id i')).rows[0].i;

const pathFor = (c, u, ext = 'm4a') => `${c}/${u}/${randomUUID()}.${ext}`;
const upload = (uid, name) => as(uid, `insert into storage.objects (bucket_id, name) values ('voice', $1) returning name`, [name]);
const uploadErr = (uid, name) => errOf('authenticated', uid, `insert into storage.objects (bucket_id, name) values ('voice', $1)`, [name]);
const canRead = async (uid, name) => (await as(uid, `select 1 from storage.objects where bucket_id = 'voice' and name = $1`, [name])).rows.length === 1;
const VOICE_UPSERT = `insert into answers (couple_question_id, user_id, kind, voice_path, voice_duration_ms) values ($1, $2, 'voice', $3, $4)
  on conflict (couple_question_id, user_id) do update set kind = excluded.kind, body = null,
    voice_path = excluded.voice_path, voice_duration_ms = excluded.voice_duration_ms returning kind, voice_path`;
const voiceAnswer = (uid, q, path, ms = 42000) => as(uid, VOICE_UPSERT, [q, uid, path, ms]);
const voiceAnswerErr = (uid, q, path, ms = 42000) => errOf('authenticated', uid, VOICE_UPSERT, [q, uid, path, ms]);
const TEXT_UPSERT = `insert into answers (couple_question_id, user_id, body) values ($1, $2, $3)
  on conflict (couple_question_id, user_id) do update set kind = 'text', body = excluded.body,
    voice_path = null, voice_duration_ms = null returning kind`;
const textAnswer = (uid, q, body) => as(uid, TEXT_UPSERT, [q, uid, body]);
const MSG = `insert into thread_messages (client_id, couple_question_id, user_id, kind, body, voice_path, voice_duration_ms)
  values ($1, $2, $3, $4, $5, $6, $7) returning id`;
const voiceMsg = (uid, q, path, clientId = randomUUID()) => as(uid, MSG, [clientId, q, uid, 'voice', null, path, 30000]);
const voiceMsgErr = (uid, q, path, clientId = randomUUID()) => errOf('authenticated', uid, MSG, [clientId, q, uid, 'voice', null, path, 30000]);

// ═══ Bucket ═══
ok((await owner(`select public from storage.buckets where id = 'voice'`)).rows[0]?.public === false, 'bucket voice exists and is private');
{ // SEC-09 Low 1: Storage enforces these on upload (verified on a real stack; PGlite only stores them).
  const b = (await owner(`select file_size_limit, allowed_mime_types from storage.buckets where id = 'voice'`)).rows[0];
  ok(Number(b.file_size_limit) === 400 * 1024, 'bucket voice: 400 KB per object');
  const mimes = [...b.allowed_mime_types].sort();
  ok(JSON.stringify(mimes) === JSON.stringify(['audio/aac', 'audio/aacp', 'audio/m4a', 'audio/mp4', 'audio/ogg', 'audio/opus', 'audio/x-m4a']),
    'bucket voice: audio MIME types only (m4a/aac/ogg/opus)');
  ok(mimes.every(m => m.startsWith('audio/') && !m.includes('*')), 'bucket voice: no wildcard or non-audio type');
}

// ═══ Upload policy ═══
const mayaTake = pathFor(couple, MAYA);
ok((await upload(MAYA, mayaTake)).rows[0]?.name === mayaTake, 'premium: upload into my own folder of my active couple');
ok(await canRead(MAYA, mayaTake), 'owner reads an unattached upload');
ok(!(await canRead(SAM, mayaTake)), 'partner cannot read an unattached upload');
ok(rls(await uploadErr(SAM, pathFor(couple, MAYA))), 'upload into my partner\'s folder is denied');
ok(rls(await uploadErr(MAYA, pathFor(otherCouple, MAYA))), 'upload into another couple\'s folder is denied');
ok(rls(await uploadErr(EVE, pathFor(couple, EVE))), 'another (premium) couple cannot upload into our couple folder');
for (const [bad, why] of [
  [`${couple}/${MAYA}/../${SAM}/${randomUUID()}.m4a`, 'path traversal'],
  [`${couple}/${MAYA}/x/${randomUUID()}.m4a`, 'an extra folder'],
  [`${couple}/${MAYA}/${randomUUID()}.mp3`, 'an extension outside the allow-list'],
  [`${couple}/${MAYA}/take.m4a`, 'a non-UUID file name'],
  [`${couple.toUpperCase()}/${MAYA}/${randomUUID()}.m4a`, 'an upper-case couple folder'],
  [`${couple}/${MAYA}/${randomUUID()}.m4a.exe`, 'a trailing suffix'],
]) ok(rls(await uploadErr(MAYA, bad)), `upload rejected: ${why}`);
ok(rls(await uploadErr(FREE1, pathFor(freeCouple, FREE1))), 'free couple: upload denied');
ok(rls(await uploadErr(SOLO, pathFor(couple, SOLO))), 'a user without a couple cannot upload');
ok(/permission denied/.test((await errOf('anon', null, `insert into storage.objects (bucket_id, name) values ('voice', $1)`, [pathFor(couple, MAYA)]))?.message ?? ''), 'anon cannot upload');
ok((await upload(MAYA, pathFor(couple, MAYA, 'ogg'))).rows.length === 1, 'ogg is accepted');
// No overwrite: Storage `upsert: true` is INSERT … ON CONFLICT DO UPDATE, which needs an UPDATE policy.
ok((await errOf('authenticated', MAYA, `insert into storage.objects (bucket_id, name) values ('voice', $1)`, [mayaTake]))?.code === '23505', 'overwrite: re-uploading an existing name is refused');
ok(rls(await errOf('authenticated', MAYA, `insert into storage.objects (bucket_id, name, owner_id) values ('voice', $1, 'x')
  on conflict (bucket_id, name) do update set owner_id = excluded.owner_id`, [mayaTake])), 'overwrite: upsert of my own object is denied (no UPDATE policy)');
ok((await as(MAYA, `update storage.objects set name = $2 where bucket_id = 'voice' and name = $1 returning name`, [mayaTake, pathFor(couple, MAYA)])).rows.length === 0, 'move/rename of my own object is denied (no UPDATE policy)');
ok((await upload(MAYA, `${couple}/${MAYA}/${randomUUID().toUpperCase()}.opus`)).rows.length === 1, 'an upper-case file UUID is accepted (opus)');

// ═══ Free couple: the row write says PREMIUM_REQUIRED ═══
const freeObj = pathFor(freeCouple, FREE1);
await owner(`insert into storage.objects (bucket_id, name) values ('voice', $1)`, [freeObj]);  // e.g. left over from a lapsed period
ok(code(await voiceAnswerErr(FREE1, freeCq, freeObj)) === 'PREMIUM_REQUIRED', 'free couple: a voice answer → PREMIUM_REQUIRED');
ok(code(await voiceMsgErr(FREE1, freeCq, freeObj)) === 'PREMIUM_REQUIRED', 'free couple: a voice message → PREMIUM_REQUIRED');
ok((await textAnswer(FREE1, freeCq, 'text is fine')).rows[0].kind === 'text', 'free couple: text answers unchanged (kind defaults to text)');

// ═══ Text XOR voice ═══
const xor = async (sql, params) => (await errOf('authenticated', MAYA, sql, params))?.code === '23514';
ok(await xor(`insert into answers (couple_question_id, user_id, kind, body, voice_path, voice_duration_ms) values ($1, $2, 'voice', 'and text', $3, 1000)`, [cq, MAYA, mayaTake]), 'text + voice together rejected (23514)');
ok(await xor(`insert into answers (couple_question_id, user_id, kind, body, voice_path, voice_duration_ms) values ($1, $2, 'text', 'x', $3, 1000)`, [cq, MAYA, mayaTake]), 'kind text with a voice path rejected');
ok(await xor(`insert into answers (couple_question_id, user_id, kind, voice_path) values ($1, $2, 'voice', $3)`, [cq, MAYA, mayaTake]), 'voice without a duration rejected');
ok(await xor(`insert into answers (couple_question_id, user_id, kind) values ($1, $2, 'voice')`, [cq, MAYA]), 'voice without a path rejected');
ok(await xor(`insert into answers (couple_question_id, user_id, kind, voice_path, voice_duration_ms) values ($1, $2, 'voice', $3, 0)`, [cq, MAYA, mayaTake]), 'zero duration rejected');
ok((await errOf('authenticated', MAYA, `insert into answers (couple_question_id, user_id) values ($1, $2)`, [cq, MAYA]))?.code === '23514', 'a text answer without body rejected');
ok(await xor(`insert into thread_messages (client_id, couple_question_id, user_id, kind, body, voice_path, voice_duration_ms) values ($1, $2, $3, 'voice', 'x', $4, 1000)`, [randomUUID(), cq, MAYA, mayaTake]) ||
   rls(await errOf('authenticated', MAYA, `insert into thread_messages (client_id, couple_question_id, user_id, kind, body, voice_path, voice_duration_ms) values ($1, $2, $3, 'voice', 'x', $4, 1000)`, [randomUUID(), cq, MAYA, mayaTake])),
   'thread: text + voice together rejected');
await owner(`insert into thread_messages (client_id, couple_question_id, user_id, kind, body, voice_path, voice_duration_ms) values ($1, $2, $3, 'voice', 'x', null, null)`, [randomUUID(), cq, MAYA])
  .then(() => ok(false, 'thread CHECK holds without RLS (service role)'), e => ok(e.code === '23514', 'thread CHECK holds without RLS (service role)'));

// ═══ INVALID_VOICE ═══
const samTake = pathFor(couple, SAM);
await upload(SAM, samTake);  // the couple is Premium through Maya
ok(code(await voiceAnswerErr(MAYA, cq, samTake)) === 'INVALID_VOICE', 'my answer cannot point at my partner\'s object');
ok(code(await voiceAnswerErr(MAYA, cq, pathFor(couple, MAYA))) === 'INVALID_VOICE', 'an object that was never uploaded → INVALID_VOICE');
ok(code(await voiceAnswerErr(MAYA, cq, `${couple}/${MAYA}/../${SAM}/x.m4a`)) === 'INVALID_VOICE', 'a traversal path → INVALID_VOICE');
const eveObj = pathFor(otherCouple, EVE);
await upload(EVE, eveObj);
ok(code(await voiceAnswerErr(MAYA, cq, eveObj)) === 'INVALID_VOICE', 'another couple\'s object → INVALID_VOICE');
ok(rls(await voiceAnswerErr(EVE, cq, eveObj)), 'writing into another couple\'s question: RLS error, no Premium/voice detail');
ok(rls(await errOf('authenticated', FREE1, VOICE_UPSERT, [cq, FREE1, pathFor(couple, FREE1), 1000])), 'free outsider into a premium couple\'s question: RLS error, not PREMIUM_REQUIRED');

// ═══ Reveal rule on the object ═══
const r1 = await voiceAnswer(MAYA, cq, mayaTake);
ok(r1.rows[0].kind === 'voice' && r1.rows[0].voice_path === mayaTake, 'premium: voice answer saved');
ok((await voiceAnswer(MAYA, cq, mayaTake)).rows[0].voice_path === mayaTake, 'retry of the same voice answer is idempotent');
ok((await as(SAM, 'select 1 from answers where couple_question_id = $1 and user_id = $2', [cq, MAYA])).rows.length === 0, 'reveal rule: partner cannot read my answer row before answering');
ok(!(await canRead(SAM, mayaTake)), 'reveal rule: partner cannot download my voice answer before answering');
ok(await canRead(MAYA, mayaTake), 'owner always reads their voice answer');
ok(!(await canRead(EVE, mayaTake)) && !(await canRead(OUT, mayaTake)), 'other couple cannot read it');
ok(/permission denied/.test((await errOf('anon', null, `select * from storage.objects where bucket_id = 'voice'`))?.message ?? ''), 'anon cannot read voice objects');
ok(code(await voiceMsgErr(MAYA, cq, pathFor(couple, MAYA))) !== 'PREMIUM_REQUIRED' && rls(await voiceMsgErr(MAYA, cq, (await upload(MAYA, pathFor(couple, MAYA))).rows[0].name)), 'thread closed before both answered: voice message denied by RLS');
ok(code(await voiceMsgErr(MAYA, cq, mayaTake)) === 'INVALID_VOICE', 'an answer\'s object cannot be reused by a message (reveal bypass)');
// Storage `copy` reads the source as the caller, then inserts the destination as the caller.
const COPY = `insert into storage.objects (bucket_id, name) select 'voice', $2 from storage.objects where bucket_id = 'voice' and name = $1 returning name`;
ok((await as(SAM, COPY, [mayaTake, pathFor(couple, SAM)])).rows.length === 0, 'copy: partner cannot copy my voice answer before answering (unreadable source)');
ok((await as(EVE, COPY, [mayaTake, pathFor(otherCouple, EVE)])).rows.length === 0, 'copy: another couple cannot copy it');

await textAnswer(SAM, cq, 'my answer');
ok((await as(SAM, 'select kind, voice_path, body from answers where couple_question_id = $1 and user_id = $2', [cq, MAYA])).rows[0]?.voice_path === mayaTake, 'after answering: partner reads the voice answer row (body null)');
ok(await canRead(SAM, mayaTake), 'after answering: partner downloads the voice answer');
ok(!(await canRead(EVE, mayaTake)), 'other couple still cannot read it');

// ═══ Thread voice ═══
const msgObj = pathFor(couple, SAM);
await upload(SAM, msgObj);
const clientId = randomUUID();
const msg = (await voiceMsg(SAM, cq, msgObj, clientId)).rows[0].id;
ok(!!msg, 'thread: voice message sent (Premium via partner)');
ok((await errOf('authenticated', SAM, `insert into thread_messages (client_id, couple_question_id, user_id, kind, body, voice_path, voice_duration_ms)
  values ($1, $2, $3, 'voice', null, $4, 30000) on conflict (client_id) do nothing`, [clientId, cq, SAM, msgObj])) === null, 'thread: resend with the same client_id is idempotent');
ok((await as(MAYA, `insert into thread_messages (client_id, couple_question_id, user_id, body) values ($1, $2, $3, 'text mixes in') returning kind`, [randomUUID(), cq, MAYA])).rows[0].kind === 'text', 'thread: text and voice mix');
ok(await canRead(MAYA, msgObj), 'thread voice readable by the partner');
ok(!(await canRead(EVE, msgObj)), 'thread voice not readable by another couple');
await as(SAM, `update thread_messages set voice_path = $1, voice_duration_ms = 1 where id = $2`, [samTake, msg]);
ok((await owner('select voice_path, voice_duration_ms from thread_messages where id = $1', [msg])).rows[0].voice_path === msgObj, 'a sent voice message keeps its recording on edit');
ok((await errOf('authenticated', SAM, `update thread_messages set body = 'now text' where id = $1`, [msg]))?.code === '23514', 'a voice message cannot become text + voice');

// ═══ Delete ═══
ok((await as(MAYA, `delete from storage.objects where bucket_id = 'voice' and name = $1 returning name`, [mayaTake])).rows.length === 0, 'owner cannot delete an object an answer references');
ok((await as(MAYA, `delete from storage.objects where bucket_id = 'voice' and name = $1 returning name`, [samTake])).rows.length === 0, 'cannot delete my partner\'s object');
ok((await as(SAM, `delete from storage.objects where bucket_id = 'voice' and name = $1 returning name`, [samTake])).rows.length === 1, 'owner deletes an unused take');

// ═══ Re-record, switch, lapse ═══
const take2 = pathFor(couple, MAYA);
await upload(MAYA, take2);
ok((await voiceAnswer(MAYA, cq, take2)).rows[0].voice_path === take2, 're-record: answer points at the new take');
ok(!(await canRead(SAM, mayaTake)) && await canRead(SAM, take2), 'partner reads only the referenced take');
ok((await as(MAYA, `delete from storage.objects where bucket_id = 'voice' and name = $1 returning name`, [mayaTake])).rows.length === 1, 'the replaced take is deletable');

// UPDATE cannot hand my row to my partner: answers_before_write (runs first by name) keeps user_id and
// couple_question_id, so the voice check sees the stored writer.
const samFresh = pathFor(couple, SAM);
await upload(SAM, samFresh);  // unreferenced: only the folder check can reject it
ok(code(await errOf('authenticated', MAYA, `update answers set user_id = $3, voice_path = $4 where couple_question_id = $1 and user_id = $2`,
  [cq, MAYA, SAM, samFresh])) === 'INVALID_VOICE', 'update setting user_id = partner + partner\'s path → INVALID_VOICE');
const take3 = pathFor(couple, MAYA);
await upload(MAYA, take3);
await as(MAYA, `update answers set user_id = $3, voice_path = $4 where couple_question_id = $1 and user_id = $2`, [cq, MAYA, SAM, take3]);
{
  const rows = (await owner('select user_id, voice_path from answers where couple_question_id = $1 order by user_id', [cq])).rows;
  ok(rows.length === 2 && rows.find(r => r.user_id === MAYA)?.voice_path === take3 && rows.find(r => r.user_id === SAM)?.voice_path === null,
    'update setting user_id = partner + my new path: the row stays mine, partner\'s answer untouched');
}
await voiceAnswer(MAYA, cq, take2);
await as(MAYA, `delete from storage.objects where bucket_id = 'voice' and name = $1`, [take3]);

await setPremium(MAYA, PAST);  // lapse
ok(await canRead(SAM, take2) && await canRead(MAYA, msgObj), 'lapsed: voice stays readable');
ok((await voiceAnswer(MAYA, cq, take2)).rows[0].voice_path === take2, 'lapsed: re-sending the unchanged voice answer succeeds');
ok((await as(MAYA, `update answers set client_written_at = client_written_at where couple_question_id = $1 and user_id = $2 returning kind`, [cq, MAYA])).rows[0].kind === 'voice', 'lapsed: updates that keep the recording succeed');
ok(rls(await uploadErr(MAYA, pathFor(couple, MAYA))), 'lapsed: new uploads denied');
const lapsedObj = pathFor(couple, MAYA);
await owner(`insert into storage.objects (bucket_id, name) values ('voice', $1)`, [lapsedObj]);
ok(code(await voiceAnswerErr(MAYA, cq, lapsedObj)) === 'PREMIUM_REQUIRED', 'lapsed: a new recording → PREMIUM_REQUIRED');
ok((await textAnswer(MAYA, cq, 'back to text')).rows[0].kind === 'text', 'lapsed: switching the answer back to text works');
ok(!(await canRead(SAM, take2)), 'the dropped take is no longer readable by the partner');
await setPremium(MAYA, FUTURE);

// ═══ Ended couple: 30-day archive keeps thread voice readable ═══
await as(MAYA, 'select unpair()');
ok(await canRead(SAM, msgObj) && await canRead(MAYA, msgObj), 'ended couple: thread voice readable by both former members (30-day archive)');
ok(rls(await uploadErr(MAYA, pathFor(couple, MAYA))), 'ended couple: no upload into the old folder');
ok(!(await canRead(EVE, msgObj)), 'ended couple: still nothing for another couple');

// ═══ A free couple switches a voice answer back to text (mobile's MOB-55 payload) ═══
await setPremium(FREE1, FUTURE);
const freeTake = pathFor(freeCouple, FREE2);
await upload(FREE2, freeTake);
ok((await voiceAnswer(FREE2, freeCq, freeTake)).rows[0].kind === 'voice', 'free couple (then Premium): voice answer saved');
await owner('delete from entitlements where user_id = $1', [FREE1]);  // no entitlement at all now
// supabase-js upsert({ couple_question_id, user_id, kind, body, voice_path, voice_duration_ms }, { onConflict })
const POSTGREST_UPSERT = `insert into answers (couple_question_id, user_id, kind, body, voice_path, voice_duration_ms)
  values ($1, $2, $3, $4, $5, $6) on conflict (couple_question_id, user_id) do update set kind = excluded.kind,
  body = excluded.body, voice_path = excluded.voice_path, voice_duration_ms = excluded.voice_duration_ms returning kind, body, voice_path, voice_duration_ms`;
{
  const r = (await as(FREE2, POSTGREST_UPSERT, [freeCq, FREE2, 'text', 'back to words', null, null])).rows[0];
  ok(r.kind === 'text' && r.body === 'back to words' && r.voice_path === null && r.voice_duration_ms === null,
    'free couple: kind text + voice_path null + voice_duration_ms null switches a voice answer back to text');
}
ok((await as(FREE2, POSTGREST_UPSERT, [freeCq, FREE2, 'text', 'back to words', null, null])).rows[0].kind === 'text', 'free couple: the same text payload retried is idempotent');
ok((await as(FREE1, POSTGREST_UPSERT, [freeCq, FREE1, 'text', 'first write with the full payload', null, null])).rows[0].kind === 'text', 'free couple: the full text payload also works for a plain text answer');
ok(code(await errOf('authenticated', FREE2, POSTGREST_UPSERT, [freeCq, FREE2, 'voice', null, freeTake, 1000])) === 'PREMIUM_REQUIRED', 'free couple: going back to the old recording is a new reference → PREMIUM_REQUIRED');
await setPremium(FREE1, FUTURE);
await voiceAnswer(FREE2, freeCq, freeTake);
await owner('delete from entitlements where user_id = $1', [FREE1]);
ok((await errOf('authenticated', FREE2, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'text only')
  on conflict (couple_question_id, user_id) do update set body = excluded.body`, [freeCq, FREE2]))?.code === '23514',
  'a body-only upsert on a voice row is 23514 (send kind/voice_path/voice_duration_ms too)');

// ═══ Reveal rule suite on text answers still holds ═══
const q2 = (await as(EVE, 'select (get_daily_question()).id i')).rows[0].i;
await textAnswer(EVE, q2, 'eve text');
ok((await as(OUT, 'select 1 from answers where couple_question_id = $1 and user_id = $2', [q2, EVE])).rows.length === 0, 'reveal rule: text answers unchanged');
void otherCq;

console.log(`\n${passed} passed, ${failed} failed`);
