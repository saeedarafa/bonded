-- BE-35 / D37: explicit consent before archiving the requester's solo space.
-- Preserve actor -> sorted couples -> invite locks and all D02 failure accounting.
alter type public.error_code add value if not exists 'CONFIRM_ARCHIVE';

create table private.join_archive_consents (
  request_id uuid primary key references public.join_requests(id) on delete cascade,
  couple_id uuid not null references public.couples(id) on delete cascade
);
create index join_archive_consents_couple_idx on private.join_archive_consents(couple_id);
alter table private.join_archive_consents enable row level security;
revoke all on private.join_archive_consents from public, anon, authenticated, service_role;

-- Remove the old signature so neither PostgREST nor SQL can choose a bypass overload.
drop function public.accept_invite(text, text);
drop function private.accept_invite_at(text, text, timestamptz, uuid);

create function private.accept_invite_at(
  p_code text,
  p_token text,
  p_now timestamptz,
  p_approved_invite uuid default null,
  p_archive_own boolean default false)
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
      return private.invite_fail(v_actor, 'JOIN_REQUEST_EXPIRED', p_now, false);
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
  -- Approval prechecks can go stale while waiting for these locks. A stale approval
  -- is not a guessed-code failure: the requester never chose this race.
  select * into v_inv from pair_invites where id = r.invite_id for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    return private.invite_fail(v_actor,
      (case when v_approved then 'JOIN_REQUEST_EXPIRED' else 'COUPLE_FULL' end)::public.error_code,
      p_now, not r.token_ok and not v_approved);
  end if;
  if v_inv.inviter_id = v_uid then perform private.raise_error('OWN_CODE'); end if;

  select * into v_couple from couples where id = v_inv.couple_id;
  if not found or v_couple.status <> 'active'
     or (select count(*) from couple_members where couple_id = v_couple.id) >= 2 then
    return private.invite_fail(v_actor,
      (case when v_approved then 'JOIN_REQUEST_EXPIRED' else 'COUPLE_FULL' end)::public.error_code,
      p_now, not r.token_ok and not v_approved);
  end if;
  if v_inv.expires_at <= p_now then
    return private.invite_fail(v_actor,
      (case when v_approved then 'JOIN_REQUEST_EXPIRED' else 'INVITE_EXPIRED' end)::public.error_code,
      p_now, not r.token_ok and not v_approved);
  end if;

  -- Check after actor/sorted-couple/invite locks and membership recheck. Approval may
  -- consume only the consent for the exact solo space present when the request was made.
  if v_mine is not null and (
    (not v_approved and p_archive_own is not true)
    or (v_approved and not exists (
      select 1 from public.join_requests j
      join private.join_archive_consents a on a.request_id = j.id
      where j.invite_id = p_approved_invite and j.requester_id = v_uid
        and j.status = 'pending' and a.couple_id = v_mine))) then
    perform private.raise_error('CONFIRM_ARCHIVE');
  end if;

  if not r.token_ok and not v_approved then
    -- A decline sticks for this invite, even if the requester changes their name.
    -- The inviter can issue a new invite; a valid link remains a separate capability.
    if exists (select 1 from join_requests where invite_id = v_inv.id and requester_id = v_uid and status = 'declined') then
      perform private.raise_error('JOIN_REQUEST_FORBIDDEN');
    end if;
    update join_requests set status = 'expired', decided_at = p_now
      where invite_id = v_inv.id and requester_id = v_uid and status = 'pending' and expires_at <= p_now
      returning * into v_req;
    if found then perform private.invite_record_failure(v_actor, p_now); end if;

    -- Keep expiry accounting when a rejection follows it (a raise would roll it back).
    if private.invite_limited(v_actor, p_now) then
      return private.invite_fail(v_actor, 'RATE_LIMITED', p_now, false);
    end if;
    select * into v_req from join_requests
      where invite_id = v_inv.id and requester_id = v_uid and status = 'pending';
    if not found and (select count(*) from join_requests
        where invite_id = v_inv.id and status = 'pending' and expires_at > p_now) >= 3 then
      return private.invite_fail(v_actor, 'RATE_LIMITED', p_now, false);
    end if;
    -- The couple/invite locks above serialize concurrent requesters before counting.
    insert into join_requests (invite_id, couple_id, requester_id, expires_at)
      values (v_inv.id, v_inv.couple_id, v_uid, least(v_inv.expires_at, p_now + interval '15 minutes'))
      on conflict (invite_id, requester_id) where status = 'pending'
      do update set expires_at = join_requests.expires_at
      returning * into v_req;
    if v_mine is not null then
      insert into private.join_archive_consents (request_id, couple_id)
        values (v_req.id, v_mine)
        on conflict (request_id) do update set couple_id = excluded.couple_id;
    else
      delete from private.join_archive_consents where request_id = v_req.id;
    end if;
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

create function public.accept_invite(
  p_code text, p_token text default null, p_archive_own boolean default false)
returns json language plpgsql security definer set search_path = public as $$
begin
  return private.accept_invite_at(p_code, p_token, now(), null, p_archive_own);
end $$;
revoke all on function public.accept_invite(text, text, boolean) from public, anon;
grant execute on function public.accept_invite(text, text, boolean) to authenticated;
revoke all on function private.accept_invite_at(text, text, timestamptz, uuid, boolean)
  from public, anon, authenticated, service_role;
