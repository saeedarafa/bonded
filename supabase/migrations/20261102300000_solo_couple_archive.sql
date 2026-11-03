-- BE-25 / D04: accepting an invite preserves the joiner's solo history as the same
-- read-only 30-day archive used by unpair, rather than cascading it away.
--
-- Preserve BE-04c F5/F8's lock order: actor advisory lock, both couples in id order,
-- then the invite. The only behavioural change below is ending the already-locked solo couple.
create or replace function private.accept_invite_at(p_code text, p_token text, p_now timestamptz)
returns json
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_actor  text := private.invite_actor();
  v_mine   uuid;
  v_cid    uuid;
  v_try    int := 0;
  r        record;
  v_inv    pair_invites;
  v_couple couples;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor, 0));
  perform private.race_point('actor_locked');

  loop
    v_try := v_try + 1;
    v_mine := private.my_couple_id();
    if v_mine is not null and (select count(*) from couple_members where couple_id = v_mine) >= 2 then
      perform private.raise_error('ALREADY_PAIRED');
    end if;
    select * into r from private.resolve_invite(p_code, p_token, p_now);
    if not r.token_ok and private.invite_limited(v_actor, p_now) then
      perform private.raise_error('RATE_LIMITED');
    end if;
    if r.err is not null then return private.invite_fail(v_actor, r.err, p_now); end if;
    select couple_id into v_cid from pair_invites where id = r.invite_id;
    perform private.race_point('before_couple_lock');
    perform 1 from couples where id in (v_mine, v_cid) order by id for update;
    perform private.race_point('couples_locked');
    exit when private.my_couple_id() is not distinct from v_mine;
    if v_try >= 3 then perform private.raise_error('ALREADY_PAIRED'); end if;
  end loop;

  if v_mine is not null and (select count(*) from couple_members where couple_id = v_mine) >= 2 then
    perform private.race_point('refused');
    perform private.raise_error('ALREADY_PAIRED');
  end if;
  select * into v_inv from pair_invites where id = r.invite_id for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    return private.invite_fail(v_actor, 'COUPLE_FULL', p_now, not r.token_ok);
  end if;
  if v_inv.inviter_id = v_uid then perform private.raise_error('OWN_CODE'); end if;

  select * into v_couple from couples where id = v_inv.couple_id;
  if not found or v_couple.status <> 'active'
     or (select count(*) from couple_members where couple_id = v_couple.id) >= 2 then
    return private.invite_fail(v_actor, 'COUPLE_FULL', p_now, not r.token_ok);
  end if;
  if v_inv.expires_at <= p_now then
    return private.invite_fail(v_actor, 'INVITE_EXPIRED', p_now, not r.token_ok);
  end if;

  if v_mine is not null then
    if v_mine = v_couple.id
       or (select count(*) from couple_members where couple_id = v_mine) <> 1
       or not exists (select 1 from couples where id = v_mine and status = 'active') then
      perform private.race_point('refused');
      perform private.raise_error('ALREADY_PAIRED');
    end if;
    update public.couples set status = 'ended', ended_at = p_now where id = v_mine;
    update public.couple_members set left_at = p_now where couple_id = v_mine and left_at is null;
    update public.pair_invites set revoked_at = p_now
      where couple_id = v_mine and accepted_at is null and revoked_at is null;
  end if;
  insert into public.couple_members (couple_id, user_id, joined_at) values (v_couple.id, v_uid, p_now);
  update public.pair_invites set accepted_by = v_uid, accepted_at = p_now where id = v_inv.id;
  return to_json(v_couple.id);
end $$;
