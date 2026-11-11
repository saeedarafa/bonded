// BE-43 (D46): voice caps and lifecycle.
//   * start_voice_upload(p_ext) issues the object name; at most 20 per couple per local day → VOICE_LIMIT
//     {"max":20}; the Storage upload policy needs an unexpired (1 h) slot for exactly that name.
//   * Per kind: answer ≤ 90 s / 400 KB, message ≤ 60 s / 300 KB → VOICE_TOO_LONG {"max_ms","max_bytes"}.
//   * A recording must be attached within 23 h of its upload (INVALID_VOICE after).
//   * voice_sweep lists unreferenced objects older than 24 h, or at once when the couple or uploader is
//     gone (D08 purge, D09 delete); voice_objects_of_user feeds delete-account. Both service-only.
// Clocks are pinned (p_now / explicit created_at); nothing asserts on the wall clock's date.
// Usage: node supabase/tests/voice-caps.test.mjs
import { createDb } from './pglite-supabase.mjs';
import { randomUUID } from 'node:crypto';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e; } };
const owner = (sql, params) => db.query(sql, params);
const rls = e => /row-level security/.test(e?.message ?? '');
const is = (e, msg, detail) => e?.message === msg && e.code === 'P0001' && (detail === undefined || e.detail === JSON.stringify(detail));
const perm = e => /permission denied/.test(e?.message ?? '');

// The private, clock-pinned slot RPC, called as the owner with the user's JWT subject.
const slotAt = async (uid, now, ext = 'm4a') => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return (await db.query('select private.start_voice_upload_at($1, $2) n', [ext, now])).rows[0].n; }
  finally { await db.exec(`select set_config('request.jwt.claim.sub', '', false)`); }
};
const slotAtErr = async (uid, now, ext) => { try { await slotAt(uid, now, ext); return null; } catch (e) { return e; } };

const U = n => `00000000-0000-0000-0000-0000000043${n}`;
const [MAYA, SAM, EVE, OUT, FREE1, FREE2, SOLO, GONE1, GONE2] = ['01', '02', '03', '04', '05', '06', '07', '08', '09'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, OUT, FREE1, FREE2, SOLO, GONE1, GONE2].map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) values ('CAPS-Q1', 1), ('CAPS-Q2', 2);`);
const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  return couple;
};
const setPremium = uid => owner(`insert into entitlements (user_id, is_active, expires_at) values ($1, true, '2999-01-01')
  on conflict (user_id) do update set is_active = true, expires_at = excluded.expires_at`, [uid]);

const couple = await pair(MAYA, SAM);
const otherCouple = await pair(EVE, OUT);
const freeCouple = await pair(FREE1, FREE2);
await setPremium(MAYA); await setPremium(EVE);
await owner(`update couples set timezone = 'America/New_York' where id = $1`, [couple]);
const cq = (await as(MAYA, 'select (get_daily_question()).id i')).rows[0].i;

// ═══ start_voice_upload: the server issues the name ═══
const NAME = (c, u, ext) => new RegExp(`^${c}/${u}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.${ext}$`);
const n1 = (await as(MAYA, `select start_voice_upload() n`)).rows[0].n;
ok(NAME(couple, MAYA, 'm4a').test(n1), `start_voice_upload() returns {couple}/{me}/{uuid}.m4a (${n1})`);
ok(NAME(couple, SAM, 'ogg').test((await as(SAM, `select start_voice_upload('ogg') n`)).rows[0].n), 'the partner of the entitled user gets a slot (couple-level Premium), other extension');
ok(is(await errOf('authenticated', MAYA, `select start_voice_upload('mp3')`), 'INVALID_VOICE'), 'an extension outside m4a/aac/ogg/opus → INVALID_VOICE');
ok(is(await errOf('authenticated', FREE1, `select start_voice_upload()`), 'PREMIUM_REQUIRED'), 'free couple → PREMIUM_REQUIRED');
ok(is(await errOf('authenticated', SOLO, `select start_voice_upload()`), 'NOT_PAIRED'), 'no couple → NOT_PAIRED');
ok(perm(await errOf('anon', null, `select start_voice_upload()`)), 'anon cannot call start_voice_upload');
ok(perm(await errOf('authenticated', MAYA, `select private.start_voice_upload_at('m4a', now())`)), 'the clock-pinned variant is not callable by clients');

// ═══ The upload policy needs the slot ═══
const UP = `insert into storage.objects (bucket_id, name) values ('voice', $1) returning name`;
ok((await as(MAYA, UP, [n1])).rows[0]?.name === n1, 'upload with my slot succeeds');
ok(rls(await errOf('authenticated', MAYA, UP, [`${couple}/${MAYA}/${randomUUID()}.m4a`])), 'a well-formed name I made up (no slot) is denied');
const samSlot = (await as(SAM, `select start_voice_upload() n`)).rows[0].n;
ok(rls(await errOf('authenticated', MAYA, UP, [samSlot])), 'my partner\'s slot cannot be used by me');
const stale = (await as(MAYA, `select start_voice_upload() n`)).rows[0].n;
await owner(`update private.voice_uploads set created_at = now() - interval '61 minutes' where name = $1`, [stale]);
ok(rls(await errOf('authenticated', MAYA, UP, [stale])), 'a slot older than 1 hour no longer allows the upload');
const lapsedSlot = (await as(MAYA, `select start_voice_upload() n`)).rows[0].n;
await owner(`update entitlements set expires_at = '2000-01-01' where user_id = $1`, [MAYA]);
ok(rls(await errOf('authenticated', MAYA, UP, [lapsedSlot])), 'a slot taken while Premium cannot be used after a lapse');
await setPremium(MAYA);

// ═══ Daily cap: 20 per couple per local day (couple timezone) ═══
const DAY1_LATE = '2030-01-02T03:00:00Z';   // 2030-01-01 22:00 in New York
const DAY2_EARLY = '2030-01-02T05:30:00Z';  // 2030-01-02 00:30 in New York
for (let i = 0; i < 20; i++) await slotAt(i % 2 ? SAM : MAYA, DAY1_LATE);
let e = await slotAtErr(SAM, DAY1_LATE);
ok(is(e, 'VOICE_LIMIT', { max: 20 }), `21st slot of the couple's day → VOICE_LIMIT, details {"max":20} (got ${e?.message} ${e?.detail})`);
ok(is(await slotAtErr(MAYA, DAY1_LATE), 'VOICE_LIMIT'), 'the cap is shared by both partners');
ok(Number((await owner(`select count(*) n from private.voice_uploads where couple_id = $1 and local_date = '2030-01-01'`, [couple])).rows[0].n) === 20, 'a refused request does not take a slot');
ok(NAME(couple, MAYA, 'm4a').test(await slotAt(MAYA, DAY2_EARLY)), 'after local midnight (couple timezone) the cap resets, though it is the same UTC day');
ok(NAME(otherCouple, EVE, 'm4a').test(await slotAt(EVE, DAY1_LATE)), 'another couple has its own cap');
ok((await owner(`select 'VOICE_LIMIT'::public.error_code::text a, 'VOICE_TOO_LONG'::public.error_code::text b`)).rows[0].b === 'VOICE_TOO_LONG', 'VOICE_LIMIT and VOICE_TOO_LONG are in public.error_code');

// ═══ Per-kind caps at row write ═══
// Objects written by the owner with Storage's metadata.size; created now unless given.
const obj = async (u, size, age = '1 minute', c = couple) => {
  const name = `${c}/${u}/${randomUUID()}.m4a`;
  await owner(`insert into storage.objects (bucket_id, name, metadata, created_at) values ('voice', $1, $2, now() - $3::interval)`,
    [name, size == null ? null : JSON.stringify({ size, mimetype: 'audio/mp4' }), age]);
  return name;
};
const ANSWER = `insert into answers (couple_question_id, user_id, kind, voice_path, voice_duration_ms) values ($1, $2, 'voice', $3, $4)
  on conflict (couple_question_id, user_id) do update set kind = 'voice', body = null, voice_path = excluded.voice_path,
    voice_duration_ms = excluded.voice_duration_ms returning voice_path`;
const answerErr = (u, path, ms) => errOf('authenticated', u, ANSWER, [cq, u, path, ms]);
const MSG = `insert into thread_messages (client_id, couple_question_id, user_id, kind, voice_path, voice_duration_ms) values ($1, $2, $3, 'voice', $4, $5) returning id`;
const msgErr = (u, path, ms, q = cq) => errOf('authenticated', u, MSG, [randomUUID(), q, u, path, ms]);

e = await answerErr(MAYA, await obj(MAYA, 1000), 91000);
ok(is(e, 'VOICE_TOO_LONG', { max_ms: 90000, max_bytes: 409600 }), `91 s answer → VOICE_TOO_LONG {"max_ms":90000,"max_bytes":409600} (got ${e?.message} ${e?.detail})`);
ok(is(await answerErr(MAYA, await obj(MAYA, 1000), 90001), 'VOICE_TOO_LONG'), '90.001 s answer rejected');
e = await answerErr(MAYA, await obj(MAYA, 409601), 30000);
ok(is(e, 'VOICE_TOO_LONG', { max_ms: 90000, max_bytes: 409600 }), 'answer object over 400 KB (409601 B) → VOICE_TOO_LONG');
const okAnswer = await obj(MAYA, 409600);
ok((await errOf('authenticated', MAYA, ANSWER, [cq, MAYA, okAnswer, 90000])) === null, 'answer of exactly 90 s and 400 KB accepted');
ok((await errOf('authenticated', MAYA, ANSWER, [cq, MAYA, okAnswer, 90000])) === null, 'retry of the same voice answer accepted (idempotent)');
ok(is(await errOf('authenticated', MAYA, `update answers set voice_duration_ms = 95000 where couple_question_id = $1 and user_id = $2`, [cq, MAYA]), 'VOICE_TOO_LONG'),
  'editing the duration of a stored voice answer over 90 s is rejected');

// Thread: both answered so the thread is open.
await as(SAM, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'text')`, [cq, SAM]);
e = await msgErr(SAM, await obj(SAM, 1000), 61000);
ok(is(e, 'VOICE_TOO_LONG', { max_ms: 60000, max_bytes: 307200 }), `61 s message → VOICE_TOO_LONG {"max_ms":60000,"max_bytes":307200} (got ${e?.message} ${e?.detail})`);
const big = await obj(SAM, 350000);
ok(is(await msgErr(SAM, big, 30000), 'VOICE_TOO_LONG', { max_ms: 60000, max_bytes: 307200 }), 'message object over 300 KB (350 KB) → VOICE_TOO_LONG');
ok(await msgErr(SAM, await obj(SAM, 307200), 60000) === null, 'message of exactly 60 s and 300 KB accepted');
// BE-43b: Storage writes metadata.size on every upload; without a numeric one the cap cannot be checked.
ok(is(await msgErr(SAM, await obj(SAM, null), 20000), 'INVALID_VOICE'), 'object without metadata → INVALID_VOICE (BE-43b)');
const noSize = `${couple}/${SAM}/${randomUUID()}.m4a`;
await owner(`insert into storage.objects (bucket_id, name, metadata) values ('voice', $1, '{"mimetype":"audio/mp4"}')`, [noSize]);
ok(is(await msgErr(SAM, noSize, 20000), 'INVALID_VOICE'), 'object with metadata but no size → INVALID_VOICE');
const badSize = `${couple}/${SAM}/${randomUUID()}.m4a`;
await owner(`insert into storage.objects (bucket_id, name, metadata) values ('voice', $1, '{"size":"1e9"}')`, [badSize]);
ok(is(await msgErr(SAM, badSize, 20000), 'INVALID_VOICE'), 'a non-numeric size → INVALID_VOICE (no cast error)');
ok(is(await answerErr(SAM, await obj(SAM, null), 20000), 'INVALID_VOICE'), 'the same for an answer');
// The same 350 KB object is fine as an answer (400 KB cap). A pack question (no day): today's daily
// question is taken and a past day answers DAY_ENDED since BE-57 (D56).
const q2 = (await owner(`insert into couple_questions (couple_id, question_id, source, assigned_for)
  select $1, id, 'pack', null from questions where body = 'CAPS-Q2' returning id`, [couple])).rows[0].id;
e = await errOf('authenticated', SAM, ANSWER, [q2, SAM, big, 80000]);
ok(e === null, `the same 350 KB recording is accepted as an answer (400 KB cap) (${e?.message})`);
// Duration backstops exist (NOT VALID: they hold for every new write).
const defs = (await owner(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conname in ('answers_voice_duration_cap', 'thread_messages_voice_duration_cap') order by conname`)).rows;
ok(defs.length === 2 && /90000/.test(defs[0].d) && /60000/.test(defs[1].d), 'CHECK backstops: answers ≤ 90000 ms, messages ≤ 60000 ms');

// ═══ Attach window: within 23 h of upload ═══
ok(is(await msgErr(MAYA, await obj(MAYA, 1000, '23 hours 1 minute'), 10000), 'INVALID_VOICE'), 'a recording uploaded over 23 h ago cannot be attached (the cleanup may remove it)');
ok(await msgErr(MAYA, await obj(MAYA, 1000, '22 hours'), 10000) === null, 'a recording uploaded 22 h ago can be attached');
// Another couple / partner-id rows still get RLS, not a cap error that depends on someone else's data.
ok(rls(await msgErr(EVE, await obj(EVE, 1000, '1 minute', otherCouple), 10000)), 'other couple writing into our thread: RLS error');

// ═══ Write-once objects (BE-43b, SEC-09b Low) ═══
// A signed upload URL made with upsert: true is checked against the INSERT policy before the object
// exists; the later upload runs as Storage (no RLS) as `insert … on conflict do update`. The BEFORE
// UPDATE trigger refuses any change of content, name or bucket of a voice object, for every role.
const attached = await obj(SAM, 1000);
ok(await msgErr(SAM, attached, 5000) === null, 'a 1 KB recording is attached as a message');
// As the table owner, which bypasses RLS like the Storage service does.
const ownerErr = async (sql, params) => { try { await owner(sql, params); return null; } catch (x) { return x; } };
const OVERWRITE = `insert into storage.objects (bucket_id, name, metadata, version) values ('voice', $1, $2, $3)
  on conflict (bucket_id, name) do update set metadata = excluded.metadata, version = excluded.version`;
const big350 = JSON.stringify({ size: 358400, mimetype: 'audio/mp4' });
e = await ownerErr(OVERWRITE, [attached, big350, randomUUID()]);
ok(is(e, 'INVALID_VOICE'), `Storage's upsert over an attached recording (350 KB) → INVALID_VOICE (got ${e?.message})`);
ok((await owner(`select metadata->>'size' s from storage.objects where name = $1`, [attached])).rows[0].s === '1000', 'the attached recording keeps its size (1000 B)');
const loose = await obj(SAM, 1000);
ok(is(await ownerErr(OVERWRITE, [loose, big350, randomUUID()]), 'INVALID_VOICE'), 'an unattached recording cannot be overwritten either (write-once)');
ok(is(await ownerErr(`update storage.objects set version = $2 where bucket_id = 'voice' and name = $1`, [attached, randomUUID()]), 'INVALID_VOICE'), 'a new version is refused');
ok(is(await ownerErr(`update storage.objects set metadata = $2 where bucket_id = 'voice' and name = $1`, [attached, big350]), 'INVALID_VOICE'), 'a metadata change is refused');
ok(is(await ownerErr(`update storage.objects set name = $2 where bucket_id = 'voice' and name = $1`, [loose, `${couple}/${SAM}/${randomUUID()}.m4a`]), 'INVALID_VOICE'), 'a move/rename is refused');
ok(is(await ownerErr(`update storage.objects set bucket_id = 'avatars' where bucket_id = 'voice' and name = $1`, [loose]), 'INVALID_VOICE'), 'moving a recording out of the voice bucket is refused');
await owner(`insert into storage.buckets (id, name) values ('avatars', 'avatars') on conflict do nothing`);
const av = `${SAM}/avatar.jpg`;
await owner(`insert into storage.objects (bucket_id, name, metadata) values ('avatars', $1, '{"size":1}') on conflict do nothing`, [av]);
ok(is(await ownerErr(`update storage.objects set bucket_id = 'voice', name = $2 where bucket_id = 'avatars' and name = $1`, [av, `${couple}/${SAM}/${randomUUID()}.m4a`]), 'INVALID_VOICE'), 'moving an object into the voice bucket is refused');
ok(await ownerErr(`update storage.objects set metadata = '{"size":2}' where bucket_id = 'avatars' and name = $1`, [av]) === null, 'other buckets are unaffected (avatar replace still works)');
ok(await ownerErr(`update storage.objects set owner_id = 'x' where bucket_id = 'voice' and name = $1`, [attached]) === null, 'a bookkeeping update (owner, timestamps) is still allowed');
ok(await ownerErr(`delete from storage.objects where bucket_id = 'voice' and name = $1`, [loose]) === null, 'deleting stays possible (cleanup)');

// ═══ Cleanup: voice_sweep (service role) ═══
// BE-44 (SEC-09c Info 3): voice_sweep has no p_now; it always uses the database clock. `now` is unused.
const sweep = async () => (await run('service_role', null, 'select n from voice_sweep(1000) n')).rows.map(r => r.n);
const NOW = (await owner(`select now() t`)).rows[0].t;
const orphanOld = await obj(MAYA, 1000, '25 hours');
const orphanNew = await obj(MAYA, 1000, '1 hour');
let swept = await sweep(NOW);
ok(swept.includes(orphanOld), 'an unattached upload older than 24 h is listed');
ok(!swept.includes(orphanNew), 'an unattached upload under 24 h is not listed');
ok(!swept.includes(okAnswer), 'a referenced recording is never listed, however old');
// Replaced take: Maya switches her answer to a new recording; the old one becomes unreferenced.
await owner(`update storage.objects set created_at = now() - interval '2 days' where name = $1`, [okAnswer]);
const newTake = await obj(MAYA, 1000);
await as(MAYA, ANSWER, [cq, MAYA, newTake, 1000]);
ok((await sweep(NOW)).includes(okAnswer), 'a replaced take older than 24 h is listed');
// Simulate the Storage API removing what was listed, then sweep again: nothing left (idempotent).
const removeListed = async names => { for (const n of names) await owner(`delete from storage.objects where bucket_id = 'voice' and name = $1`, [n]); };
await removeListed(await sweep(NOW));
ok((await sweep(NOW)).length === 0, 'after removal a second sweep lists nothing (idempotent)');
// Old slots are dropped by the sweep (> 3 days).
await owner(`update private.voice_uploads set created_at = $1::timestamptz - interval '4 days' where local_date = '2030-01-01'`, [NOW]);
await sweep(NOW);
ok(Number((await owner(`select count(*) n from private.voice_uploads where local_date = '2030-01-01'`)).rows[0].n) === 0, 'slots older than 3 days are deleted by the sweep');

// D08 purge: an ended couple's recordings go once the couple is purged (no 24 h wait).
const goneCouple = await pair(GONE1, GONE2);
await setPremium(GONE1);
const gcq = (await as(GONE1, 'select (get_daily_question()).id i')).rows[0].i;
const goneTake = await obj(GONE1, 1000, '1 minute', goneCouple);
await as(GONE1, ANSWER, [gcq, GONE1, goneTake, 5000]);
await as(GONE2, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'text')`, [gcq, GONE2]);
const goneMsg = await obj(GONE2, 1000, '1 minute', goneCouple);
await as(GONE2, MSG, [randomUUID(), gcq, GONE2, goneMsg, 5000]);
await as(GONE1, 'select unpair()');
ok(!(await sweep(NOW)).some(n => n === goneTake || n === goneMsg), 'ended but not yet purged (30-day archive): recordings kept');
await owner(`select private.purge_ended_couples(now() + interval '31 days')`);
swept = await sweep(NOW);
ok(swept.includes(goneTake) && swept.includes(goneMsg), 'after the D08 purge both partners\' recordings of that couple are listed at once');
await removeListed(swept);

// D09 delete-account: the function removes voice_objects_of_user first; the sweep is the backstop.
const evesAnswerCq = (await as(EVE, 'select (get_daily_question()).id i')).rows[0].i;
const eveTake = await obj(EVE, 1000, '1 minute', otherCouple);
await as(EVE, ANSWER, [evesAnswerCq, EVE, eveTake, 5000]);
const eveOrphan = await obj(EVE, 1000, '1 minute', otherCouple);
const outTake = await obj(OUT, 1000, '1 minute', otherCouple);
const listed = (await run('service_role', null, 'select n from voice_objects_of_user($1) n', [EVE])).rows.map(r => r.n);
ok(listed.includes(eveTake) && listed.includes(eveOrphan) && !listed.includes(outTake), 'voice_objects_of_user lists exactly the user\'s own recordings (not the partner\'s)');
ok((await run('service_role', null, 'select n from voice_objects_of_user(null) n')).rows.length === 0, 'voice_objects_of_user(null) lists nothing');
await owner('delete from auth.users where id = $1', [EVE]);
swept = await sweep(NOW);
ok(swept.includes(eveTake) && swept.includes(eveOrphan), 'after the account is deleted its recordings are listed at once (backstop)');
ok(!swept.includes(outTake), 'the surviving partner\'s recent recording is not listed');

// Grants: service only.
for (const [sql, label] of [['select voice_sweep()', 'voice_sweep'], [`select voice_objects_of_user('${MAYA}')`, 'voice_objects_of_user']]) {
  ok(perm(await errOf('authenticated', MAYA, sql)), `${label}: authenticated denied`);
  ok(perm(await errOf('anon', null, sql)), `${label}: anon denied`);
}
ok(perm(await errOf('authenticated', MAYA, 'select * from private.voice_uploads')), 'clients cannot read upload slots');
ok((await owner(`select pg_get_function_identity_arguments('public.voice_sweep'::regproc) a`)).rows[0].a === 'p_limit integer',
  'voice_sweep takes only p_limit (no caller clock)');

console.log(`\n${passed} passed, ${failed} failed`);
