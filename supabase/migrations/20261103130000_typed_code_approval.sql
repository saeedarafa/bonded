-- BE-26: D02 typed codes create an inviter-approved request; valid link tokens still pair immediately.
alter type public.error_code add value 'JOIN_REQUEST_EXPIRED';
alter type public.error_code add value 'JOIN_REQUEST_FORBIDDEN';

create type public.join_request_status as enum ('pending', 'approved', 'declined', 'expired');
create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.pair_invites(id) on delete cascade,
  couple_id uuid not null references public.couples(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  status public.join_request_status not null default 'pending',
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (invite_id, requester_id, status) deferrable initially immediate
);
create unique index join_requests_one_pending on public.join_requests (invite_id, requester_id) where status = 'pending';
create index join_requests_inviter on public.join_requests (couple_id, status, created_at desc);
alter table public.join_requests enable row level security;
create policy "join request requester or inviter reads" on public.join_requests for select to authenticated
  using (requester_id = auth.uid() or exists (select 1 from public.pair_invites i where i.id = invite_id and i.inviter_id = auth.uid()));
revoke all on public.join_requests from public, anon, authenticated;
grant select on public.join_requests to authenticated;
alter publication supabase_realtime add table public.join_requests;

create or replace function private.complete_invite(p_invite_id uuid, p_joiner uuid, p_now timestamptz) returns uuid
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_inv pair_invites; v_couple couples; v_mine uuid;
begin
  select * into v_inv from pair_invites where id = p_invite_id for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null then perform private.raise_error('COUPLE_FULL'); end if;
  select * into v_couple from couples where id = v_inv.couple_id for update;
  if not found or v_couple.status <> 'active' or (select count(*) from couple_members where couple_id = v_couple.id and left_at is null) >= 2 then perform private.raise_error('COUPLE_FULL'); end if;
  if v_inv.expires_at <= p_now then perform private.raise_error('INVITE_EXPIRED'); end if;
  select couple_id into v_mine from couple_members where user_id = p_joiner and left_at is null;
  if v_mine is not null and (select count(*) from couple_members where couple_id = v_mine and left_at is null) >= 2 then perform private.raise_error('ALREADY_PAIRED'); end if;
  if v_mine is not null then delete from couples where id = v_mine; end if;
  insert into couple_members (couple_id, user_id) values (v_couple.id, p_joiner);
  update pair_invites set accepted_by = p_joiner, accepted_at = p_now where id = v_inv.id;
  return v_couple.id;
end $$;

create or replace function private.accept_invite_at(p_code text, p_token text, p_now timestamptz) returns json
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_actor text := private.invite_actor(); r record; v_inv pair_invites; v_req join_requests;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if exists (select 1 from couple_members m join couples c on c.id=m.couple_id where m.user_id=v_uid and m.left_at is null and c.status='active' and (select count(*) from couple_members x where x.couple_id=m.couple_id and x.left_at is null)>=2) then perform private.raise_error('ALREADY_PAIRED'); end if;
  select * into r from private.resolve_invite(p_code, p_token, p_now);
  if not r.token_ok and private.invite_limited(v_actor, p_now) then perform private.raise_error('RATE_LIMITED'); end if;
  if r.err is not null then return private.invite_fail(v_actor, r.err, p_now); end if;
  select * into v_inv from pair_invites where id=r.invite_id for update;
  if v_inv.inviter_id = v_uid then perform private.raise_error('OWN_CODE'); end if;
  if v_inv.expires_at <= p_now then return private.invite_fail(v_actor, 'INVITE_EXPIRED', p_now, not r.token_ok); end if;
  if r.token_ok then return to_json(private.complete_invite(v_inv.id, v_uid, p_now)); end if;
  update join_requests set status='expired', decided_at=p_now where invite_id=v_inv.id and requester_id=v_uid and status='pending' and expires_at <= p_now;
  insert into join_requests (invite_id,couple_id,requester_id,expires_at) values (v_inv.id,v_inv.couple_id,v_uid,least(v_inv.expires_at,p_now + interval '15 minutes'))
    on conflict (invite_id,requester_id) where status='pending' do update set expires_at=excluded.expires_at returning * into v_req;
  return json_build_object('status','pending','request_id',v_req.id,'expires_at',v_req.expires_at);
end $$;

create or replace function public.approve_join(p_request uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r join_requests; v_inv pair_invites; v_actor text := private.invite_actor();
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  select * into r from join_requests where id=p_request for update; if not found then perform private.raise_error('JOIN_REQUEST_EXPIRED'); end if;
  select * into v_inv from pair_invites where id=r.invite_id; if v_inv.inviter_id <> auth.uid() then perform private.raise_error('JOIN_REQUEST_FORBIDDEN'); end if;
  if r.status <> 'pending' or r.expires_at <= now() then update join_requests set status='expired',decided_at=now() where id=r.id and status='pending'; perform private.invite_record_failure(v_actor,now()); perform private.raise_error('JOIN_REQUEST_EXPIRED'); end if;
  update join_requests set status='approved',decided_at=now() where id=r.id;
  return private.complete_invite(r.invite_id,r.requester_id,now());
end $$;
create or replace function public.decline_join(p_request uuid) returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r join_requests; v_inv pair_invites;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  select * into r from join_requests where id=p_request for update; if not found then perform private.raise_error('JOIN_REQUEST_EXPIRED'); end if;
  select * into v_inv from pair_invites where id=r.invite_id; if v_inv.inviter_id <> auth.uid() then perform private.raise_error('JOIN_REQUEST_FORBIDDEN'); end if;
  if r.status <> 'pending' or r.expires_at <= now() then perform private.raise_error('JOIN_REQUEST_EXPIRED'); end if;
  update join_requests set status='declined',decided_at=now() where id=r.id; perform private.invite_record_failure('u:'||r.requester_id::text,now());
end $$;
revoke all on function private.complete_invite(uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.approve_join(uuid), public.decline_join(uuid) from public, anon;
grant execute on function public.approve_join(uuid), public.decline_join(uuid) to authenticated;
