// BE-28 (D36): invite_link() adds a fresh link token to the caller's open invite without replacing
// the code or earlier links; accept_invite / invite_preview accept any token of the invite (D02
// semantics unchanged); create_invite still revokes the old invite with all its tokens.
// Usage: node supabase/tests/invite-link.test.mjs   (after `npm --prefix supabase/tests ci`)
// Time: the SQL core (private.*_at) takes the clock as an argument; nothing asserts on now().
import { readFileSync } from 'node:fs';
import { createDb, defaultMigrations } from './pglite-supabase.mjs';

const NEW_MIGRATION = '20261103120000_invite_link.sql';
const all = defaultMigrations();
const newFile = all.find(f => f.endsWith(NEW_MIGRATION));
let db, rest;
try {
  if (!newFile) throw new Error(`${NEW_MIGRATION} not found`);
  // Apply everything before this migration first, so a token minted under the old one-per-invite
  // table can be checked after the upgrade; then the rest in order.
  const idx = all.indexOf(newFile);
  db = await createDb(all.slice(0, idx));
  rest = all.slice(idx);
} catch (e) { console.error(`FAIL ${e.message}`); process.exit(1); }
let passed = 0, failed = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (c) passed++; else { failed++; process.exitCode = 1; } };

// ── harness (same shape as invites-v2.test.mjs) ──
const setSession = (uid, headers) => `select set_config('request.jwt.claim.sub', '${uid ?? ''}', false),
  set_config('request.headers', '${headers ? JSON.stringify(headers) : ''}', false)`;
const run = async (role, uid, sql, params) => {
  await db.exec(`set role ${role}; ${setSession(uid)};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const errorOf = async (role, uid, sql, params) => { try { await run(role, uid, sql, params); return null; } catch (e) { return e.message; } };
const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;
const core = async (uid, fn, args, now) => {
  await db.exec(setSession(uid));
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
const accept = (uid, code, token, now) => core(uid, 'accept_invite_at', [code, token ?? null], now);
const preview = (uid, code, token, now) => core(uid, 'invite_preview_at', [code, token ?? null], now);
const mkInvite = async (uid, now) => {
  await db.exec(setSession(uid));
  return (await db.query(`select (x).code, (x).expires_at, (x).token from (select private.create_invite_at($1::timestamptz) x) s`, [now])).rows[0];
};
// invite_link core: { isNull } when SQL null, { code } for a raised error, else the row.
const link = async (uid, now) => {
  await db.exec(setSession(uid));
  try {
    const r = (await db.query(`select x is null nul, (x).code, (x).expires_at, (x).token from (select private.invite_link_at($1::timestamptz) x) s`, [now])).rows[0];
    return r.nul ? { isNull: true } : { ...r, isNull: false };
  } catch (e) { return { error: e.message }; }
};
const tokensOf = code => count(`select count(*)::int n from private.invite_tokens t join pair_invites i on i.id = t.invite_id where i.code = $1 and i.revoked_at is null and i.accepted_at is null`, [code]);
const at = (base, ms) => new Date(new Date(base).getTime() + ms).toISOString();
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN;

let seq = 0;
const user = async (name, { solo = true } = {}) => {
  const id = `00000000-0000-0000-0000-0000000028${String(++seq).padStart(2, '0')}`;
  await db.exec(`insert into auth.users (id) values ('${id}'); update profiles set display_name = '${name}' where id = '${id}'`);
  const u = { id, name };
  if (solo) u.couple = (await as(id, `select create_couple('dating', array['deep_talks'], 'P') c`)).rows[0].c;
  return u;
};

// ═══ upgrade: a link shared before this migration keeps working ═══
const T0 = '2026-12-01T10:00:00Z';
const legacyInviter = await user('Lea');
const legacy = await mkInvite(legacyInviter.id, T0);
for (const f of rest) await db.exec(readFileSync(f, 'utf8'));
{
  const joiner = await user('Lou');
  ok((await preview(joiner.id, legacy.code, legacy.token, at(T0, MIN))).code === 'OK', 'upgrade: a pre-migration link token still previews');
  ok((await accept(joiner.id, legacy.code, legacy.token, at(T0, 2 * MIN))).code === 'OK', 'upgrade: a pre-migration link token still joins');
}

// ═══ access ═══
{
  ok(/permission denied/.test(await errorOf('anon', null, 'select invite_link()') ?? ''), 'invite_link: anon denied (authenticated only)');
  ok((await link(null, T0)).error === 'NOT_AUTHENTICATED', 'invite_link: NOT_AUTHENTICATED without a user');
  ok(/permission denied/.test(await errorOf('authenticated', legacyInviter.id, 'select private.invite_link_at(now())') ?? ''), 'invite_link: the core is not callable by clients');
  ok(/permission denied/.test(await errorOf('authenticated', legacyInviter.id, 'select * from private.invite_tokens') ?? ''), 'clients cannot read token hashes');
  const nobody = await user('Ned', { solo: false });
  ok((await link(nobody.id, T0)).isNull, 'no couple → null');
  const solo = await user('Sol');
  ok((await link(solo.id, T0)).isNull, 'solo couple without an invite → null');
}

// ═══ a fresh token, same code; old and new links both work ═══
{
  const maya = await user('Maya'), sam = await user('Sam'), tia = await user('Tia');
  const inv = await mkInvite(maya.id, T0);
  const l1 = await link(maya.id, at(T0, 1 * MIN));
  const l2 = await link(maya.id, at(T0, 2 * MIN));
  ok(!l1.isNull && l1.code === inv.code && l2.code === inv.code, 'invite_link: returns the same code');
  ok(new Date(l1.expires_at).toISOString() === new Date(inv.expires_at).toISOString(), 'invite_link: returns the same expiry (not extended)');
  ok(/^[A-Za-z0-9_-]{32}$/.test(l1.token) && l1.token !== inv.token && l2.token !== l1.token, 'invite_link: a new 192-bit url-safe token every call');
  const rows = (await as(maya.id, 'select code, revoked_at, accepted_at from pair_invites where revoked_at is null')).rows;
  ok(rows.length === 1 && rows[0].code === inv.code, 'invite_link: the invite is not replaced (code unchanged, nothing revoked)');
  ok(await tokensOf(inv.code) === 3, 'three tokens stored for the invite');
  ok(await count(`select count(*)::int n from private.invite_tokens where encode(token_hash, 'base64') = $1 or position(convert_to($1, 'UTF8') in token_hash) > 0`, [l1.token]) === 0
    && await count(`select count(*)::int n from private.invite_tokens where token_hash = extensions.digest($1::text, 'sha256')`, [l1.token]) === 1, 'only the sha256 of the new token is stored');

  for (const [t, name] of [[inv.token, 'create_invite'], [l1.token, 'first invite_link'], [l2.token, 'second invite_link']]) {
    ok((await preview(sam.id, inv.code, t, at(T0, 3 * MIN))).code === 'OK', `preview with the ${name} token`);
  }
  ok((await preview(sam.id, inv.code, 'x'.repeat(32), at(T0, 3 * MIN))).code === 'INVALID_CODE', 'a wrong token is still INVALID_CODE');
  // D02: a valid token skips the limiter. Use up Tia's 5 failed attempts first.
  for (let i = 0; i < 5; i++) await accept(tia.id, inv.code, `wrong-${i}`.padEnd(32, 'z'), at(T0, 4 * MIN));
  ok((await accept(tia.id, inv.code, null, at(T0, 5 * MIN))).code === 'RATE_LIMITED', 'limiter still applies to a typed code');
  ok((await preview(tia.id, inv.code, l2.token, at(T0, 5 * MIN))).code === 'OK', 'a valid invite_link token skips the limiter');
  ok((await accept(sam.id, inv.code, l1.token, at(T0, 6 * MIN))).code === 'OK', 'the partner joins with an invite_link token');
  ok((await link(maya.id, at(T0, 7 * MIN))).isNull, 'accepted invite → null');
}
{
  const ana = await user('Ana'), bo = await user('Bo');
  const inv = await mkInvite(ana.id, T0);
  await link(ana.id, at(T0, MIN));
  ok((await accept(bo.id, inv.code, inv.token, at(T0, 2 * MIN))).code === 'OK', 'the original create_invite link still joins after invite_link');
}

// ═══ expired / revoked ═══
{
  const cy = await user('Cy');
  await mkInvite(cy.id, T0);
  ok(!(await link(cy.id, at(T0, 48 * HOUR - SEC))).isNull, 'just before expiry → a token');
  ok((await link(cy.id, at(T0, 48 * HOUR))).isNull, 'at expires_at → null (expired)');
  ok((await link(cy.id, at(T0, 49 * HOUR))).isNull, 'after expiry → null');
}
{
  const dee = await user('Dee'), eli = await user('Eli');
  const old = await mkInvite(dee.id, T0);
  const oldLink = await link(dee.id, at(T0, MIN));
  const fresh = await mkInvite(dee.id, at(T0, 2 * MIN));
  ok((await accept(eli.id, old.code, old.token, at(T0, 3 * MIN))).code === 'INVALID_CODE', 'create_invite revokes: the old create_invite token is dead');
  ok((await accept(eli.id, old.code, oldLink.token, at(T0, 3 * MIN))).code === 'INVALID_CODE', 'create_invite revokes: the old invite_link token is dead');
  ok((await preview(eli.id, fresh.code, oldLink.token, at(T0, 3 * MIN))).code === 'INVALID_CODE', 'an old token does not open the new code');
  const l = await link(dee.id, at(T0, 4 * MIN));
  ok(l.code === fresh.code, 'after create_invite, invite_link returns the new code');
  await db.exec(`update pair_invites set revoked_at = '${at(T0, 5 * MIN)}' where code = '${fresh.code}' and inviter_id = '${dee.id}'`);
  ok((await link(dee.id, at(T0, 6 * MIN))).isNull, 'revoked invite → null');
}

// ═══ cap: 10 invite_link tokens per invite ═══
{
  const fay = await user('Fay');
  const inv = await mkInvite(fay.id, T0);
  let allOk = true;
  for (let i = 1; i <= 10; i++) {
    const r = await link(fay.id, at(T0, i * MIN));
    if (r.isNull || r.error || r.code !== inv.code) allOk = false;
  }
  ok(allOk, '10 invite_link calls succeed with the same code');
  ok((await link(fay.id, at(T0, 11 * MIN))).error === 'RATE_LIMITED', '11th invite_link call → RATE_LIMITED');
  ok(await tokensOf(inv.code) === 11, 'no token stored for the rejected call (1 + 10)');
  ok((await preview(fay.id, inv.code, inv.token, at(T0, 12 * MIN))).code === 'OK', 'the code and its links still work after the cap');
  const next = await mkInvite(fay.id, at(T0, 13 * MIN));
  ok(!(await link(fay.id, at(T0, 14 * MIN))).isNull && next.code !== undefined, 'a new invite starts a new cap');
}

// ═══ another user cannot get a token for my invite ═══
{
  const gus = await user('Gus'), hal = await user('Hal'), ivo = await user('Ivo', { solo: false });
  const mine = await mkInvite(gus.id, T0);
  const before = await tokensOf(mine.code);
  ok((await link(hal.id, at(T0, MIN))).isNull, 'another user (no invite of their own) gets null, not my invite');
  ok((await link(ivo.id, at(T0, MIN))).isNull, 'a user without a couple gets null');
  const theirs = await mkInvite(hal.id, at(T0, 2 * MIN));
  const hl = await link(hal.id, at(T0, 3 * MIN));
  ok(hl.code === theirs.code && hl.code !== mine.code, 'another user only ever gets their own code');
  ok(await tokensOf(mine.code) === before, 'my invite gains no token from their calls');
  ok((await accept(ivo.id, mine.code, hl.token, at(T0, 4 * MIN))).code === 'INVALID_CODE', "their token does not open my code");
  // After joining, the joiner (now a member of Gus's couple) is not the inviter → null.
  ok((await accept(ivo.id, mine.code, mine.token, at(T0, 5 * MIN))).code === 'OK', 'my partner joins');
  ok((await link(ivo.id, at(T0, 6 * MIN))).isNull, 'the joiner cannot mint tokens for the used invite');
}

// ═══ public wrapper end to end ═══
{
  const jo = await user('Jo');
  ok((await as(jo.id, 'select invite_link() is null n')).rows[0].n === true, 'invite_link(): SQL null without an open invite');
  const c = (await as(jo.id, 'select (x).code, (x).token from (select create_invite() x) s')).rows[0];
  const r = (await as(jo.id, 'select (x).code, (x).expires_at, (x).token from (select invite_link() x) s')).rows[0];
  ok(r.code === c.code && r.token && r.token !== c.token && r.expires_at, 'invite_link(): {code, expires_at, token} through the API');
}

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
