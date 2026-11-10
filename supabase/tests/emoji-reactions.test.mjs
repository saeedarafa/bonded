// BE-40 (D45): a reaction is exactly one system emoji, validated in the database; one per user per
// target (another emoji replaces, delete removes); old kinds migrate love→❤️ laugh→😂 wow→😮 spark→🔥;
// ❤️ (with or without U+FE0F) counts toward the Hearts-given badge. RLS and the reveal rule unchanged.
// Usage: node supabase/tests/emoji-reactions.test.mjs
import fs from 'fs';
import { createDb, defaultMigrations } from './pglite-supabase.mjs';

let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };

const all = defaultMigrations();
const mine = all.findIndex(f => f.endsWith('_emoji_reactions.sql'));
if (mine < 0) { console.error('FAIL emoji_reactions migration not found'); process.exit(1); }

let db;
try { db = await createDb(all.slice(0, mine)); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errorOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e.message; } };
const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;

const U = n => `00000000-0000-0000-0000-0000000040${n}`;
const [MAYA, SAM, EVE, OUT, NEW] = ['01', '02', '03', '04', '05'].map(U);
await db.exec(`insert into auth.users (id) values ${[MAYA, SAM, EVE, OUT, NEW].map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) values ('EMOJI-Q1', 1), ('EMOJI-Q2', 2);`);

const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  return couple;
};
const couple = await pair(MAYA, SAM);
const cq = (await as(MAYA, 'select (get_daily_question()).id i')).rows[0].i;
const answer = async (uid, q, body) => (await as(uid, 'insert into answers (couple_question_id, user_id, body) values ($1, $2, $3) returning id', [q, uid, body])).rows[0].id;
const ansMaya = await answer(MAYA, cq, 'EMOJI-ANSWER-MAYA');
const ansSam = await answer(SAM, cq, 'EMOJI-ANSWER-SAM');
const message = async (uid, body) => (await as(uid, 'insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, $3) returning id', [cq, uid, body])).rows[0].id;
const msg1 = await message(MAYA, 'm1'), msg2 = await message(MAYA, 'm2');

// ═══ Migration mapping: rows written with the D14 enum ═══
await db.query(`insert into reactions (user_id, answer_id, kind) values ($1, $2, 'love'), ($3, $4, 'laugh')`, [SAM, ansMaya, MAYA, ansSam]);
await db.query(`insert into reactions (user_id, message_id, kind) values ($1, $2, 'wow'), ($1, $3, 'spark')`, [SAM, msg1, msg2]);
try { await db.exec(fs.readFileSync(all[mine], 'utf8')); for (const f of all.slice(mine + 1)) await db.exec(fs.readFileSync(f, 'utf8')); }
catch (e) { console.error(`FAIL migration: ${e.message}`); process.exit(1); }
const kindOf = async (uid, col, id) => (await db.query(`select kind from reactions where user_id = $1 and ${col} = $2`, [uid, id])).rows[0]?.kind;
ok(await kindOf(SAM, 'answer_id', ansMaya) === '❤️', 'migration: love → ❤️ (U+2764 U+FE0F)');
ok(await kindOf(MAYA, 'answer_id', ansSam) === '\u{1F602}', 'migration: laugh → 😂');
ok(await kindOf(SAM, 'message_id', msg1) === '\u{1F62E}', 'migration: wow → 😮');
ok(await kindOf(SAM, 'message_id', msg2) === '\u{1F525}', 'migration: spark → 🔥');
ok(await count('select count(*)::int n from reactions') === 4, 'migration keeps every row');
ok((await db.query(`select data_type from information_schema.columns where table_name = 'reactions' and column_name = 'kind'`)).rows[0].data_type === 'text'
  && !(await db.query(`select 1 from pg_type where typname = 'reaction_kind'`)).rows.length, 'kind is text now; the reaction_kind enum is dropped');
ok((await db.query(`select is_nullable from information_schema.columns where table_name = 'reactions' and column_name = 'kind'`)).rows[0].is_nullable === 'NO', 'kind stays NOT NULL');

// ═══ Validator ═══
const isEmoji = async s => (await db.query('select private.is_single_emoji($1) v', [s])).rows[0].v;
const valid = {
  '❤️ (quick row)': '❤️', '😂': '😂', '😮': '😮', '🥹': '🥹', '🔥': '🔥',
  '❤ bare U+2764': '❤', '👍🏽 skin tone': '👍🏽', '🫶🏿 skin tone (newer)': '🫶🏿',
  '👨‍👩‍👧‍👦 ZWJ family': '👨‍👩‍👧‍👦', '👨🏻‍👩🏼‍👧🏽‍👦🏾 family, four skin tones': '👨🏻‍👩🏼‍👧🏽‍👦🏾',
  '🧑🏻‍❤️‍💋‍🧑🏼 kiss with skin tones': '🧑🏻‍❤️‍💋‍🧑🏼', '❤️‍🔥 heart on fire': '❤️‍🔥', '🏳️‍🌈 rainbow flag': '🏳️‍🌈',
  '🏳️‍⚧️ ZWJ + FE0F at the end': '🏳️‍⚧️', '🇯🇵 flag': '🇯🇵', '🇺🇳 flag': '🇺🇳',
  '🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scotland (tag sequence)': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🏴 black flag alone': '🏴',
  '1️⃣ keycap': '1️⃣', '#️⃣ keycap': '#️⃣', '*⃣ keycap without FE0F': '*⃣',
  '☺️ BMP with FE0F': '☺️', '©️': '©️', '⭐': '⭐', '🩷 pink heart': '🩷', '🫩 Emoji 16': '\u{1FAE9}',
  '🧑‍🧑‍🧒‍🧒 family (Emoji 15.1)': '🧑‍🧑‍🧒‍🧒',
};
for (const [label, s] of Object.entries(valid)) ok(await isEmoji(s) === true, `valid: ${label}`);
const invalid = {
  'empty': '', 'text "love"': 'love', 'one letter': 'a', 'accented letter': 'ü', 'digit alone': '1', '# alone': '#',
  'two emoji': '😂😂', '❤️🔥 without a joiner': '❤️🔥', 'emoji + text': '😂lol', 'leading space': ' 😂', 'trailing space': '😂 ',
  'trailing newline': '😂\n', 'one regional indicator': '🇯', 'three regional indicators': '🇯🇵🇺', 'two flags': '🇯🇵🇺🇸',
  'leading ZWJ': '‍😂', 'trailing ZWJ': '😂‍', 'double ZWJ': '😂‍‍😂', 'lone skin tone': '🏽',
  'two skin tones': '👍🏽🏽', 'FE0E text presentation': '❤︎', 'lone FE0F': '️', 'lone keycap mark': '⃣',
  'RTL override': '😂‮', 'zero-width space': '😂​', 'lone tag': '\u{E0067}',
  'tag sequence without cancel tag': '🏴\u{E0067}\u{E0062}', 'tags on a non-flag': '😂\u{E0067}\u{E007F}',
  'non-emoji symbol ★ (U+2605)': '★', 'non-emoji symbol ☊ (U+260A)': '☊', 'alchemical symbol': '\u{1F700}',
  'squared Latin letter 🄰': '\u{1F130}', 'CJK': '愛', 'Arabic': 'حب',
  'five joiners (6 people)': '👨‍👩‍👧‍👦‍👦‍👦', '17 code points, well-formed otherwise': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}\u200D\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}\u200D\u{1F602}',
};
for (const [label, s] of Object.entries(invalid)) ok(await isEmoji(s) === false, `invalid: ${label}`);
{
  const scot = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';
  ok([...`${scot}\u200D${scot}\u200D\u{1F602}`].length === 17 && await isEmoji(`${scot}\u200D\u{1F602}`), 'the 17-code-point case fails on the length cap alone (a 9-code-point version passes)');
}
ok((await db.query('select private.is_single_emoji(null) v')).rows[0].v === null, 'null is not an emoji (strict); NOT NULL rejects it on the table');
ok(await isEmoji('🔥'.repeat(1)) && !(await isEmoji('x'.repeat(10000))), 'a very long string is rejected cheaply');

// ═══ Table behaviour as the app (authenticated JWT) ═══
const react = (uid, col, id, kind) => as(uid, `insert into reactions (user_id, ${col}, kind) values ($1, $2, $3) on conflict (${col}, user_id) do update set kind = excluded.kind returning kind`, [uid, id, kind]);
const reactErr = (uid, col, id, kind) => errorOf('authenticated', uid, `insert into reactions (user_id, ${col}, kind) values ($1, $2, $3) on conflict (${col}, user_id) do update set kind = excluded.kind`, [uid, id, kind]);
ok((await react(SAM, 'answer_id', ansMaya, '🥹')).rows[0].kind === '🥹' && await count('select count(*)::int n from reactions where answer_id = $1 and user_id = $2', [ansMaya, SAM]) === 1, 'another emoji replaces mine (upsert), still one row');
ok((await react(SAM, 'answer_id', ansMaya, '👨‍👩‍👧‍👦')).rows[0].kind === '👨‍👩‍👧‍👦', 'a picker ZWJ emoji is accepted through the app path');
ok((await react(SAM, 'answer_id', ansMaya, '🇯🇵')).rows[0].kind === '🇯🇵', 'a flag is accepted through the app path');
ok((await react(SAM, 'answer_id', ansMaya, '❤')).rows[0].kind === '❤️', 'a bare ❤ is stored as ❤️ (one spelling for counts)');
for (const [label, bad] of [['text', 'love'], ['two emoji', '😂😂'], ['empty', ''], ['over-long', '😂'.repeat(20)], ['ZWJ chain of 6', '👨‍👩‍👧‍👦‍👦‍👦']]) {
  ok(await reactErr(SAM, 'answer_id', ansMaya, bad) === 'INVALID_REACTION', `${label} → INVALID_REACTION (insert/upsert)`);
}
ok(await kindOf(SAM, 'answer_id', ansMaya) === '❤️', 'a rejected upsert leaves the previous reaction');
ok(/null value|INVALID_REACTION/.test(await reactErr(SAM, 'answer_id', ansMaya, null) ?? ''), 'null kind rejected');
ok(await errorOf('authenticated', SAM, `update reactions set kind = 'wow' where user_id = $1 and answer_id = $2`, [SAM, ansMaya]) === 'INVALID_REACTION', 'a direct update to text → INVALID_REACTION');
await as(SAM, 'delete from reactions where user_id = $1 and answer_id = $2', [SAM, ansMaya]);
ok(await count('select count(*)::int n from reactions where answer_id = $1 and user_id = $2', [ansMaya, SAM]) === 0, 'tapping the same emoji = delete own row');
ok((await react(MAYA, 'message_id', msg1, '😂')).rows[0].kind === '😂' && (await react(MAYA, 'message_id', msg1, '🔥')).rows[0].kind === '🔥'
  && await count('select count(*)::int n from reactions where message_id = $1 and user_id = $2', [msg1, MAYA]) === 1, 'message reactions: replace keeps one row per user');
{
  await db.exec(`set session_replication_role = replica`);   // triggers off: the CHECK still holds
  let e = null; try { await db.query(`insert into reactions (user_id, answer_id, kind) values ($1, $2, 'love')`, [SAM, ansMaya]); } catch (x) { e = x.message; }
  await db.exec(`set session_replication_role = origin`);
  ok(/reactions_kind_single_emoji/.test(e ?? ''), 'the check constraint backs the trigger (triggers disabled → still rejected)');
}

// ═══ RLS and the reveal rule are unchanged ═══
const pairOut = await pair(EVE, OUT);
ok(/row-level security/.test(await reactErr(EVE, 'answer_id', ansMaya, '😂') ?? ''), 'another couple cannot react to our answer');
ok((await as(EVE, 'select * from reactions')).rows.length === 0, 'another couple sees none of our reactions');
ok((await run('anon', null, 'select * from reactions').then(r => r.rows.length, () => 0)) === 0, 'anon sees no reactions');
ok(/row-level security|permission denied/.test(await errorOf('anon', null, `insert into reactions (user_id, answer_id, kind) values ($1, $2, '😂')`, [SAM, ansMaya]) ?? ''), 'anon cannot react');
await as(SAM, `update reactions set kind = '😮' where user_id = $1`, [MAYA]);
ok(await kindOf(MAYA, 'message_id', msg1) === '🔥', 'a partner cannot change my reaction');
{
  const cqOut = (await as(EVE, 'select (get_daily_question()).id i')).rows[0].i;
  const locked = await answer(EVE, cqOut, 'EMOJI-LOCKED');
  ok(/row-level security/.test(await reactErr(OUT, 'answer_id', locked, '❤️') ?? ''), 'reveal rule: a partner who has not answered cannot react to the locked answer');
  ok((await as(OUT, 'select * from answers')).rows.length === 0, 'reveal rule: ... and cannot read it');
  void pairOut;
}

// ═══ Hearts given (personal badge, ❤️ only) ═══
// Catalogue-driven: nothing is awarded while the badge row isn't loaded.
await db.query('delete from reactions');
const hearts = async uid => count(`select count(*)::int n from badge_awards where badge_slug = 'hearts-given' and user_id = $1`, [uid]);
const msgs = []; for (let i = 0; i < 5; i++) msgs.push(await message(SAM, `h${i}`));
await react(MAYA, 'message_id', msgs[0], '❤️');
ok(await hearts(MAYA) === 0, 'no badge row loaded → no award');
await db.exec(`insert into badges (slug, kind, owner, threshold, title, description, priority, status) values ('hearts-given', 'achievement', 'personal', 3, 'Hearts given', 'test', 'P1', 'placeholder')`);
await react(MAYA, 'message_id', msgs[1], '😂');
await react(MAYA, 'message_id', msgs[2], '🔥');
ok(await hearts(MAYA) === 0, 'other emoji do not count as hearts');
await react(MAYA, 'message_id', msgs[1], '❤');                 // bare ❤ replaces 😂
ok(await hearts(MAYA) === 0, '2 hearts < threshold 3');
await as(MAYA, 'delete from reactions where user_id = $1 and message_id = $2', [MAYA, msgs[1]]);
await react(MAYA, 'message_id', msgs[1], '❤️');
ok(await hearts(MAYA) === 0, 'removing and re-adding a heart does not inflate the count');
await react(MAYA, 'message_id', msgs[2], '❤️');                    // 🔥 → ❤️ (update path)
ok(await hearts(MAYA) === 1, 'the third heart (an upsert from 🔥) awards Hearts given');
await react(MAYA, 'message_id', msgs[3], '❤️');
ok(await hearts(MAYA) === 1, 'awarded once');
ok((await as(MAYA, `select badge_slug from badge_awards where user_id = $1`, [MAYA])).rows.some(r => r.badge_slug === 'hearts-given'), 'the owner reads the award');
ok((await as(SAM, `select * from badge_awards where badge_slug = 'hearts-given'`)).rows.length === 0, 'personal award: the partner does not read it');
ok((await as(EVE, `select * from badge_awards where badge_slug = 'hearts-given'`)).rows.length === 0, 'other couples do not read it');
await db.query(`update reactions set kind = '😂' where user_id = $1`, [MAYA]);
ok(await hearts(MAYA) === 1, 'an award is never taken back');
ok((await db.query(`select private.is_love_reaction($1) a, private.is_love_reaction($2) b, private.is_love_reaction('😍') c`, ['❤', '❤️'])).rows[0].a === true
  && (await db.query(`select private.is_love_reaction($1) b`, ['❤️'])).rows[0].b === true
  && (await db.query(`select private.is_love_reaction('😍') c`)).rows[0].c === false, 'is_love_reaction: ❤ and ❤️ yes, 😍 no');

// ═══ Grants: helpers are not reachable by anon; clients can't award badges ═══
for (const f of ['private.is_single_emoji(text)', 'private.is_love_reaction(text)', 'private.award_hearts_given()', 'private.reactions_validate_kind()']) {
  ok(!(await db.query(`select has_function_privilege('anon', $1, 'execute') x`, [f])).rows[0].x, `anon cannot execute ${f}`);
}
ok(!(await db.query(`select has_function_privilege('authenticated', 'private.award_hearts_given()', 'execute') x`)).rows[0].x, 'authenticated cannot call the award trigger function');
void NEW; void couple;

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
