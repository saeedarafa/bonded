// BE-60 (D59, SEC-21 option A): Premium widgets, widget send + widget sign-in.
// Covers the SEC-21 BE-60 acceptance checks 1, 2, 4–9 (check 3 is the `widget` edge function's
// Deno test plus function-config.test.mjs):
//   * mint_widget_token: hash-only storage, paired + signed-in session, rotation per device, ≤ 5 live,
//     ≤ 20 mints a day, 48 h absolute lifetime (use never extends it).
//   * service-only widget_send / widget_undo / widget_state: token checked inside the definer RPC,
//     pinned search_path, revoked from anon/authenticated; the same WIDGET_AUTH for unknown, malformed,
//     expired, revoked, wrong-scope, ended-session, unpaired, re-paired and deleted-user tokens.
//   * widget send: PREMIUM_REQUIRED for a free couple (no row), either partner's Premium works, lapse
//     refused on the next call; source 'widget' (the app path cannot set it); same limits, undo and
//     client_id replay as the app.
//   * widget_state: allow-listed keys only; no answer, thread, voice or path text; free → locked shape.
//   * per-token rate limits and the purge job.
// Usage: node supabase/tests/widgets.test.mjs
import { createDb } from './pglite-supabase.mjs';
import { createHash, randomUUID } from 'node:crypto';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };
const owner = (sql, params) => db.query(sql, params);
const claims = async (uid, session) => db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false),
  set_config('request.jwt.claims', '${uid ? JSON.stringify({ sub: uid, session_id: session ?? undefined, role: 'authenticated' }) : ''}', false);`);
const run = async (role, uid, session, sql, params) => {
  await claims(uid, session);
  await db.exec(`set role ${role};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); await claims(null); }
};
const as = (uid, sql, params, session = null) => run('authenticated', uid, session, sql, params);
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const is = (e, code) => e?.message === code && e.code === 'P0001';
const perm = e => /permission denied/.test(e?.message ?? '');
const sha = t => createHash('sha256').update(t).digest('hex');
const at = (base, s) => new Date(new Date(base).getTime() + s * 1000).toISOString();
const HOUR = 3600;

// Owner-side, clock-pinned calls (the definer reads auth.uid() / request.jwt.claims).
const mintAt = async (uid, session, device, now) => {
  await claims(uid, session);
  try { return (await owner('select private.mint_widget_token_at($1, $2) j', [device, now])).rows[0].j; } finally { await claims(null); }
};
const sendW = async (token, kind, client, now) =>
  (await owner('select private.widget_send_at($1, $2, $3, $4) j', [sha(token), kind, client, now])).rows[0].j;
const undoW = async (token, id, now) => (await owner('select private.widget_undo_at($1, $2, $3) j', [sha(token), id, now])).rows[0].j;
const stateW = async (token, now) => (await owner('select private.widget_state_at($1, $2) j', [sha(token), now])).rows[0].j;
const sendApp = async (uid, kind, client, now) => {
  await claims(uid);
  try {
    return (await owner('select (r).id from (select private.send_little_thing_at($1, 1, $2, $3) r) s', [kind, client, now])).rows[0].id;
  } finally { await claims(null); }
};

const U = n => `00000000-0000-0000-0000-0000000060${n}`;
const [PRO1, PRO2, FREE1, FREE2, SOLO, NEW1, OTHER1, OTHER2] = ['01', '02', '03', '04', '05', '06', '07', '08'].map(U);
const users = [PRO1, PRO2, FREE1, FREE2, SOLO, NEW1, OTHER1, OTHER2];
await db.exec(`insert into auth.users (id) values ${users.map(u => `('${u}')`).join(', ')};
  insert into questions (body, sort_order) values ('WIDGET-Q-TODAY', 1), ('WIDGET-Q-OTD', 2);`);
const S = Object.fromEntries(users.map(u => [u, randomUUID()]));
await owner(`insert into auth.sessions (id, user_id) select (x->>'s')::uuid, (x->>'u')::uuid from jsonb_array_elements($1::jsonb) x`,
  [JSON.stringify(users.map(u => ({ u, s: S[u] })))]);
const pair = async (a, b) => {
  const couple = (await as(a, `select create_couple('dating', '{}', null) c`)).rows[0].c;
  const inv = (await as(a, 'select (x).code c, (x).token t from (select create_invite() x) s')).rows[0];
  await as(b, 'select accept_invite($1, $2, true)', [inv.c, inv.t]);
  return couple;
};
const proCouple = await pair(PRO1, PRO2);     // Premium through PRO1 only
const freeCouple = await pair(FREE1, FREE2);
await pair(OTHER1, OTHER2);
await as(SOLO, `select create_couple('dating', '{}', null)`);
await owner(`insert into entitlements (user_id, is_active, expires_at) values ($1, true, '2999-01-01')`, [PRO1]);
await owner(`update profiles set display_name = 'Maya Lovelace-Extraordinarily-Long' where id = $1`, [PRO1]);

const T0 = '2030-05-01T12:00:00Z';

// ═══ 1. Mint: hash only, session, couple, returned once ═══
const dev1 = randomUUID();
const m = (await as(PRO2, 'select mint_widget_token($1) j', [dev1], S[PRO2])).rows[0].j;
ok(/^bwt_[A-Za-z0-9_-]{43}$/.test(m.token) && m.expires_at, 'mint_widget_token returns {token: bwt_ + 43 base64url chars, expires_at}');
let row = (await owner('select * from private.widget_tokens where user_id = $1', [PRO2])).rows;
ok(row.length === 1 && row[0].token_hash === sha(m.token), 'only sha256(token) is stored (hex primary key)');
ok(!JSON.stringify(row).includes(m.token.slice(4)), 'the raw token (or its random part) appears in no column');
ok(row[0].session_id === S[PRO2] && row[0].device_id === dev1 && row[0].couple_id === proCouple
  && row[0].scopes.join() === 'send_little_thing,undo_little_thing,widget_read', 'the row binds session, device, couple and the fixed scopes');
ok(new Date(row[0].expires_at) - new Date(row[0].created_at) === 48 * HOUR * 1000, 'expires_at = created_at + 48 h');
ok(is(await errOf(() => as(PRO2, 'select mint_widget_token($1)', [dev1], null)), 'NOT_AUTHENTICATED'), 'a JWT without session_id cannot mint (NOT_AUTHENTICATED)');
ok(is(await errOf(() => as(SOLO, 'select mint_widget_token($1)', [randomUUID()], S[SOLO])), 'NOT_PAIRED'), 'a user without a partner cannot mint (NOT_PAIRED)');
ok(is(await errOf(() => as(NEW1, 'select mint_widget_token($1)', [randomUUID()], S[NEW1])), 'NOT_PAIRED'), 'a user without a couple cannot mint (NOT_PAIRED)');
ok(perm(await errOf(() => run('anon', null, null, 'select mint_widget_token($1)', [randomUUID()]))), 'anon cannot mint');
// A free user may mint (the widget shows the locked preview from fresh state).
const freeTok = (await as(FREE1, 'select mint_widget_token($1) j', [randomUUID()], S[FREE1])).rows[0].j.token;
ok(freeTok.startsWith('bwt_'), 'a free user can mint (Premium is checked on use)');

// Rotation per (user, device); ≤ 5 live; ≤ 20 a day.
const a1 = await mintAt(PRO1, S[PRO1], dev1, T0);
const a2 = await mintAt(PRO1, S[PRO1], dev1, at(T0, 60));
row = (await owner('select token_hash, revoked_at from private.widget_tokens where user_id = $1 order by created_at', [PRO1])).rows;
ok(row.length === 2 && row[0].revoked_at && !row[1].revoked_at && row[1].token_hash === sha(a2.token), 'minting again on the same device revokes the previous token');
ok(is(await errOf(() => stateW(a1.token, at(T0, 61))), 'WIDGET_AUTH'), 'the rotated token is refused (WIDGET_AUTH)');
for (let i = 0; i < 6; i++) await mintAt(PRO1, S[PRO1], randomUUID(), at(T0, 120 + i));
ok(Number((await owner(`select count(*) n from private.widget_tokens where user_id = $1 and revoked_at is null`, [PRO1])).rows[0].n) === 5,
  'at most 5 live tokens per user (the oldest are revoked)');
ok(is(await errOf(() => stateW(a2.token, at(T0, 200))), 'WIDGET_AUTH'), 'the token pushed out by the 5-token cap is refused');
for (let i = 0; i < 12; i++) await mintAt(PRO1, S[PRO1], randomUUID(), at(T0, 300 + i));
ok(is(await errOf(() => mintAt(PRO1, S[PRO1], randomUUID(), at(T0, 400))), 'RATE_LIMITED'), 'the 21st mint in 24 h is RATE_LIMITED');
ok((await mintAt(PRO1, S[PRO1], dev1, at(T0, 24 * HOUR + 1))).token, 'minting works again once the rolling 24 h has passed');
await owner('delete from private.widget_tokens where user_id = $1', [PRO1]);

// ═══ 4. Grants and definer hygiene ═══
const W = ['public.widget_send(text, text, uuid)', 'public.widget_undo(text, uuid)', 'public.widget_state(text)'];
for (const f of W) {
  const name = f.split('(')[0];
  const args = f.includes('send') ? `'x', 'hug', null` : f.includes('undo') ? `'x', null` : `'x'`;
  ok(perm(await errOf(() => run('anon', null, null, `select ${name}(${args})`))), `${f} is not executable by anon`);
  ok(perm(await errOf(() => as(PRO2, `select ${name}(${args})`, [], S[PRO2]))), `${f} is not executable by authenticated`);
  ok(is(await errOf(() => run('service_role', null, null, `select ${name}(${args})`)), 'WIDGET_AUTH'), `${f} is executable by service_role and checks the token itself`);
}
const defs = (await owner(`select p.oid::regprocedure::text f, p.prosecdef d, p.proconfig c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname = 'public' and p.proname in ('widget_send', 'widget_undo', 'widget_state', 'mint_widget_token', 'revoke_widget_tokens'))
     or (n.nspname = 'private' and p.proname in ('widget_auth', 'widget_send_at', 'widget_undo_at', 'widget_state_at', 'mint_widget_token_at',
        'send_little_thing_core', 'undo_little_thing_core', 'purge_widget_tokens', 'widget_couple_of'))`)).rows;
ok(defs.length === 14 && defs.every(d => d.d && (d.c ?? []).some(c => c.startsWith('search_path='))), 'every widget function is SECURITY DEFINER with a pinned search_path');
for (const f of ['private.widget_auth(text, text, timestamptz)', 'private.widget_send_at(text, text, uuid, timestamptz)', 'private.send_little_thing_core(uuid, text, integer, uuid, text, timestamptz)', 'private.mint_widget_token_at(uuid, timestamptz)']) {
  ok(!(await owner(`select has_function_privilege('service_role', $1, 'execute') s, has_function_privilege('authenticated', $1, 'execute') a`, [f])).rows.some(r => r.s || r.a),
    `${f} is not executable by service_role or authenticated`);
}
for (const role of ['anon', 'authenticated', 'service_role']) {
  ok(perm(await errOf(() => run(role, role === 'authenticated' ? PRO2 : null, null, 'select * from private.widget_tokens'))), `${role} cannot read private.widget_tokens`);
}
const sendArgs = (await owner(`select pg_get_function_arguments('public.send_little_thing(text, integer, uuid)'::regprocedure) a`)).rows[0].a;
ok(!/source/.test(sendArgs) && Number((await owner(`select count(*) n from pg_proc where proname = 'send_little_thing' and pronamespace = 'public'::regnamespace`)).rows[0].n) === 1,
  'public.send_little_thing has one signature and no source parameter');

// ═══ 5/6. Widget send ═══
const D = '2030-06-10T15:00:00Z';
const pro = await mintAt(PRO2, S[PRO2], randomUUID(), D);       // PRO2 has no own Premium: the partner's counts
const free = await mintAt(FREE1, S[FREE1], randomUUID(), D);
const before = Number((await owner('select count(*) n from little_things where couple_id = $1', [freeCouple])).rows[0].n);
ok(is(await errOf(() => sendW(free.token, 'hug', randomUUID(), at(D, 1))), 'PREMIUM_REQUIRED'), 'a free couple\'s widget send is PREMIUM_REQUIRED');
ok(Number((await owner('select count(*) n from little_things where couple_id = $1', [freeCouple])).rows[0].n) === before, '... and inserts no row (no free quota used)');
ok(await sendApp(FREE1, 'hug', null, at(D, 2)), 'the same free user can still send from the app');
const c1 = randomUUID();
let s = await sendW(pro.token, 'hug', c1, at(D, 10));
ok(s.id && s.same_time === false && s.at_limit === false && Object.keys(s).sort().join() === 'at_limit,id,same_time', 'a Premium couple (partner\'s Premium) can send: {id, same_time, at_limit}');
ok((await owner('select source, amount, sender_id from little_things where id = $1', [s.id])).rows[0].source === 'widget', 'the widget row has source = widget');
const appId = await sendApp(PRO2, 'kiss', null, at(D, 11));
ok((await owner('select source from little_things where id = $1', [appId])).rows[0].source === 'app', 'the app row has source = app');
const replay = await sendW(pro.token, 'hug', c1, at(D, 12));
ok(replay.id === s.id && Number((await owner('select count(*) n from little_things where client_id = $1', [c1])).rows[0].n) === 1, 'a replayed client_id returns the first result, no second row');
ok(is(await errOf(() => sendW(pro.token, 'hug', null, at(D, 13))), 'INVALID_LITTLE_THING'), 'a widget send without client_id is INVALID_LITTLE_THING');
ok(is(await errOf(() => sendW(pro.token, 'slap', randomUUID(), at(D, 14))), 'INVALID_LITTLE_THING'), 'kind is allow-listed');
// Undo: own row, ≤ 5 s, then UNDO_EXPIRED; not the partner's row.
const u1 = await sendW(pro.token, 'miss_you', randomUUID(), at(D, 20));
const undone = await undoW(pro.token, u1.id, at(D, 23));
ok(Array.isArray(undone) && undone.length === 5 && Object.keys(undone[0]).sort().join() === 'at_limit,kind', 'widget undo within 5 s → [{kind, at_limit}] x 5');
ok((await owner('select undone_at from little_things where id = $1', [u1.id])).rows[0].undone_at, '... and the row is undone');
const u2 = await sendW(pro.token, 'miss_you', randomUUID(), at(D, 30));
ok(is(await errOf(() => undoW(pro.token, u2.id, at(D, 36))), 'UNDO_EXPIRED'), 'widget undo after 5 s → UNDO_EXPIRED');
const partnerRow = await sendApp(PRO1, 'hug', null, at(D, 40));
ok(is(await errOf(() => undoW(pro.token, partnerRow, at(D, 41))), 'INVALID_LITTLE_THING'), 'widget undo of the partner\'s row → INVALID_LITTLE_THING');
// Limits are shared with the app: Premium 15 miss-yous (1 undone, 1 sent).
for (let i = 0; i < 7; i++) await sendApp(PRO2, 'miss_you', null, at(D, 100 + i));
for (let i = 0; i < 7; i++) await sendW(pro.token, 'miss_you', randomUUID(), at(D, 200 + i));
let e = await errOf(() => sendW(pro.token, 'miss_you', randomUUID(), at(D, 300)));
ok(is(e, 'LITTLE_THING_LIMIT') && e.detail === JSON.stringify({ kind: 'miss_you', more_with_premium: false }), 'app and widget sends share the Premium limit (16th miss-you → LITTLE_THING_LIMIT)');
// Lapse: refused on the next call; the read turns locked.
await owner('update entitlements set is_active = false, expires_at = $2 where user_id = $1', [PRO1, at(D, -60)]);
ok(is(await errOf(() => sendW(pro.token, 'hug', randomUUID(), at(D, 400))), 'PREMIUM_REQUIRED'), 'after a Premium lapse the next widget send is PREMIUM_REQUIRED');
let st = await stateW(pro.token, at(D, 401));
ok(st.premium === false && Object.keys(st).sort().join() === 'premium,server_now', 'a lapsed couple\'s read is the locked shape {premium:false, server_now}');
await owner(`update entitlements set is_active = true, expires_at = '2999-01-01' where user_id = $1`, [PRO1]);
st = await stateW(free.token, at(D, 402));
ok(st.premium === false && Object.keys(st).sort().join() === 'premium,server_now', 'a free couple\'s read is the locked shape');

// ═══ 8. Read: allow-listed keys only, no private text ═══
const now = new Date().toISOString();
const rd = await mintAt(PRO1, S[PRO1], randomUUID(), now);
const today = (await as(PRO1, 'select (get_daily_question()).id i')).rows[0].i;
await as(PRO1, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'SECRET-ANSWER-PRO1')`, [today, PRO1]);
await as(PRO2, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'SECRET-ANSWER-PRO2')`, [today, PRO2]);
await as(PRO1, `insert into thread_messages (client_id, couple_question_id, user_id, body) values (gen_random_uuid(), $1, $2, 'SECRET-THREAD')`, [today, PRO1]);
// An on-this-day row a month ago, answered by both (one by voice); triggers off to backdate it.
await db.exec('set session_replication_role = replica');
const otd = (await owner(`insert into couple_questions (couple_id, question_id, source, assigned_for)
  select $1, q.id, 'daily', (now() at time zone 'UTC')::date - interval '1 month' from questions q where q.body = 'WIDGET-Q-OTD' returning id`, [proCouple])).rows[0].id;
await owner(`insert into answers (couple_question_id, user_id, body) values ($1, $2, 'SECRET-OTD-ANSWER')`, [otd, PRO1]);
await owner(`insert into answers (couple_question_id, user_id, kind, voice_path, voice_duration_ms) values ($1, $2, 'voice', 'SECRET-VOICE-PATH/a.m4a', 1000)`, [otd, PRO2]);
await db.exec('set session_replication_role = origin');
await owner(`insert into key_dates (couple_id, kind, date) values ($1, 'anniversary', '2021-01-15'), ($1, 'together_since', '2020-02-29')`, [proCouple]);
await owner(`insert into key_dates (couple_id, kind, user_id, date) values ($1, 'birthday', $2, '1995-12-24')`, [proCouple, PRO2]);
st = await stateW(rd.token, now);
const json = JSON.stringify(st);
const KEYS = 'days_in_bonded,days_together,last_from_partner,little_things,mascot,next_key_dates,on_this_day,partner_first_name,premium,ritual_time,server_now,streak,today,token_expires_at';
ok(Object.keys(st).sort().join() === KEYS, `Premium read returns exactly the allow-listed keys (${Object.keys(st).sort().join()})`);
ok(!/SECRET-|voice|body|path|url/i.test(json), 'no answer, thread, voice path or URL text anywhere in the read');
ok(!json.includes(rd.token) && !json.includes(sha(rd.token)) && !json.includes(rd.token.slice(4)), 'the read never returns the token or its hash');
ok(st.today?.question_text === 'WIDGET-Q-TODAY' && st.today.me_answered === true && st.today.partner_answered === true
  && Object.keys(st.today).sort().join() === 'couple_question_id,me_answered,partner_answered,question_text', 'today: question text + answered booleans only');
ok(st.on_this_day?.question_text === 'WIDGET-Q-OTD' && Object.keys(st.on_this_day).sort().join() === 'ago,couple_question_id,date,question_text', 'on this day: catalogue question text, date and ago only');
ok(st.mascot === 'together', 'mascot: together once both answered today');
ok(Array.isArray(st.next_key_dates) && st.next_key_dates.length <= 2 && st.next_key_dates.every(k => Object.keys(k).sort().join() === 'date,days_until,kind,whose,years'),
  'next key dates: kind, date, days_until, years, whose (no title)');
ok(typeof st.days_together === 'number' && st.days_together > 2000, 'days together counts from together_since');
ok(Object.keys(st.streak).sort().join() === 'current,next_badge,saver_available', 'streak: current, next badge, saver available');
ok(Array.isArray(st.little_things) && st.little_things.length === 5, 'per-kind at_limit for the five kinds');
ok(st.last_from_partner === null || Object.keys(st.last_from_partner).sort().join() === 'count,kind,sent_at', 'last little thing from the partner: kind, count, time only');
const pstate = await stateW(pro.token, at(D, 500));
ok(pstate.last_from_partner?.kind === 'hug' && pstate.partner_first_name === 'Maya', 'the partner\'s last little thing (kind, time) and first name ≤ 20 chars');

// ═══ 7. Revocation and refusal (all the same WIDGET_AUTH) ═══
const fresh = async (u) => mintAt(u, S[u], randomUUID(), D);
ok(is(await errOf(() => stateW('bwt_unknown', D)), 'WIDGET_AUTH'), 'an unknown token → WIDGET_AUTH');
ok(is(await errOf(() => owner('select private.widget_state_at($1, $2)', ['not-hex', D])), 'WIDGET_AUTH'), 'a malformed hash → WIDGET_AUTH');
let k = await fresh(PRO2);
ok(is(await errOf(() => stateW(k.token, at(D, 48 * HOUR))), 'WIDGET_AUTH'), 'a token at expires_at → WIDGET_AUTH');
await stateW(k.token, at(D, 47 * HOUR));
ok((await owner('select expires_at from private.widget_tokens where token_hash = $1', [sha(k.token)])).rows[0].expires_at.getTime() === new Date(at(D, 48 * HOUR)).getTime(),
  'use updates last_used_at only and never extends expires_at');
await owner(`update private.widget_tokens set scopes = array['widget_read'] where token_hash = $1`, [sha(k.token)]);
ok(is(await errOf(() => sendW(k.token, 'hug', randomUUID(), at(D, 5))), 'WIDGET_AUTH'), 'a token without the send scope → WIDGET_AUTH');
k = await fresh(PRO2);
await as(PRO2, 'select revoke_widget_tokens(null)', [], S[PRO2]);
ok(is(await errOf(() => stateW(k.token, at(D, 5))), 'WIDGET_AUTH'), 'sign-out: revoke_widget_tokens() → WIDGET_AUTH');
ok(perm(await errOf(() => run('anon', null, null, 'select revoke_widget_tokens(null)'))), 'anon cannot call revoke_widget_tokens');
const dA = randomUUID(), dB = randomUUID();
const kA = await mintAt(PRO2, S[PRO2], dA, D), kB = await mintAt(PRO2, S[PRO2], dB, D);
await as(PRO2, 'select revoke_widget_tokens($1)', [dA], S[PRO2]);
ok(is(await errOf(() => stateW(kA.token, at(D, 5))), 'WIDGET_AUTH') && (await stateW(kB.token, at(D, 5))).premium === true, 'revoke_widget_tokens(device) revokes only that device');
const otherK = await fresh(OTHER1);
await as(PRO2, 'select revoke_widget_tokens(null)', [], S[PRO2]);
ok((await stateW(otherK.token, at(D, 5))).premium === false, 'a user cannot revoke another user\'s tokens');
k = await fresh(PRO2);
await owner('delete from auth.sessions where id = $1', [S[PRO2]]);
ok(is(await errOf(() => stateW(k.token, at(D, 5))), 'WIDGET_AUTH'), 'sign-out without network: the minting session is gone → WIDGET_AUTH');
S[PRO2] = randomUUID();
await owner('insert into auth.sessions (id, user_id) values ($1, $2)', [S[PRO2], PRO2]);
// Unpair: the token dies and the row is revoked; re-pairing does not revive the old token.
const kU = await fresh(FREE2), kU2 = await fresh(FREE1);
await as(FREE2, 'select unpair()', [], S[FREE2]);
ok(is(await errOf(() => stateW(kU.token, at(D, 5))), 'WIDGET_AUTH') && is(await errOf(() => stateW(kU2.token, at(D, 5))), 'WIDGET_AUTH'),
  'unpair: both partners\' tokens → WIDGET_AUTH');
ok(Number((await owner(`select count(*) n from private.widget_tokens where couple_id = $1 and revoked_at is null`, [freeCouple])).rows[0].n) === 0,
  'unpair revokes the couple\'s tokens (defence in depth)');
await pair(FREE1, FREE2);
ok(is(await errOf(() => stateW(kU2.token, at(D, 6))), 'WIDGET_AUTH'), 'a token from the previous couple stays refused after a re-pair');
// Delete account: the rows cascade.
const kD = await fresh(OTHER2);
await owner('delete from auth.users where id = $1', [OTHER2]).catch(async () => {
  await owner('delete from profiles where id = $1', [OTHER2]); await owner('delete from auth.users where id = $1', [OTHER2]);
});
ok(Number((await owner('select count(*) n from private.widget_tokens where user_id = $1', [OTHER2])).rows[0].n) === 0, 'delete-account: the user\'s token rows cascade away');
ok(is(await errOf(() => stateW(kD.token, at(D, 5))), 'WIDGET_AUTH'), '... and the token → WIDGET_AUTH');
ok(is(await errOf(() => stateW(otherK.token, at(D, 5))), 'WIDGET_AUTH'), 'the partner of a deleted user (couple no longer paired) → WIDGET_AUTH');

// ═══ 9. Rate limits and purge ═══
const R = '2030-07-01T10:00:00Z';
const rl = await mintAt(PRO2, S[PRO2], randomUUID(), R);
for (let i = 0; i < 30; i++) await sendW(rl.token, 'kiss', randomUUID(), at(R, i));
ok(is(await errOf(() => sendW(rl.token, 'kiss', randomUUID(), at(R, 40))), 'RATE_LIMITED'), 'the 31st send/undo in 10 min on one token → RATE_LIMITED');
ok((await sendW(rl.token, 'kiss', randomUUID(), at(R, 601))).id, 'a new 10-minute window allows sends again');
for (let i = 0; i < 120; i++) await stateW(rl.token, at(R, 700 + i));
ok(is(await errOf(() => stateW(rl.token, at(R, 900))), 'RATE_LIMITED'), 'the 121st read in an hour → RATE_LIMITED');
ok((await stateW(rl.token, at(R, 700 + HOUR))).premium === true, 'a new hour allows reads again');
const n0 = Number((await owner('select count(*) n from private.widget_tokens')).rows[0].n);
const purged = (await owner(`select private.purge_widget_tokens('2031-01-01') n`)).rows[0].n;
ok(purged === n0 && Number((await owner('select count(*) n from private.widget_tokens')).rows[0].n) === 0, 'purge deletes rows 7 days past expiry or revocation');
const keep = await mintAt(PRO2, S[PRO2], randomUUID(), R);
ok((await owner(`select private.purge_widget_tokens($1) n`, [at(R, 3 * 24 * HOUR)])).rows[0].n === 0 && keep.token, 'purge keeps rows within 7 days of expiry');

console.log(`\n${passed} passed, ${failed} failed`);
