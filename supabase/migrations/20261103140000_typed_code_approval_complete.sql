-- BE-26 / D02: a typed code creates a pending request. The original, hardened
-- immediate pairing flow remains the only completion path for a valid link or approval.

alter table public.join_requests
  drop constraint if exists join_requests_invite_id_requester_id_status_key;

drop function private.accept_invite_at(text, text, timestamptz);
create function private.accept_invite_at(
  p_code text,
  p_token text,
  p_now timestamptz,
  p_approved_invite uuid default null)
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
  v_req    join_requests;
  v_approved boolean := p_approved_invite is not null;
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
    if not r.token_ok and not v_approved and private.invite_limited(v_actor, p_now) then
      perform private.raise_error('RATE_LIMITED');
    end if;
    -- An approval completes exactly the invite the request was made for: if its digits now
    -- resolve to nothing or to another invite (revoked, then reissued), the request is void.
    if v_approved and (r.err is not null or r.invite_id is distinct from p_approved_invite) then
      perform private.raise_error('JOIN_REQUEST_EXPIRED');
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

  if not r.token_ok and not v_approved then
    update join_requests set status = 'expired', decided_at = p_now
      where invite_id = v_inv.id and requester_id = v_uid and status = 'pending' and expires_at <= p_now
      returning * into v_req;
    if found then perform private.invite_record_failure(v_actor, p_now); end if;

    insert into join_requests (invite_id, couple_id, requester_id, expires_at)
      values (v_inv.id, v_inv.couple_id, v_uid, least(v_inv.expires_at, p_now + interval '15 minutes'))
      on conflict (invite_id, requester_id) where status = 'pending'
      do update set expires_at = join_requests.expires_at
      returning * into v_req;
    return json_build_object('status', 'pending', 'request_id', v_req.id, 'expires_at', v_req.expires_at);
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

create or replace function private.approve_join_at(p_request uuid, p_now timestamptz)
returns json
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_request join_requests;
  v_invite pair_invites;
  v_result json;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  select * into v_request from join_requests where id = p_request for update;
  if not found then perform private.raise_error('JOIN_REQUEST_EXPIRED'); end if;
  select * into v_invite from pair_invites where id = v_request.invite_id;
  if v_invite.inviter_id <> auth.uid() then perform private.raise_error('JOIN_REQUEST_FORBIDDEN'); end if;
  if v_request.status <> 'pending' then perform private.raise_error('JOIN_REQUEST_EXPIRED'); end if;
  if v_request.expires_at <= p_now then
    update join_requests set status = 'expired', decided_at = p_now where id = v_request.id;
    perform private.invite_record_failure('u:' || v_request.requester_id::text, p_now);
    return private.invite_fail('u:' || v_request.requester_id::text, 'JOIN_REQUEST_EXPIRED', p_now, false);
  end if;

  -- The invite was revoked (new code, unpair), used or expired since the request: void, not the
  -- requester's fault, so not counted.
  if v_invite.accepted_at is not null or v_invite.revoked_at is not null or v_invite.expires_at <= p_now then
    update join_requests set status = 'expired', decided_at = p_now where id = v_request.id;
    return private.invite_fail('u:' || v_request.requester_id::text, 'JOIN_REQUEST_EXPIRED', p_now, false);
  end if;

  perform set_config('request.jwt.claim.sub', v_request.requester_id::text, true);
  v_result := private.accept_invite_at(v_invite.code, null, p_now, v_invite.id);
  if v_result->>'message' is not null then return v_result; end if;
  update join_requests set status = 'approved', decided_at = p_now where id = v_request.id;
  return v_result;
end $$;

create or replace function private.decline_join_at(p_request uuid, p_now timestamptz)
returns json
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_request join_requests;
  v_invite pair_invites;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  select * into v_request from join_requests where id = p_request for update;
  if not found then perform private.raise_error('JOIN_REQUEST_EXPIRED'); end if;
  select * into v_invite from pair_invites where id = v_request.invite_id;
  if v_invite.inviter_id <> auth.uid() then perform private.raise_error('JOIN_REQUEST_FORBIDDEN'); end if;
  if v_request.status <> 'pending' then perform private.raise_error('JOIN_REQUEST_EXPIRED'); end if;
  if v_request.expires_at <= p_now then
    update join_requests set status = 'expired', decided_at = p_now where id = v_request.id;
    perform private.invite_record_failure('u:' || v_request.requester_id::text, p_now);
    return private.invite_fail('u:' || v_request.requester_id::text, 'JOIN_REQUEST_EXPIRED', p_now, false);
  end if;
  update join_requests set status = 'declined', decided_at = p_now where id = v_request.id;
  perform private.invite_record_failure('u:' || v_request.requester_id::text, p_now);
  return json_build_object('status', 'declined', 'request_id', v_request.id);
end $$;

drop function public.approve_join(uuid);
drop function public.decline_join(uuid);
create function public.approve_join(p_request uuid) returns json
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  return private.approve_join_at(p_request, now());
end $$;
create function public.decline_join(p_request uuid) returns json
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  return private.decline_join_at(p_request, now());
end $$;

revoke all on function private.accept_invite_at(text, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function private.approve_join_at(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.decline_join_at(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.approve_join(uuid), public.decline_join(uuid) from public, anon;
grant execute on function public.approve_join(uuid), public.decline_join(uuid) to authenticated;
