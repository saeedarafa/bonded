// BE-20b: link capabilities can obtain only the inviter's canonical private avatar.
import { createDb } from './pglite-supabase.mjs';

const db = await createDb();
let passed = 0, failed = 0;
const ok = (value, message) => {
  console.log(`${value ? 'PASS' : 'FAIL'} ${message}`);
  if (value) passed++; else { failed++; process.exitCode = 1; }
};
const A = '00000000-0000-0000-0000-000000003001';
const B = '00000000-0000-0000-0000-000000003002';
const C = '00000000-0000-0000-0000-000000003003';
const T = '2026-12-01T08:00:00Z';
const run = async (role, uid, sql, params = []) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const as = (uid, sql, params) => run('authenticated', uid, sql, params);
const denied = async (role, uid, sql, params) => {
  try { await run(role, uid, sql, params); return false; } catch (e) { return /permission denied/.test(e.message); }
};
await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}');
  update profiles set display_name = '  Maya Lastname', avatar_url = 'https://untrusted.invalid/avatar.jpg' where id = '${A}';`);
const couple = (await as(A, `select create_couple('dating', '{}', null) id`)).rows[0].id;
await as(C, `select create_couple('dating', '{}', null)`);
await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [A]);
const invite = (await db.query('select (i).* from (select private.create_invite_at($1::timestamptz) i) s', [T])).rows[0];
const preview = async (code = invite.code, token = invite.token, now = T) =>
  (await db.query('select private.invite_preview_for_link_at($1, $2, $3::timestamptz) j', [code, token, now])).rows[0].j;

ok((await preview()).avatar_path === null, 'missing object returns a null path, ignoring untrusted profile URL');
const path = `${A}/avatar.jpg`;
await as(A, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [path]);
let value = await preview(`bnd · ${invite.code}`);
ok(value.avatar_path === path && value.preview.inviter_name === 'Maya', 'valid link yields only canonical inviter path and first name');
ok(Object.keys(value).sort().join() === 'avatar_path,preview' && Object.keys(value.preview).sort().join() === 'expires_at,inviter_answered_today,inviter_avatar_url,inviter_name', 'service response and nested preview have a minimal field allow-list');
ok(value.preview.inviter_avatar_url === null && value.preview.inviter_answered_today === false, 'SQL never fabricates a public/signed URL or answer text');
ok((await db.query(`select public from storage.buckets where id = 'avatars'`)).rows[0].public === false, 'avatar bucket remains private');
for (const token of [null, '', 'x', 'x'.repeat(32), invite.token.slice(1), 'a'.repeat(33)]) {
  ok(await preview(invite.code, token) === null, `invalid or missing token (${token?.length ?? 'null'} characters) discloses nothing`);
}
for (const code of [null, 'bad', 'a'.repeat(33)]) ok(await preview(code) === null, 'invalid code discloses nothing even with a real token');
ok(await preview(invite.code, invite.token, '2026-12-03T07:59:59Z') !== null, 'live one second before expiry');
ok(await preview(invite.code, invite.token, '2026-12-03T08:00:00Z') === null, 'denied at exact expiry boundary');
ok(await preview(invite.code, invite.token, '2026-12-03T08:00:01Z') === null, 'expired token cannot extend invite lifetime');

for (const [role, uid] of [['anon', null], ['authenticated', A], ['authenticated', C]]) {
  ok(await denied(role, uid, 'select invite_preview_for_link($1, $2)', [invite.code, invite.token]), `${role} cannot directly exchange a token through service RPC`);
  ok(await denied(role, uid, 'select private.invite_preview_for_link_at($1, $2, $3)', [invite.code, invite.token, T]), `${role} cannot call private clock seam`);
}
ok(await denied('service_role', null, 'select private.invite_preview_for_link_at($1, $2, $3)', [invite.code, invite.token, T]), 'service role cannot call private clock seam');
const grants = (await db.query(`select has_function_privilege('service_role', 'public.invite_preview_for_link(text,text)', 'execute') allowed`)).rows[0];
ok(grants.allowed, 'Edge service role has the public exchange grant');
ok((await run('service_role', null, `select invite_preview_for_link($1, $2) j`, [invite.code, null])).rows[0].j === null, 'service wrapper still requires an actual link capability');
ok((await as(C, 'select name from storage.objects')).rows.length === 0, 'outsider retains no direct Storage read access');
const ordinary = (await run('anon', null, 'select invite_preview($1, $2) j', [invite.code, invite.token])).rows[0].j;
ok(ordinary.inviter_avatar_url === null, 'ordinary SQL preview retains the initial fallback');
const before = (await db.query('select count(*)::int n from private.invite_attempts')).rows[0].n;
await preview(invite.code, 'x'.repeat(32)); await preview(); await preview();
ok((await db.query('select count(*)::int n from private.invite_attempts')).rows[0].n === before, 'token-only preview neither creates typed guesses nor resets the failure ledger');
await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [C]);
const other = (await db.query('select (i).* from (select private.create_invite_at($1::timestamptz) i) s', [T])).rows[0];
ok(await preview(invite.code, other.token) === null && await preview(other.code, invite.token) === null, 'a valid capability cannot be transferred to another invite code');

// Alternate BE-28 tokens are equally valid; repeated reads do not consume them.
await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [A]);
const alternate = (await db.query('select (i).* from (select private.invite_link_at($1::timestamptz) i) s', [T])).rows[0];
ok((await preview(invite.code, alternate.token)).avatar_path === path && (await preview()).avatar_path === path, 'old and newly minted links both preview the same inviter');

await db.exec(`update couples set timezone = 'Pacific/Auckland' where id = '${couple}';
  insert into questions (body) values ('FIXTURE-AVATAR-QUESTION');
  insert into couple_questions (couple_id, question_id, source, assigned_for)
    select '${couple}', id, 'daily', '2026-12-02' from questions where body = 'FIXTURE-AVATAR-QUESTION';
  insert into answers (couple_question_id, user_id, body)
    select id, '${A}', 'FIXTURE-AVATAR-PRIVATE-ANSWER' from couple_questions where couple_id = '${couple}';`);
value = await preview(invite.code, invite.token, '2026-12-01T12:00:00Z');
ok(value.preview.inviter_answered_today === true && !JSON.stringify(value).includes('FIXTURE-'), 'answer signal uses couple-local date and never returns question/answer text');
await db.exec(`update couples set status = 'ended', ended_at = '2026-12-01Z' where id = '${couple}'`);
ok(await preview() === null, 'ended couple discloses nothing');
await db.exec(`update couples set status = 'active', ended_at = null where id = '${couple}';
  update couple_members set left_at = '2026-12-01Z' where user_id = '${A}'`);
ok(await preview() === null, 'inviter must still be an active member');
await db.exec(`update couple_members set left_at = null where user_id = '${A}';
  insert into couple_members (couple_id, user_id) values ('${couple}', '${B}')`);
ok(await preview() === null, 'full couple discloses nothing even before invite acceptance flag');
await db.exec(`delete from couple_members where user_id = '${B}';
  update pair_invites set accepted_at = '2026-12-01Z', accepted_by = '${B}' where code = '${invite.code}'`);
ok(await preview() === null, 'used invite discloses nothing');
await db.exec(`update pair_invites set accepted_at = null, accepted_by = null, revoked_at = '2026-12-01Z' where code = '${invite.code}'`);
ok(await preview() === null && await preview(invite.code, alternate.token) === null, 'revocation disables all tokens');

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
