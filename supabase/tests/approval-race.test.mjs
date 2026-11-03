// BE-30/#57: interleave another completion between approval's precheck and couple lock.
// PGlite runs one connection: this is a deterministic stale-read regression, not a two-session test.
import { createDb } from './pglite-supabase.mjs';
const db = await createDb();
let passed = 0, failed = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'} ${label}`); c ? passed++ : failed++; };
const T = '2026-12-10T10:00:00Z';
const uid = id => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
const core = async (id, fn, args) => {
  await uid(id);
  return (await db.query(`select private.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result;
};
await db.exec(`create table private.approval_race_fixture (
  armed boolean, mode text, inviter uuid, winner uuid, winner_request uuid,
  couple uuid, invite uuid, code text, token text, at timestamptz
);
create or replace function private.race_point(p_name text) returns void language plpgsql as $$
declare s private.approval_race_fixture; v_sub text := current_setting('request.jwt.claim.sub', true);
begin
  update private.approval_race_fixture set armed = false
    where armed and p_name = case when mode = 'early_approval' then 'actor_locked' else 'before_couple_lock' end
    returning * into s;
  if not found then return; end if;
  if s.mode in ('approval', 'early_approval') then
    perform set_config('request.jwt.claim.sub', s.inviter::text, true);
    perform private.approve_join_at(s.winner_request, s.at);
  elsif s.mode = 'token' then
    perform set_config('request.jwt.claim.sub', s.winner::text, true);
    perform private.accept_invite_at(s.code, s.token, s.at);
  elsif s.mode = 'revoked' then
    update public.pair_invites set revoked_at = s.at where id = s.invite;
  elsif s.mode = 'ended' then
    update public.couples set status = 'ended', ended_at = s.at where id = s.couple;
    update public.couple_members set left_at = s.at where couple_id = s.couple;
  elsif s.mode = 'expiry' then
    update public.pair_invites set expires_at = s.at where id = s.invite;
  end if;
  perform set_config('request.jwt.claim.sub', v_sub, true);
end $$;`);

for (const [index, mode] of ['approval', 'early_approval', 'token', 'revoked', 'ended', 'expiry'].entries()) {
  const [inviter, winner, loser, outsider] = [1, 2, 3, 4].map(n =>
    `00000000-0000-0000-0000-000000003${index}${n}0`);
  await db.query('insert into auth.users (id) select unnest($1::uuid[])', [[inviter, winner, loser, outsider]]);
  await uid(inviter);
  const couple = (await db.query(`select create_couple('dating', '{}', null) id`)).rows[0].id;
  const inv = (await db.query('select (i).code, (i).token from (select private.create_invite_at($1) i) s', [T])).rows[0];
  const inviteId = (await db.query('select id from pair_invites where inviter_id = $1 and revoked_at is null', [inviter])).rows[0].id;
  // A losing joiner with a solo space must retain that active space, not lose/archive it.
  await uid(loser);
  const solo = (await db.query(`select create_couple('dating', '{}', null) id`)).rows[0].id;
  const a = await core(winner, 'accept_invite_at', [inv.code, null, T]);
  const b = await core(loser, 'accept_invite_at', [inv.code, null, T]);
  await db.query(`select private.invite_record_failure($1, $2::timestamptz - interval '1 minute') from generate_series(1, 4)`, [`u:${loser}`, T]);
  await db.query('insert into private.approval_race_fixture values (true,$1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [mode, inviter, winner, a.request_id, couple, inviteId, inv.code, inv.token, T]);

  await db.exec('begin');
  const result = await core(inviter, 'approve_join_at', [b.request_id, T]);
  const auth = (await db.query('select auth.uid() id, current_setting(\'response.status\', true) http')).rows[0];
  await db.exec('commit');
  ok(result.message === 'JOIN_REQUEST_EXPIRED' && result.code === 'P0001' && auth.http === '400', `${mode}: loser gets documented JOIN_REQUEST_EXPIRED HTTP 400 body`);
  ok(auth.id === inviter, `${mode}: caller identity restored after approval refusal`);
  const request = (await db.query('select status, decided_at from join_requests where id = $1', [b.request_id])).rows[0];
  ok(request.status === 'expired' && new Date(request.decided_at).toISOString() === T.replace('Z', '.000Z'), `${mode}: loser request is expired with decision time`);
  ok((await db.query('select count(*)::int n from private.invite_attempts where actor = $1', [`u:${loser}`])).rows[0].n === 4, `${mode}: no new failure and previous failures preserved below the five-attempt cap`);
  ok((await db.query('select count(*)::int n from couple_members where couple_id = $1 and user_id = $2', [couple, loser])).rows[0].n === 0, `${mode}: loser never joins the target couple`);
  ok((await db.query(`select status from couples where id = $1`, [solo])).rows[0].status === 'active', `${mode}: losing requester's solo space stays active`);
  if (['approval', 'early_approval', 'token'].includes(mode)) {
    ok((await db.query('select count(*)::int n from couple_members where couple_id = $1 and left_at is null', [couple])).rows[0].n === 2, `${mode}: exactly the inviter and winner are members`);
    ok((await db.query('select count(*)::int n from couple_members where couple_id = $1 and user_id = $2', [couple, winner])).rows[0].n === 1, `${mode}: winning completion is preserved`);
  }
  let retryError;
  try { await core(inviter, 'approve_join_at', [b.request_id, T]); } catch (e) { retryError = e.message; }
  ok(retryError === 'JOIN_REQUEST_EXPIRED', `${mode}: retry stays expired`);
  ok((await db.query('select count(*)::int n from private.invite_attempts where actor = $1', [`u:${loser}`])).rows[0].n === 4, `${mode}: retry does not count again`);
  if (mode === 'approval') {
    const typed = await core(outsider, 'accept_invite_at', [inv.code, null, T]);
    ok(typed.message === 'COUPLE_FULL', 'ordinary typed accept still gets COUPLE_FULL for a used invite');
    ok((await db.query('select count(*)::int n from private.invite_attempts where actor = $1', [`u:${outsider}`])).rows[0].n === 1, 'ordinary typed failure is still counted');
  }
  await db.exec('delete from private.approval_race_fixture');
}

console.log(`\n${passed} passed, ${failed} failed`);
await db.close();
if (failed) process.exitCode = 1;
