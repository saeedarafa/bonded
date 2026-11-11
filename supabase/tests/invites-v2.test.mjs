// BE-04: invites v2 (D01 BND+4 digits, 48 h, one active invite; D02 limiter + link token;
// D04 solo caller joins; D05 error codes; D06 invite_preview for anon).
// Usage: node supabase/tests/invites-v2.test.mjs   (after `npm --prefix supabase/tests ci`)
// Time: the SQL core (private.*_at) takes the clock as an argument, so every case pins its
// timestamps; nothing asserts on now(). The public wrappers are exercised once end to end, with
// relative checks only.
import { createDb } from './pglite-supabase.mjs';

let db;
try { db = await createDb(); } catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };

// ── harness ──
const setSession = (uid, headers) => `select set_config('request.jwt.claim.sub', '${uid ?? ''}', false),
  set_config('request.headers', '${headers ? JSON.stringify(headers) : ''}', false)`;
// As an API role (RLS and grants exactly as a client sees them).
const run = async (role, uid, sql, params, headers) => {
  await db.exec(`set role ${role}; ${setSession(uid, headers)};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errorOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e.message; } };
const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;
// The SQL core as the function owner with a pinned clock. A counted failure comes back as a 400 body
// (code = body.message); everything else raises (code = error message); success is 'OK'.
const core = async (uid, fn, args, now, headers) => {
  await db.exec(setSession(uid, headers));
  try {
    const ph = [...args, now].map((_, i) => `$${i + 1}${i === args.length ? '::timestamptz' : ''}`).join(', ');
    // Pairing fixtures explicitly confirm archival (BE-35); refusal coverage is in archive-consent.test.mjs.
    const consent = fn === 'accept_invite_at' ? ', null, true' : '';
    const r = await db.query(`select private.${fn}(${ph}${consent}) j, current_setting('response.status', true) s`, [...args, now]);
    const { j, s } = r.rows[0];
    if (s === '400') return { code: j.message, body: j, body400: true };
    return { code: 'OK', value: j };
  } catch (e) { return { code: e.message, raised: true }; }
};
const accept = (uid, code, token, now, headers) => core(uid, 'accept_invite_at', [code, token ?? null], now, headers);
const preview = (uid, code, token, now, headers) => core(uid, 'invite_preview_at', [code, token ?? null], now, headers);
const mkInvite = async (uid, now) => {
  await db.exec(setSession(uid));
  return (await db.query(`select (x).code, (x).expires_at, (x).token from (select private.create_invite_at($1::timestamptz) x) s`, [now])).rows[0];
};
const attempts = actor => count('select count(*)::int n from private.invite_attempts where actor = $1', [actor]);
// A well-formed code that no invite holds right now (random invite codes could otherwise collide with a fixed guess).
const dead = async (seed = 0) => {
  for (let n = 9000 + seed * 13; ; n++) {
    const c = String(n % 10000).padStart(4, '0');
    if (await count('select count(*)::int n from pair_invites where code = $1', [c]) === 0) return c;
  }
};

const at = (base, ms) => new Date(new Date(base).getTime() + ms).toISOString();
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN;

// Users are created on demand; `solo` gives them a solo couple like the end of onboarding (D03).
let seq = 0;
const user = async (name, { solo = true, tz, avatar } = {}) => {
  const id = `00000000-0000-0000-0000-0000000004${String(++seq).padStart(2, '0')}`;
  await db.exec(`insert into auth.users (id) values ('${id}');
    update profiles set display_name = '${name}'${tz ? `, timezone = '${tz}'` : ''}${avatar ? `, avatar_url = '${avatar}'` : ''} where id = '${id}'`);
  const u = { id, name };
  if (solo) u.couple = (await as(id, `select create_couple('dating', array['deep_talks'], 'P') c`)).rows[0].c;
  return u;
};
await db.exec(`insert into questions (body, sort_order) values ('INV-Q1', 1), ('INV-Q2', 2)`);
const dailyFor = async (couple, body, date) => (await db.query(
  `insert into couple_questions (couple_id, question_id, source, assigned_for) select $1, id, 'daily', $3::date from questions where body = $2 returning id`,
  [couple, body, date])).rows[0].id;

// ═══ create_invite (D01) ═══
const T0 = '2026-12-01T10:00:00Z';
{
  const maya = await user('Maya'), eve = await user('Eve', { solo: false }), sam = await user('Sam');
  ok(/permission denied/.test(await errorOf('anon', null, 'select create_invite()') ?? ''), 'create_invite: anon denied');
  ok((await core(null, 'create_invite_at', [], T0)).code === 'NOT_AUTHENTICATED', 'create_invite: NOT_AUTHENTICATED without a user');
  ok((await core(eve.id, 'create_invite_at', [], T0)).code === 'NOT_PAIRED', 'create_invite: NOT_PAIRED without a couple');
  const inv1 = await mkInvite(maya.id, T0);
  ok(/^[0-9]{4}$/.test(inv1.code), `code is 4 digits (${inv1.code})`);
  ok(new Date(inv1.expires_at).toISOString() === at(T0, 48 * HOUR), 'expires 48 h after creation');
  ok(/^[A-Za-z0-9_-]{32}$/.test(inv1.token), 'token: 24 random bytes as url-safe base64 (192 bits)');
  const stored = (await db.query(`select encode(t.token_hash, 'hex') h, length(t.token_hash) n from private.invite_tokens t join pair_invites i on i.id = t.invite_id where i.code = $1`, [inv1.code])).rows[0];
  ok(stored.n === 32 && stored.h !== inv1.token, 'only a sha256 of the token is stored');
  ok(await count(`select count(*)::int n from private.invite_tokens where position(convert_to($1, 'UTF8') in token_hash) > 0 or encode(token_hash, 'base64') = $1`, [inv1.token]) === 0, 'the plain token is nowhere in the table');
  const rows = (await as(maya.id, 'select code, couple_id, inviter_id, partner_name, revoked_at from pair_invites')).rows;
  ok(rows.length === 1 && rows[0].code === inv1.code && rows[0].couple_id === maya.couple && rows[0].partner_name === 'P' && rows[0].revoked_at === null, 'inviter reads their invite row (code, couple, partner name)');
  ok((await as(sam.id, 'select * from pair_invites')).rows.length === 0, 'another user sees no invites');
  ok(/permission denied/.test(await errorOf('authenticated', maya.id, `insert into pair_invites (code, inviter_id, couple_id) values ('1234', $1, $2)`, [maya.id, maya.couple]) ?? ''), 'clients cannot insert invites');
  ok(/permission denied/.test(await errorOf('authenticated', maya.id, `update pair_invites set expires_at = 'infinity'`) ?? ''), 'clients cannot extend invites');
  ok(/permission denied/.test(await errorOf('authenticated', maya.id, 'select * from private.invite_tokens') ?? ''), 'clients cannot read token hashes');
  ok(/permission denied/.test(await errorOf('authenticated', maya.id, 'select * from private.invite_attempts') ?? ''), 'clients cannot read the attempt log');
  ok(/permission denied/.test(await errorOf('anon', null, 'select * from pair_invites') ?? ''), 'anon cannot read invites');
  ok(/permission denied/.test(await errorOf('authenticated', maya.id, `select private.accept_invite_at('1234', null, '2020-01-01Z')`) ?? ''), 'clients cannot call the clock-taking core (no way to pin the clock)');

  // One active invite per inviter: a new one revokes the old one; a retry gives a fresh code and token.
  const inv2 = await mkInvite(maya.id, at(T0, 5 * MIN));
  const mine = (await db.query(`select revoked_at from pair_invites where inviter_id = $1 order by created_at`, [maya.id])).rows;
  ok(mine.length === 2 && mine[0].revoked_at !== null && mine[1].revoked_at === null, 'a new invite revokes the previous one');
  ok(inv2.token !== inv1.token, 'each invite has its own token');
  const dup = sql => db.query(sql).then(() => '', e => e.message);
  ok(/duplicate key/.test(await dup(`insert into pair_invites (code, inviter_id, couple_id) values ('0001', '${maya.id}', '${maya.couple}')`)), 'DB: a second active invite for one inviter is rejected');
  ok(/duplicate key/.test(await dup(`insert into pair_invites (code, inviter_id, couple_id) values ('${inv2.code}', '${sam.id}', '${sam.couple}')`)), 'DB: digits are unique among active invites');
  ok(/check constraint/.test(await dup(`insert into pair_invites (code, inviter_id, couple_id) values ('ABC123', '${sam.id}', '${sam.couple}')`)), 'DB: code must be 4 digits');
  ok((await accept(sam.id, inv1.code, null, at(T0, 6 * MIN))).code === 'INVALID_CODE', 'revoked code → INVALID_CODE');
  ok((await accept(sam.id, inv1.code, inv1.token, at(T0, 6 * MIN))).code === 'INVALID_CODE', 'a revoked invite\'s token is dead too');
  ok(await count('select count(*)::int n from couple_members where user_id = $1', [sam.id]) === 1, 'failed accepts joined nobody');
}

// Expired invites don't hold their digits; live ones do. Fill the whole key space to prove both.
{
  const ana = await user('Ana'), ben = await user('Ben');
  await db.exec(`update pair_invites set revoked_at = '2026-01-01Z' where revoked_at is null and accepted_at is null`);
  await db.exec(`insert into auth.users (id) select ('10000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(0, 9999) g`);
  await db.exec(`insert into pair_invites (code, inviter_id, couple_id, created_at, expires_at)
    select lpad(g::text, 4, '0'), ('10000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '${ana.couple}', '2026-11-01Z', '2026-11-03Z' from generate_series(0, 9999) g`);
  const got = await mkInvite(ana.id, T0);   // all 10000 codes are held by expired invites: one is reclaimed
  ok(/^[0-9]{4}$/.test(got.code) && await count(`select count(*)::int n from pair_invites where revoked_at is not null and expires_at = '2026-11-03Z'`) === 1, 'an expired invite releases its digits (exactly one reclaimed)');
  await db.exec(`update pair_invites set expires_at = '2027-01-01Z' where expires_at = '2026-11-03Z'`);
  const none = await core(ben.id, 'create_invite_at', [], T0);
  ok(none.raised && none.code === 'RATE_LIMITED', 'every code held by a live invite: RATE_LIMITED (a contract code, retry later)');
  await db.exec(`delete from pair_invites where couple_id = '${ana.couple}'; delete from auth.users where id::text like '10000000-%'`);
}

// ═══ accept_invite: parsing, errors, expiry boundary, happy path ═══
{
  const maya = await user('Maya2'), sam = await user('Sam2'), eve = await user('Eve2');
  const a = await mkInvite(maya.id, T0);
  const T = at(T0, HOUR);
  for (const typed of ['', '12', '12345', 'ABCD']) {
    ok((await accept(sam.id, typed, null, T)).code === 'INVALID_CODE', `accept: ${JSON.stringify(typed)} → INVALID_CODE`);
  }
  const sam2 = await user('Sam2b');   // (the limiter would stop Sam at 5 failures)
  for (const typed of ['BND', '4 8 2 7 1', null]) {
    ok((await accept(sam2.id, typed, null, T)).code === 'INVALID_CODE', `accept: ${JSON.stringify(typed)} → INVALID_CODE`);
  }
  ok((await accept(null, a.code, null, T)).code === 'NOT_AUTHENTICATED', 'accept: NOT_AUTHENTICATED');
  ok((await accept(maya.id, a.code, null, T)).code === 'OWN_CODE', 'accept: own code → OWN_CODE');
  const exp = at(T0, 48 * HOUR);
  ok((await accept(sam.id, a.code, null, exp)).code === 'INVITE_EXPIRED', 'accept at exactly 48 h → INVITE_EXPIRED');
  ok((await accept(sam.id, a.code, null, at(exp, SEC))).code === 'INVITE_EXPIRED', 'accept after 48 h → INVITE_EXPIRED');
  ok((await accept(sam.id, `bnd·${a.code}`, a.token, at(exp, -SEC))).code === 'OK', 'accept 1 s before 48 h with a valid link token → joined');
  ok(await count('select count(*)::int n from couple_members where couple_id = $1', [maya.couple]) === 2, 'the joiner is in the inviter\'s couple');
  const used = (await db.query('select accepted_by, accepted_at from pair_invites where code = $1', [a.code])).rows[0];
  ok(used.accepted_by === sam.id && new Date(used.accepted_at).toISOString() === at(exp, -SEC), 'invite marked used by the joiner at the pinned time');
  ok((await accept(sam.id, a.code, null, at(exp, -SEC / 2))).code === 'ALREADY_PAIRED', 'retry by the joiner → ALREADY_PAIRED (no second membership)');
  ok((await accept(maya.id, '0000', null, T)).code === 'ALREADY_PAIRED', 'a caller in a full couple gets ALREADY_PAIRED before the code is looked at');
  ok((await accept(eve.id, a.code, null, at(exp, HOUR))).code === 'COUPLE_FULL', 'used code → COUPLE_FULL (even after it expired)');
  ok((await accept(eve.id, `BND ${a.code}`, null, at(exp, HOUR))).body400 === true, 'COUPLE_FULL travels as a 400 body, not a raise');
  ok((await accept(eve.id, a.code, null, at(exp, 3 * 24 * HOUR))).code === 'INVALID_CODE', 'a used code is forgotten after 48 h');
  ok((await core(maya.id, 'create_invite_at', [], T)).code === 'COUPLE_FULL', 'create_invite in a full couple → COUPLE_FULL');
}
// A couple that is full (or ended) while its invite is still unused.
{
  const zoe = await user('Zoe'), leo = await user('Leo', { solo: false }), kai = await user('Kai'), fay = await user('Fay'), fin = await user('Fin');
  const z = await mkInvite(zoe.id, T0);
  await db.exec(`insert into couple_members (couple_id, user_id) values ('${zoe.couple}', '${leo.id}')`);
  ok((await accept(kai.id, z.code, null, at(T0, MIN))).code === 'COUPLE_FULL', 'unused invite of a couple that is already full → COUPLE_FULL');
  const f = await mkInvite(fin.id, T0);
  await db.exec(`update couples set status = 'ended', ended_at = '2026-12-01Z' where id = '${fin.couple}'`);
  ok((await accept(fay.id, f.code, null, at(T0, MIN))).code === 'COUPLE_FULL', 'invite into an ended couple → COUPLE_FULL');
}

// ═══ D04: a solo caller joins; their solo couple becomes a private 30-day archive ═══
{
  const finn = await user('Finn'), ivy = await user('Ivy'), kai = await user('Kai3');
  const finnInv = await mkInvite(finn.id, T0);            // Finn answered day 1 before Ivy joined (D03)
  const ivyInv = await mkInvite(ivy.id, T0);              // Ivy has an open invite of her own too
  const cqFinn = await dailyFor(finn.couple, 'INV-Q1', '2026-12-01');
  const cqIvy = await dailyFor(ivy.couple, 'INV-Q2', '2026-12-01');
  await as(finn.id, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'D04-FINN-DAY1')`, [cqFinn, finn.id]);
  await as(ivy.id, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'D04-IVY-SOLO')`, [cqIvy, ivy.id]);
  await as(ivy.id, `insert into key_dates (couple_id, kind, date) values ($1, 'anniversary', '2024-02-02')`, [ivy.couple]);
  const T = at(T0, HOUR);
  const wrong = await accept(ivy.id, await dead(), null, T);
  ok(wrong.code === 'INVALID_CODE' && await count('select count(*)::int n from couples where id = $1', [ivy.couple]) === 1, 'a failed accept keeps the solo couple');
  ok((await accept(ivy.id, finnInv.code, finnInv.token, T)).code === 'OK', 'D04: a solo caller accepts a valid token invite → joined');
  const archived = (await db.query('select status, ended_at from couples where id = $1', [ivy.couple])).rows[0];
  ok(archived.status === 'ended' && new Date(archived.ended_at).toISOString() === T, 'D04: the caller\'s solo couple is ended at the accepted-at time');
  ok(new Date((await db.query('select left_at from couple_members where couple_id = $1', [ivy.couple])).rows[0].left_at).toISOString() === T, 'D04: her solo membership is timestamped');
  ok((await as(ivy.id, 'select * from answers where couple_question_id = $1', [cqIvy])).rows.length === 1
    && (await as(ivy.id, 'select * from key_dates where couple_id = $1', [ivy.couple])).rows.length === 1,
  'D04: the joiner retains her solo answer and key date archive');
  ok((await as(finn.id, 'select * from answers where couple_question_id = $1', [cqIvy])).rows.length === 0
    && (await as(finn.id, 'select * from couples where id = $1', [ivy.couple])).rows.length === 0,
  'D04: the new partner cannot read the joiner\'s solo archive');
  ok(new Date((await db.query('select revoked_at from pair_invites where id = (select id from pair_invites where inviter_id = $1 limit 1)', [ivy.id])).rows[0].revoked_at).toISOString() === T,
  'D04: the archived solo couple\'s open invite is revoked');
  ok((await accept(kai.id, ivyInv.code, ivyInv.token, T)).code === 'INVALID_CODE', 'her revoked invite no longer works, token or not');
  ok(await count('select count(*)::int n from couple_members where user_id = $1 and left_at is null', [ivy.id]) === 1
    && (await as(ivy.id, `select id from couples where status = 'active'`)).rows[0].id === finn.couple, 'Ivy is in exactly one active couple: Finn\'s');
  ok((await as(ivy.id, 'select * from answers where couple_question_id = $1', [cqFinn])).rows.length === 0,
  'reveal rule: Ivy cannot read Finn\'s day-1 answer after joining');
  ok((await as(ivy.id, 'select answer_count from couple_questions where id = $1', [cqFinn])).rows[0].answer_count === 1, 'she sees only the answered signal');
  ok((await as(kai.id, 'select * from answers')).rows.length === 0, 'an outsider sees no answers');
  await as(ivy.id, `insert into answers (couple_question_id, user_id, body) values ($1, $2, 'D04-IVY-DAY1')`, [cqFinn, ivy.id]);
  ok((await as(ivy.id, 'select body from answers where couple_question_id = $1 order by body', [cqFinn])).rows.map(r => r.body).join() === 'D04-FINN-DAY1,D04-IVY-DAY1',
  'reveal rule: both answers visible once she has answered');
  ok((await accept(ivy.id, finnInv.code, null, T)).code === 'ALREADY_PAIRED', 'D04: ALREADY_PAIRED only when the caller\'s couple has two members');
  await db.query(`update couples set ended_at = $1 where id = $2`, ['2026-01-01T00:00:00Z', ivy.couple]);
  await db.query(`select private.purge_ended_couples($1::timestamptz)`, ['2026-02-01T00:00:01Z']);
  ok(await count('select count(*)::int n from couples where id = $1', [ivy.couple]) === 0, 'D04: purge removes the archived solo couple after 30 days');
}

// ═══ Rate limit (D02) ═══
{
  const rex = await user('Rex'), ada = await user('Ada'), bo = await user('Bo'), cy = await user('Cy');
  const adaInv = await mkInvite(ada.id, T0);
  const L0 = '2026-12-02T08:00:00Z';
  for (let i = 0; i < 5; i++) ok((await accept(rex.id, await dead(i), null, at(L0, i * SEC))).code === 'INVALID_CODE', `typed failure ${i + 1}/5 → INVALID_CODE`);
  ok(await attempts('u:' + rex.id) === 5, 'five failures are recorded (the attempt commits, it is not rolled back)');
  const lim = await accept(rex.id, adaInv.code, null, at(L0, 6 * SEC));
  ok(lim.code === 'RATE_LIMITED' && lim.raised, 'sixth attempt → RATE_LIMITED, even with a valid code');
  ok((await preview(rex.id, adaInv.code, null, at(L0, 7 * SEC))).code === 'RATE_LIMITED', 'the budget is shared with invite_preview');
  ok(await attempts('u:' + rex.id) === 5, 'RATE_LIMITED is not itself a failure');
  ok((await accept(bo.id, await dead(), null, at(L0, 6 * SEC))).code === 'INVALID_CODE', 'another user is unaffected');
  ok((await accept(rex.id, adaInv.code, null, at(L0, 15 * MIN - SEC))).code === 'RATE_LIMITED', 'still limited just inside the window (oldest failure is 15 min - 1 s old)');
  ok((await accept(rex.id, adaInv.code, 'x'.repeat(32), at(L0, 6 * SEC))).code === 'RATE_LIMITED', 'a wrong token gets no bypass');
  ok((await accept(rex.id, adaInv.code, adaInv.token.slice(0, -1) + (adaInv.token.endsWith('A') ? 'B' : 'A'), at(L0, 6 * SEC))).code === 'RATE_LIMITED', 'a near-miss token gets no bypass');
  ok((await accept(rex.id, adaInv.code, adaInv.token, at(L0, 6 * SEC))).code === 'OK', 'a valid link token joins while the typed-code limit is hit');
  ok(await attempts('u:' + rex.id) === 5, 'a token join counts nothing');
  // The window is 15 minutes: after it, typed codes work again.
  const cyInv = await mkInvite(cy.id, at(L0, HOUR));
  for (let i = 0; i < 5; i++) await accept(bo.id, await dead(i), null, at(L0, HOUR + i * SEC));
  ok((await accept(bo.id, cyInv.code, null, at(L0, HOUR + 5 * SEC))).code === 'RATE_LIMITED', 'limited again after five new failures');
  const pending = await accept(bo.id, cyInv.code, null, at(L0, HOUR + 15 * MIN));
  ok(pending.code === 'OK' && pending.value.status === 'pending', 'after 15 min the oldest failures age out and a typed code creates a pending request');
}

// ═══ What counts as a failed attempt ═══
{
  const eve = await user('Eve3'), amy = await user('Amy'), dan = await user('Dan'), kay = await user('Kay');
  const N = '2026-12-03T08:00:00Z';
  const eveInv = await mkInvite(eve.id, at(N, -47 * HOUR));   // expires N + 1 h
  await accept(eve.id, eveInv.code, null, at(N, MIN));
  ok(await attempts('u:' + eve.id) === 0, 'OWN_CODE is not counted');
  await accept(amy.id, await dead(), null, at(N, 2 * MIN));
  ok(await attempts('u:' + amy.id) === 1, 'INVALID_CODE is counted');
  await accept(amy.id, eveInv.code, null, at(N, 2 * HOUR));
  ok(await attempts('u:' + amy.id) === 2, 'INVITE_EXPIRED is counted');
  const danInv = await mkInvite(dan.id, at(N, 3 * HOUR));
  await accept(kay.id, danInv.code, danInv.token, at(N, 4 * HOUR));
  await accept(amy.id, danInv.code, null, at(N, 5 * HOUR));
  ok(await attempts('u:' + amy.id) === 3, 'COUPLE_FULL is counted');
  ok(await attempts('u:' + kay.id) === 0, 'a successful join is not counted');
  ok(await attempts('u:' + dan.id) === 0, 'the inviter has no attempts');
  await accept(amy.id, await dead(), null, at(N, 30 * HOUR));
  ok(await attempts('u:' + amy.id) === 4, 'the failure path does not purge (that is the cron\'s job): 3 old + 1 new attempts');
  await db.query(`select private.purge_pairing_data($1::timestamptz)`, [at(N, 30 * HOUR)]);
  ok(await attempts('u:' + amy.id) === 1, 'attempts older than a day are purged by private.purge_pairing_data');
  const eve2 = await user('Eve4'), inv = await mkInvite(eve2.id, at(N, 64 * HOUR));
  const before = await count('select count(*)::int n from private.invite_attempts');
  await preview(null, inv.code, null, at(N, 64 * HOUR)); await preview(null, inv.code, null, at(N, 64 * HOUR));
  ok(await count('select count(*)::int n from private.invite_attempts') === before
    && await count('select count(*)::int n from pair_invites where inviter_id = $1 and accepted_at is null and revoked_at is null', [eve2.id]) === 1, 'a successful preview, twice, changes nothing');
}

// ═══ Link token (D02) ═══
{
  const nia = await user('Nia'), tom = await user('Tom'), una = await user('Una'), vic = await user('Vic'), wes = await user('Wes');
  const T = '2026-12-04T08:00:00Z';
  const niaInv = await mkInvite(nia.id, T);
  const tomInv = await mkInvite(tom.id, T);
  const wesInv = await mkInvite(wes.id, T);
  ok((await accept(una.id, niaInv.code, tomInv.token, at(T, MIN))).code === 'INVALID_CODE', 'another invite\'s token does not match → INVALID_CODE');
  ok(await attempts('u:' + una.id) === 1, 'a wrong token counts as a failed attempt');
  ok((await accept(una.id, `BND${niaInv.code}`, niaInv.token, at(T, 2 * MIN))).code === 'OK', 'the right token + code joins');
  ok((await accept(vic.id, niaInv.code, niaInv.token, at(T, 3 * MIN))).code === 'COUPLE_FULL', 'used invite + its token → COUPLE_FULL');
  ok((await accept(vic.id, wesInv.code, wesInv.token, at(T, 48 * HOUR))).code === 'INVITE_EXPIRED', 'a valid token does not extend the 48 h → INVITE_EXPIRED');
  ok(await attempts('u:' + vic.id) === 1, 'only the used-invite lookup counted (that invite is no longer live, so the token cannot vouch for it); the expired one did not');
  ok(await count(`select count(*)::int n from private.invite_tokens t join pair_invites p on p.id = t.invite_id where p.inviter_id in ('${nia.id}', '${tom.id}', '${wes.id}')`) === 3, 'one token hash per invite');
}

// ═══ invite_preview (D06) ═══
{
  await db.exec(`insert into private.app_settings (key, value) values ('storage_host', 'img.test') on conflict (key) do update set value = excluded.value`);
  const AVATAR = 'https://img.test/storage/v1/object/public/avatars/00000000-0000-0000-0000-000000000001/avatar.jpg';
  const maya = await user('Maya Lindqvist', { tz: 'Pacific/Auckland', avatar: AVATAR }), vic = await user('Vic2');
  const T = '2026-12-05T10:00:00Z';                        // Auckland: 5 Dec, 23:00
  const inv = await mkInvite(maya.id, T);
  const p1 = await preview(null, inv.code, null, T);
  ok(p1.code === 'OK', 'anon preview works');
  ok(JSON.stringify(Object.keys(p1.value).sort()) === JSON.stringify(['expires_at', 'inviter_answered_today', 'inviter_avatar_url', 'inviter_name']), 'preview returns only the four documented fields');
  ok(p1.value.inviter_name === 'Maya', 'first name only');
  ok(p1.value.inviter_avatar_url === null, 'avatar URL is null while the avatar bucket is private');
  ok(new Date(p1.value.expires_at).toISOString() === at(T, 48 * HOUR), 'expiry');
  ok(p1.value.inviter_answered_today === false, 'not answered yet');
  // BE-55c: "today" is the couple today (greatest(couple-local today, newest daily row)); a row dated
  // after the local today would itself be the couple today, so the boundary is shown on the 5 Dec row.
  const cq = await dailyFor(maya.couple, 'INV-Q1', '2026-12-05');
  await db.query(`insert into answers (couple_question_id, user_id, body) values ($1, $2, 'PREVIEW-SECRET-ANSWER')`, [cq, maya.id]);
  const p2 = await preview(null, inv.code, null, T);
  ok(p2.value.inviter_answered_today === true, 'timezone: at 23:00 on 5 Dec in Auckland, the 5 Dec answer is today\'s');
  ok((await preview(null, inv.code, null, at(T, 2 * HOUR))).value.inviter_answered_today === false, 'timezone: after Auckland midnight (UTC still 5 Dec) it is not');
  ok(!/PREVIEW-SECRET|Lindqvist|[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify(p2.value)), 'no answer text, surname, ids or avatar URL in the preview');
  ok((await preview(null, `BND·${inv.code}`, null, T)).code === 'OK' && (await preview(null, ` bnd ${inv.code}`, null, T)).code === 'OK', 'BND prefix, case and separators are ignored');
  const unknown = await preview(null, await dead(), null, T);
  ok(unknown.code === 'INVALID_CODE' && unknown.body400, 'unknown code → INVALID_CODE (400 body)');
  ok((await preview(null, inv.code, null, at(T, 48 * HOUR))).code === 'INVITE_EXPIRED', 'expired → INVITE_EXPIRED');
  ok((await accept(vic.id, inv.code, inv.token, at(T, 3 * HOUR))).code === 'OK', 'the previewed invite can be accepted with its valid token');
  ok((await preview(null, inv.code, null, at(T, 4 * HOUR))).code === 'COUPLE_FULL', 'used → COUPLE_FULL');
}

// ═══ anon limiter: per client IP, no raw IP stored ═══
{
  const nell = await user('Nell'); const T = '2026-12-06T08:00:00Z';
  const inv = await mkInvite(nell.id, T);
  const ip = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
  for (let i = 0; i < 5; i++) ok((await preview(null, await dead(i), null, at(T, i * SEC), ip)).code === 'INVALID_CODE', `anon failure ${i + 1}/5`);
  ok((await preview(null, inv.code, null, at(T, 6 * SEC), ip)).code === 'RATE_LIMITED', 'the sixth anon attempt from one IP → RATE_LIMITED');
  ok((await preview(null, inv.code, null, at(T, 7 * SEC), { 'x-forwarded-for': '203.0.113.10' })).code === 'OK', 'another IP is unaffected');
  ok((await preview(null, inv.code, inv.token, at(T, 8 * SEC), ip)).code === 'OK', 'the token skips the limit for anon too');
  ok(await count(`select count(*)::int n from private.invite_attempts where actor like '%203.0.113%'`) === 0
    && await count(`select count(*)::int n from private.invite_attempts where actor ~ '^ip:[0-9a-f]{64}$'`) >= 5, 'the IP is stored only as a sha256');
  for (let i = 0; i < 5; i++) await preview(null, await dead(i), null, at(T, MIN + i * SEC), { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': `1.1.1.${i}` });
  ok((await preview(null, inv.code, null, at(T, MIN + 6 * SEC), { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '9.9.9.9' })).code === 'RATE_LIMITED', 'rotating x-forwarded-for does not dodge the limit when cf-connecting-ip is set');
  ok((await preview(nell.id, await dead(), null, at(T, 2 * MIN), ip)).code === 'INVALID_CODE' && await attempts('u:' + nell.id) === 1, 'a signed-in caller is counted as the user, not the IP');
}

// ═══ Global cap (D02): an alert row, once per hour ═══
{
  const G = '2026-12-07T08:00:00Z';
  const nope = await dead();
  for (let i = 0; i < 99; i++) await preview(null, nope, null, at(G, i * SEC), { 'cf-connecting-ip': `10.1.${Math.floor(i / 250)}.${i % 250}` });
  ok(await count('select count(*)::int n from private.security_alerts') === 0, '99 failures in an hour: no alert');
  await preview(null, nope, null, at(G, 100 * SEC), { 'cf-connecting-ip': '10.2.0.1' });
  const al = (await db.query('select kind, detail from private.security_alerts')).rows;
  ok(al.length === 1 && al[0].kind === 'invite_guessing' && al[0].detail.failures_in_hour === 100, 'the 100th failure in an hour raises one invite_guessing alert');
  await preview(null, nope, null, at(G, 200 * SEC), { 'cf-connecting-ip': '10.2.0.2' });
  ok(await count('select count(*)::int n from private.security_alerts') === 1, 'one alert per hour, updated not duplicated');
  ok(/permission denied/.test(await errorOf('authenticated', null, 'select * from private.security_alerts') ?? ''), 'alerts are not readable by clients');
}

// ═══ Public wrappers end to end (real clock, relative checks only) ═══
{
  const ola = await user('Ola Nordmann'), pia = await user('Pia'), qui = await user('Qui');
  const created = (await as(ola.id, 'select (x).code, (x).expires_at, (x).token from (select create_invite() x) s')).rows[0];
  const lifetime = (await db.query(`select extract(epoch from ($1::timestamptz - created_at))::int s from pair_invites where code = $2`, [created.expires_at, created.code])).rows[0].s;
  ok(lifetime === 48 * 3600, 'create_invite: the lifetime is 48 h');
  const anon = await run('anon', null, `select invite_preview($1, $2) j, current_setting('response.status', true) s`, [`BND${created.code}`, created.token]);
  ok(anon.rows[0].j.inviter_name === 'Ola' && anon.rows[0].s !== '400', 'anon can call invite_preview through the API');
  ok(/permission denied/.test(await errorOf('anon', null, `select accept_invite('1234')`) ?? ''), 'anon cannot call accept_invite');
  const bad = await run('authenticated', qui.id, `select accept_invite($1) j, current_setting('response.status', true) s`, [await dead()]);
  ok(bad.rows[0].s === '400' && bad.rows[0].j.message === 'INVALID_CODE' && bad.rows[0].j.code === 'P0001', 'accept_invite: a wrong code answers 400 with {code: P0001, message: INVALID_CODE}');
  const good = await run('authenticated', pia.id, `select accept_invite($1, $2, true) j`, [created.code, created.token]);
  ok(good.rows[0].j === ola.couple, 'accept_invite through the API returns the couple id');
  ok(await run('authenticated', pia.id, `select accept_invite($1, $2, true) j`, [created.code, created.token]).then(() => 'no error', e => e.message) === 'ALREADY_PAIRED', 'accept_invite retry raises ALREADY_PAIRED');
}

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
