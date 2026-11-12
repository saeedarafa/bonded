// BE-40b (SEC-09 optional hardening): `private.is_single_emoji` accepts only real flags.
// A regional-indicator pair must be an ISO 3166-1 alpha-2 code or one of the other RGI flags
// (AC CP CQ DG EA EU IC TA UN); a tag sequence only directly after 🏴 and only England, Scotland,
// Wales. Everything else from BE-40 is unchanged (emoji-reactions.test.mjs still covers it).
// Usage: node supabase/tests/emoji-flags.test.mjs
import fs from 'fs';
import { createDb, defaultMigrations } from './pglite-supabase.mjs';

let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };

const all = defaultMigrations();
const mine = all.findIndex(f => f.endsWith('_emoji_flag_hardening.sql'));
if (mine < 0) { console.error('FAIL emoji_flag_hardening migration not found'); process.exit(1); }

let db;
try { db = await createDb(all.slice(0, mine)); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errorOf = async (uid, sql, params) => { try { await as(uid, sql, params); return null; } catch (e) { return e.message; } };
const isEmoji = async s => (await db.query('select private.is_single_emoji($1) v', [s])).rows[0].v;

// Flags from letters / tag letters.
const flag = cc => [...cc].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
const tagFlag = (tag, cancel = true) => '\u{1F3F4}' + [...tag].map(c => String.fromCodePoint(0xE0000 + c.charCodeAt(0))).join('') + (cancel ? '\u{E007F}' : '');

const U = n => `00000000-0000-0000-0000-00000040b0${n}`;
const [MAYA, SAM] = ['01', '02'].map(U);
await db.exec(`insert into auth.users (id) values ('${MAYA}'), ('${SAM}');
  insert into questions (body, sort_order) values ('FLAGS-Q1', 1);`);
const couple = (await as(MAYA, `select create_couple('dating', '{}', null) c`)).rows[0].c;
const inv = (await as(MAYA, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
await as(SAM, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
const cq = (await as(MAYA, 'select (get_daily_question()).id i')).rows[0].i;
const answer = async (uid, body) => (await as(uid, 'insert into answers (couple_question_id, user_id, body) values ($1, $2, $3) returning id', [cq, uid, body])).rows[0].id;
const ansMaya = await answer(MAYA, 'FLAGS-ANSWER-MAYA');
const ansSam = await answer(SAM, 'FLAGS-ANSWER-SAM');
const message = async (uid, body) => (await as(uid, 'insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, $3) returning id', [cq, uid, body])).rows[0].id;
const msg1 = await message(MAYA, 'm1'), msg2 = await message(SAM, 'm2');

// ═══ Before the migration: the BE-40 rule takes any pair / any tag flag ═══
ok(await isEmoji(flag('AA')) === true && await isEmoji(tagFlag('usca')) === true, 'before: 🇦🇦 and a 🏴+usca tag flag pass (the gap SEC-09 noted)');
const react = (uid, col, id, kind) => as(uid, `insert into reactions (user_id, ${col}, kind) values ($1, $2, $3) on conflict (${col}, user_id) do update set kind = excluded.kind returning kind`, [uid, id, kind]);
await react(SAM, 'answer_id', ansMaya, flag('ZZ'));            // becomes invalid
await react(MAYA, 'answer_id', ansSam, flag('JP'));            // stays valid
await react(SAM, 'message_id', msg1, tagFlag('usca'));         // becomes invalid
await react(MAYA, 'message_id', msg2, tagFlag('gbwls'));       // stays valid
try { for (const f of all.slice(mine)) await db.exec(fs.readFileSync(f, 'utf8')); }
catch (e) { console.error(`FAIL migration: ${e.message}`); process.exit(1); }
const kinds = async () => Object.fromEntries((await db.query(`select coalesce(answer_id, message_id)::text k, kind from reactions`)).rows.map(r => [r.k, r.kind]));
{
  const k = await kinds();
  ok(Object.keys(k).length === 2 && k[ansSam] === flag('JP') && k[msg2] === tagFlag('gbwls'), 'migration: removes only the reactions the new rule rejects (🇿🇿, 🏴+usca); 🇯🇵 and Wales stay');
}

// ═══ Validator: flags ═══
const ISO = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
  CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
  GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
  KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT
  MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW
  SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG
  UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/);
const EXTRA = ['AC', 'CP', 'CQ', 'DG', 'EA', 'EU', 'IC', 'TA', 'UN'];
ok(ISO.length === 249 && new Set(ISO).size === 249, 'test list: 249 ISO 3166-1 alpha-2 codes');
{
  const accepted = [];
  for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) {
    const cc = String.fromCharCode(a, b);
    if (await isEmoji(flag(cc))) accepted.push(cc);
  }
  const want = [...ISO, ...EXTRA].sort();
  ok(accepted.length === 258 && JSON.stringify(accepted) === JSON.stringify(want),
    `all 676 pairs: exactly the 249 ISO codes + ${EXTRA.join(' ')} pass (got ${accepted.length})`);
}
const validFlags = { '🇯🇵': flag('JP'), '🇺🇸': flag('US'), '🇬🇧': flag('GB'), '🇵🇸': flag('PS'), '🇺🇳 UN': flag('UN'), '🇪🇺 EU': flag('EU'), '🇦🇽 first-ish': flag('AX'), '🇿🇼 last': flag('ZW') };
for (const [label, s] of Object.entries(validFlags)) ok(await isEmoji(s) === true, `valid flag: ${label}`);
const madeUp = { '🇦🇦': 'AA', '🇿🇿': 'ZZ', '🇺🇰 (UK is not ISO)': 'UK', '🇽🇰 Kosovo (not RGI)': 'XK', '🇪🇿 Eurozone (not a flag)': 'EZ', '🇶🇴': 'QO', '🇸🇺 old USSR': 'SU', '🇾🇺 old Yugoslavia': 'YU' };
for (const [label, cc] of Object.entries(madeUp)) ok(await isEmoji(flag(cc)) === false, `invalid flag pair: ${label}`);
ok(await isEmoji(flag('JP') + '‍' + '\u{1F602}') === true, 'a valid flag still joins with ZWJ like any element (shape rule unchanged)');
ok(await isEmoji(flag('ZZ') + '‍' + '\u{1F602}') === false, 'a made-up pair is rejected inside a ZWJ chain too');
ok(await isEmoji(flag('JP') + flag('US')) === false && await isEmoji(flag('J')) === false && await isEmoji(flag('JPU')) === false, 'two flags / one or three indicators still rejected');

// ═══ Validator: tag flags ═══
const validTag = { 'England': 'gbeng', 'Scotland': 'gbsct', 'Wales': 'gbwls' };
for (const [label, t] of Object.entries(validTag)) ok(await isEmoji(tagFlag(t)) === true, `valid tag flag: ${label}`);
ok(await isEmoji(tagFlag('gbsct') + '‍' + '\u{1F602}') === true, 'Scotland + ZWJ + 😂 (9 code points) still passes');
ok(await isEmoji('\u{1F3F4}') === true, '🏴 black flag alone still valid');
ok(await isEmoji('\u{1F3F4}\u{FE0F}') === true, '🏴️ with FE0F still valid');
const invalidTag = {
  'US-CA (valid ISO 3166-2, not RGI)': tagFlag('usca'), 'US-TX': tagFlag('ustx'), 'GB-NIR': tagFlag('gbnir'),
  'made up': tagFlag('zzzzz'), 'upper-case GBENG': tagFlag('GBENG'), 'one tag letter': tagFlag('g'),
  'six tag letters': tagFlag('gbengx'), 'gbeng without cancel tag': tagFlag('gbeng', false),
  'cancel tag alone after 🏴': '\u{1F3F4}\u{E007F}', 'tag space': tagFlag(' gbeng'.slice(0, 5)),
  'tags after 🏴️ (FE0F in between)': '\u{1F3F4}\u{FE0F}' + tagFlag('gbeng').slice(2),
  'tags after 🏳 white flag': '\u{1F3F3}' + tagFlag('gbeng').slice(2),
  'tags on 😂': '\u{1F602}' + tagFlag('gbeng').slice(2),
  'two cancel tags': tagFlag('gbeng') + '\u{E007F}',
  'England twice': tagFlag('gbeng') + tagFlag('gbeng'),
};
for (const [label, s] of Object.entries(invalidTag)) ok(await isEmoji(s) === false, `invalid tag flag: ${label}`);

// ═══ Unchanged BE-40 basics (spot check; the full matrix is emoji-reactions.test.mjs) ═══
for (const s of ['❤️', '😂', '👍🏽', '👨‍👩‍👧‍👦', '🏳️‍🌈', '🏳️‍⚧️', '1️⃣', '#️⃣', '*⃣', '©️']) ok(await isEmoji(s) === true, `still valid: ${s}`);
for (const s of ['', 'love', '😂😂', '🏽', '❤︎', '\u{E0067}']) ok(await isEmoji(s) === false, `still invalid: ${JSON.stringify(s)}`);
ok((await db.query('select private.is_single_emoji(null) v')).rows[0].v === null, 'null → null (strict)');

// ═══ Through the app path and the backstop ═══
ok((await react(SAM, 'answer_id', ansMaya, flag('FR'))).rows[0].kind === flag('FR'), 'app path: 🇫🇷 accepted');
ok((await react(SAM, 'answer_id', ansMaya, tagFlag('gbsct'))).rows[0].kind === tagFlag('gbsct'), 'app path: Scotland accepted');
const reactErr = (uid, col, id, kind) => errorOf(uid, `insert into reactions (user_id, ${col}, kind) values ($1, $2, $3) on conflict (${col}, user_id) do update set kind = excluded.kind`, [uid, id, kind]);
ok(await reactErr(SAM, 'answer_id', ansMaya, flag('AA')) === 'INVALID_REACTION', 'app path: 🇦🇦 → INVALID_REACTION');
ok(await reactErr(SAM, 'answer_id', ansMaya, tagFlag('ustx')) === 'INVALID_REACTION', 'app path: 🏴+ustx → INVALID_REACTION');
ok((await db.query(`select kind from reactions where user_id = $1 and answer_id = $2`, [SAM, ansMaya])).rows[0].kind === tagFlag('gbsct'), 'a rejected upsert keeps the previous reaction');
{
  await db.exec('set session_replication_role = replica');   // triggers off: the CHECK still holds
  let e = null; try { await db.query(`insert into reactions (user_id, message_id, kind) values ($1, $2, $3)`, [SAM, msg2, flag('QQ')]); } catch (x) { e = x.message; }
  await db.exec('set session_replication_role = origin');
  ok(/reactions_kind_single_emoji/.test(e ?? ''), 'the check constraint uses the new body (triggers disabled → 🇶🇶 rejected)');
}

// ═══ Function properties unchanged ═══
{
  const f = (await db.query(`select p.provolatile v, p.proisstrict s, p.prosecdef d, p.proconfig c, p.proparallel par
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'is_single_emoji'`)).rows;
  ok(f.length === 1 && f[0].v === 'i' && f[0].s === true && f[0].d === false && f[0].par === 's'
    && JSON.stringify(f[0].c) === JSON.stringify(['search_path=pg_catalog']), 'one function: immutable, strict, parallel safe, invoker, search_path = pg_catalog');
  const acl = async role => (await db.query(`select has_function_privilege($1, 'private.is_single_emoji(text)', 'execute') v`, [role])).rows[0].v;
  ok(await acl('authenticated') && await acl('service_role') && !(await acl('anon')), 'execute: authenticated + service_role, not anon');
}
void couple;

console.log(`\n${passed} passed, ${failed} failed`);
