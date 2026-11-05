// BE-34 / D39: only an expired invite's matching bearer link may disclose a first name.
import assert from 'node:assert/strict';
import { createDb } from './pglite-supabase.mjs';

const db = await createDb();
let passed = 0;
const ok = (value, message) => { assert.ok(value, message); console.log(`PASS ${message}`); passed++; };
const A = '00000000-0000-0000-0000-000000003401';
const B = '00000000-0000-0000-0000-000000003402';
const C = '00000000-0000-0000-0000-000000003403';
const T = '2020-01-01T08:00:00Z';
const EXP = '2020-01-03T08:00:00Z';
const uid = async (id) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id ?? '']);
const as = async (role, id, sql, params = []) => {
  await uid(id);
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const count = async () => (await db.query('select count(*)::int n from private.invite_attempts')).rows[0].n;
try {
  await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
    update profiles set display_name = '  Maya Lastname', avatar_url = 'https://private.invalid/avatar' where id = '${A}';`);
  const couple = (await as('authenticated', A, `select create_couple('dating', '{}', null) id`)).rows[0].id;
  await as('authenticated', C, `select create_couple('dating', '{}', null)`);
  await uid(A);
  const invite = (await db.query('select (i).* from (select private.create_invite_at($1) i) s', [T])).rows[0];
  const alt = (await db.query('select (i).* from (select private.invite_link_at($1) i) s', [T])).rows[0];
  const preview = async (token = invite.token, time = EXP, code = invite.code) => {
    await uid(C);
    return (await db.query(`select private.invite_preview_at($1, $2, $3) j,
      current_setting('response.status', true) status`, [code, token, time])).rows[0];
  };
  const minimal = (value, name = 'Maya') => value.j.message === 'INVITE_EXPIRED' && value.status === '400'
    && value.j.code === 'P0001' && value.j.hint === null
    && Object.keys(value.j).sort().join() === 'code,details,hint,message'
    && JSON.stringify(value.j.details) === JSON.stringify({ inviter_name: name });
  const before = await count();
  ok(minimal(await preview()), 'exact expiry returns 400 INVITE_EXPIRED with first name only');
  ok(minimal(await preview(invite.token, '2020-01-03T08:00:01Z')), 'past expiry retains the minimal token-gated error');
  ok(minimal(await preview(alt.token)), 'BE-28 alternate token gets the same first name');
  ok(minimal(await preview()), 'repeated expired reads are idempotent');
  ok(await count() === before, 'matching expired links do not count or reset guesses');
  const live = await preview(invite.token, '2020-01-03T07:59:59Z');
  ok(live.j.inviter_name === 'Maya' && live.j.inviter_avatar_url === null && live.j.expires_at,
    'one second before expiry retains the ordinary four-field preview');
  const typed = await preview(null);
  ok(typed.j.message === 'INVITE_EXPIRED' && typed.j.details === null && typed.status === '400', 'typed expired code has no name');
  ok(await count() === before + 1, 'typed expiry records one failed attempt');
  const wrong = await preview('x'.repeat(32));
  ok(wrong.j.message === 'INVALID_CODE' && wrong.j.details === null, 'wrong token gets no name');
  ok(await count() === before + 2, 'wrong token still counts');
  for (let i = 0; i < 3; i++) await preview(null);
  await assert.rejects(preview(null), /RATE_LIMITED/); passed++;
  const limitedCount = await count();
  ok(minimal(await preview()), 'matching expired token bypasses a saturated typed limiter');
  ok(await count() === limitedCount, 'capability read leaves the saturated ledger intact');
  for (const [role, id] of [['anon', null], ['authenticated', C], ['authenticated', A]]) {
    const result = (await as(role, id, `select invite_preview($1, $2) j,
      current_setting('response.status', true) status`, [invite.code, invite.token])).rows[0];
    ok(minimal(result), `${role} public wrapper discloses only capability-authorized first name`);
    await assert.rejects(as(role, id, `select private.invite_preview_at($1, $2, $3)`, [invite.code, invite.token, EXP]), /permission denied/); passed++;
  }
  await db.query(`update profiles set display_name = $1 where id = $2`, ['N'.repeat(35) + ' Family', A]);
  ok(minimal(await preview(), 'N'.repeat(30)), 'first name is bounded to 30 characters');
  await db.query(`update profiles set display_name = '' where id = $1`, [A]);
  ok(minimal(await preview(), ''), 'empty first name reveals no additional profile field');
  await db.exec('delete from private.invite_attempts');
  await db.query(`update pair_invites set revoked_at = $1 where code = $2`, [EXP, invite.code]);
  let value = await preview();
  ok(value.j.message === 'INVALID_CODE' && value.j.details === null, 'revoked expired invite never discloses a name');
  await db.query(`update pair_invites set revoked_at = null, accepted_at = $1, accepted_by = $2 where code = $3`, [T, B, invite.code]);
  value = await preview(invite.token, '2020-01-01T09:00:00Z');
  ok(value.j.message === 'COUPLE_FULL' && value.j.details === null, 'accepted invite never discloses a name');
  await db.query(`update pair_invites set accepted_at = null, accepted_by = null where code = $1`, [invite.code]);
  await db.query(`update couples set status = 'ended', ended_at = $1 where id = $2`, [T, couple]);
  value = await preview();
  ok(value.j.message === 'COUPLE_FULL' && value.j.details === null, 'ended couple never discloses an expired name');
  await db.query(`update couples set status = 'active', ended_at = null where id = $1`, [couple]);
  await db.query('insert into couple_members (couple_id,user_id) values ($1,$2)', [couple, B]);
  value = await preview();
  ok(value.j.message === 'COUPLE_FULL' && value.j.details === null, 'full couple never discloses an expired name');
  await uid(A);
  ok((await db.query('select private.invite_preview_for_link_at($1,$2,$3) j', [invite.code, invite.token, EXP])).rows[0].j === null,
    'avatar service seam still rejects expired links');
  console.log(`\n${passed} passed, 0 failed`);
} finally { await db.close(); }
