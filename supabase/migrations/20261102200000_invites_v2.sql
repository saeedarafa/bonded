-- BE-04: invites v2 (D01, D02, D04, D05, D06; CONTRACTS §2).
--   D01  code = fixed "BND" prefix + 4 digits (only the 4 digits are stored), valid 48 h, unique among
--        unexpired + unused invites, one active invite per inviter (a new one revokes the old one).
--   D02  at most 5 failed attempts per actor per 15 min (RATE_LIMITED); a global failure cap per hour
--        raises an alert row; a link token (>= 192 bits, stored hashed) skips the limit.
--   D04  a caller whose own couple is solo can accept: that solo couple is deleted with its answers.
--   D05  error codes as in CONTRACTS §2.
--   D06  invite_preview(code) is callable by anon and returns the minimum.
--
-- WHY accept_invite / invite_preview RETURN json INSTEAD OF RAISING FOR WRONG CODES
-- A raised exception rolls the whole transaction back, including the row that records the failed
-- attempt, so a limiter that only raises would never count a failure. For failures that must be
-- counted (INVALID_CODE, INVITE_EXPIRED, COUPLE_FULL) the function therefore commits the attempt and
-- returns the error as the response body with HTTP status 400 (PostgREST `response.status`). The body
-- has the shape of a raised error, `{"code":"P0001","message":"INVALID_CODE",...}`, so supabase-js
-- yields `error.message === 'INVALID_CODE'` exactly as for a raise. All other codes are still raised.

-- ───────────────────────────── pair_invites ─────────────────────────────
alter table public.pair_invites drop constraint pair_invites_pkey;
alter table public.pair_invites
  add column id         uuid not null default gen_random_uuid() primary key,
  add column revoked_at timestamptz;
alter table public.pair_invites alter column expires_at set default now() + interval '48 hours';

-- 6-character invites from the previous model can't be redeemed any more.
update public.pair_invites set revoked_at = now() where accepted_at is null and revoked_at is null;
alter table public.pair_invites
  add constraint pair_invites_code_is_4_digits check (code ~ '^[0-9]{4}$') not valid;

-- "Unique among unexpired, unused invites": expiry can't be in an index predicate, so an expired but
-- unrevoked row holds its digits until create_invite revokes it on collision.
create unique index pair_invites_active_code on public.pair_invites (code)
  where accepted_at is null and revoked_at is null;
create unique index pair_invites_one_active_per_inviter on public.pair_invites (inviter_id)
  where accepted_at is null and revoked_at is null;
create index pair_invites_used_by_code on public.pair_invites (code, accepted_at) where accepted_at is not null;

-- Clients only read their own invites (policy from 0001); every write goes through the RPCs.
revoke insert, update, delete on public.pair_invites from anon, authenticated;
revoke all on public.pair_invites from anon;

-- ───────────────────────────── private tables ─────────────────────────────
-- Token hashes, attempt log and alerts live in `private`: unreachable from the API. RLS is on with
-- no policy, as a second wall; SECURITY DEFINER functions run as the table owner.
create table private.invite_tokens (
  invite_id   uuid primary key references public.pair_invites(id) on delete cascade,
  token_hash  bytea not null
);
alter table private.invite_tokens enable row level security;

-- One row per counted failed attempt. `actor` is 'u:<user id>' or 'ip:<sha256 of the client IP>'
-- (no raw IPs stored). Rows older than a day are purged when a new failure is recorded.
create table private.invite_attempts (
  id          bigint generated always as identity primary key,
  actor       text not null,
  created_at  timestamptz not null
);
create index invite_attempts_by_actor on private.invite_attempts (actor, created_at);
create index invite_attempts_by_time on private.invite_attempts (created_at);
alter table private.invite_attempts enable row level security;

-- Raised when the hourly global failure cap is hit. A cron / edge function (BE-08, BE-23) turns
-- unsent rows into an alert. At most one row per kind and hour.
create table private.security_alerts (
  id          bigint generated always as identity primary key,
  kind        text not null,
  bucket      timestamptz not null,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique (kind, bucket)
);
alter table private.security_alerts enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;

-- ───────────────────────────── helpers ─────────────────────────────
-- Limits (D02). Constants in one place.
create or replace function private.invite_limits(out per_actor int, out window_min int, out global_per_hour int)
language sql immutable as $$ select 5, 15, 100 $$;

-- Who is guessing: the signed-in user, or for anon the (hashed) client IP from the gateway header.
create or replace function private.invite_actor() returns text
language plpgsql stable set search_path = public, extensions as $$
declare
  v_headers json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  v_ip text;
begin
  if auth.uid() is not null then return 'u:' || auth.uid()::text; end if;
  v_ip := coalesce(nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
                   nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
                   'unknown');
  return 'ip:' || encode(digest(v_ip, 'sha256'), 'hex');
end $$;

create or replace function private.invite_limited(p_actor text, p_now timestamptz) returns boolean
language sql stable set search_path = public as $$
  select (select count(*) from private.invite_attempts
           where actor = p_actor
             and created_at > p_now - make_interval(mins => (select window_min from private.invite_limits()))
             and created_at <= p_now)
         >= (select per_actor from private.invite_limits())
$$;

create or replace function private.invite_record_failure(p_actor text, p_now timestamptz) returns void
language plpgsql set search_path = public as $$
declare
  v_count int;
  v_hour  timestamptz := date_trunc('hour', p_now);
begin
  insert into private.invite_attempts (actor, created_at) values (p_actor, p_now);
  delete from private.invite_attempts where created_at < p_now - interval '1 day';
  select count(*) into v_count from private.invite_attempts
   where created_at > p_now - interval '1 hour' and created_at <= p_now;
  if v_count >= (select global_per_hour from private.invite_limits()) then
    insert into private.security_alerts (kind, bucket, detail)
      values ('invite_guessing', v_hour, jsonb_build_object('failures_last_hour', v_count))
      on conflict (kind, bucket) do update set detail = excluded.detail;
  end if;
end $$;

-- A counted failure: record it (it must commit, so no raise) and answer 400 with the error body.
create or replace function private.invite_fail(
  p_actor text, p_code public.error_code, p_now timestamptz, p_count boolean default true) returns json
language plpgsql set search_path = public as $$
begin
  if p_count then perform private.invite_record_failure(p_actor, p_now); end if;
  perform set_config('response.status', '400', true);
  return json_build_object('code', 'P0001', 'message', p_code::text, 'details', null, 'hint', null);
end $$;

-- Parse what the user typed ("BND·4827", "bnd 4827", "4827") and find the invite.
--   token_ok: a token was given and matches this invite (it skips the limiter).
--   err: INVALID_CODE (unparseable, unknown, revoked, wrong token) or COUPLE_FULL (already used,
--        within 48 h). Expiry and a full couple are checked by the caller.
create or replace function private.resolve_invite(p_code text, p_token text, p_now timestamptz)
returns table (invite_id uuid, token_ok boolean, err public.error_code)
language plpgsql stable set search_path = public, extensions as $$
declare
  v_digits text := regexp_replace(regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g'), '^BND', '');
  v_inv    pair_invites;
  v_ok     boolean := false;
begin
  if v_digits !~ '^[0-9]{4}$' then
    return query select null::uuid, false, 'INVALID_CODE'::public.error_code; return;
  end if;
  select * into v_inv from pair_invites
   where code = v_digits and accepted_at is null and revoked_at is null;
  if not found then
    perform 1 from pair_invites
     where code = v_digits and accepted_at is not null and accepted_at > p_now - interval '48 hours';
    return query select null::uuid, false,
      (case when found then 'COUPLE_FULL' else 'INVALID_CODE' end)::public.error_code;
    return;
  end if;
  if v_inv.couple_id is null then
    return query select null::uuid, false, 'INVALID_CODE'::public.error_code; return;
  end if;
  if p_token is not null then
    v_ok := exists (select 1 from private.invite_tokens
                     where invite_id = v_inv.id and token_hash = digest(p_token, 'sha256'));
    if not v_ok then
      return query select null::uuid, false, 'INVALID_CODE'::public.error_code; return;
    end if;
  end if;
  return query select v_inv.id, v_ok, null::public.error_code;
end $$;

-- ───────────────────────────── create_invite ─────────────────────────────
create type public.invite_created as (code text, expires_at timestamptz, token text);

-- Code: 4 digits (shown as BND·4827). Token: 24 random bytes, url-safe base64 (192 bits), returned
-- once and stored hashed. A new invite revokes the caller's previous active one (D01).
create or replace function private.create_invite_at(p_now timestamptz) returns public.invite_created
language plpgsql set search_path = public, extensions as $$
declare
  v_couple uuid := private.my_couple_id();
  v_code   text;
  v_token  text := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_id     uuid;
  v_exp    timestamptz := p_now + interval '48 hours';
  v_try    int := 0;
  v_rnd    bytea;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  perform 1 from couples where id = v_couple for update;  -- serialises concurrent calls
  if (select count(*) from couple_members where couple_id = v_couple) >= 2 then
    perform private.raise_error('COUPLE_FULL');
  end if;
  update pair_invites set revoked_at = p_now
   where inviter_id = auth.uid() and accepted_at is null and revoked_at is null;
  loop
    v_try := v_try + 1;
    if v_try > 200 then raise exception 'no free invite code'; end if;
    v_rnd := gen_random_bytes(4);
    v_code := lpad((((get_byte(v_rnd, 0)::bigint << 24) + (get_byte(v_rnd, 1) << 16)
                   + (get_byte(v_rnd, 2) << 8) + get_byte(v_rnd, 3)) % 10000)::text, 4, '0');
    -- An expired invite doesn't hold its digits.
    update pair_invites set revoked_at = p_now
     where code = v_code and accepted_at is null and revoked_at is null and expires_at <= p_now;
    begin
      insert into pair_invites (code, inviter_id, couple_id, partner_name, created_at, expires_at)
        select v_code, auth.uid(), v_couple, partner_name, p_now, v_exp from couples where id = v_couple
        returning id into v_id;
      exit;
    exception when unique_violation then
      -- digits held by a live invite: try others
    end;
  end loop;
  insert into private.invite_tokens (invite_id, token_hash) values (v_id, digest(v_token, 'sha256'));
  return row(v_code, v_exp, v_token)::public.invite_created;
end $$;

drop function public.create_invite();
create function public.create_invite() returns public.invite_created
language plpgsql security definer set search_path = public as $$
begin
  return private.create_invite_at(now());
end $$;

-- ───────────────────────────── accept_invite ─────────────────────────────
-- Order: NOT_AUTHENTICATED, ALREADY_PAIRED (caller's couple full), RATE_LIMITED (not for a valid
-- token), INVALID_CODE, OWN_CODE, COUPLE_FULL, INVITE_EXPIRED. A solo caller joins and their solo
-- couple is deleted (D04). The inviter's couple row is locked so two joiners can't both get in.
create or replace function private.accept_invite_at(p_code text, p_token text, p_now timestamptz)
returns json
language plpgsql set search_path = public, extensions as $$
declare
  v_uid   uuid := auth.uid();
  v_actor text := private.invite_actor();
  v_mine  uuid;
  r       record;
  v_inv   pair_invites;
  v_couple couples;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  v_mine := private.my_couple_id();
  if v_mine is not null and (select count(*) from couple_members where couple_id = v_mine) >= 2 then
    perform private.raise_error('ALREADY_PAIRED');
  end if;

  select * into r from private.resolve_invite(p_code, p_token, p_now);
  if not r.token_ok and private.invite_limited(v_actor, p_now) then
    perform private.raise_error('RATE_LIMITED');
  end if;
  if r.err is not null then return private.invite_fail(v_actor, r.err, p_now); end if;

  select * into v_inv from pair_invites where id = r.invite_id for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    return private.invite_fail(v_actor, 'COUPLE_FULL', p_now, not r.token_ok);  -- lost a race
  end if;
  if v_inv.inviter_id = v_uid then perform private.raise_error('OWN_CODE'); end if;

  select * into v_couple from couples where id = v_inv.couple_id for update;
  if not found or v_couple.status <> 'active'
     or (select count(*) from couple_members where couple_id = v_couple.id) >= 2 then
    return private.invite_fail(v_actor, 'COUPLE_FULL', p_now, not r.token_ok);
  end if;
  if v_inv.expires_at <= p_now then
    return private.invite_fail(v_actor, 'INVITE_EXPIRED', p_now, not r.token_ok);
  end if;

  -- D04: the caller's solo couple goes, with its answers, messages, key dates and open invite.
  if v_mine is not null then delete from couples where id = v_mine; end if;
  insert into couple_members (couple_id, user_id) values (v_couple.id, v_uid);
  update pair_invites set accepted_by = v_uid, accepted_at = p_now where id = v_inv.id;
  return to_json(v_couple.id);
end $$;

drop function public.accept_invite(text);
create function public.accept_invite(p_code text, p_token text default null) returns json
language plpgsql security definer set search_path = public as $$
begin
  return private.accept_invite_at(p_code, p_token, now());
end $$;

-- ───────────────────────────── invite_preview (anon) ─────────────────────────────
-- D06: only the inviter's first name, avatar, whether they answered today (in the couple's
-- timezone) and the expiry. Same limiter and token rule as accept_invite; the actor for anon is the
-- hashed client IP. Errors: INVALID_CODE, INVITE_EXPIRED, COUPLE_FULL (counted), RATE_LIMITED.
create or replace function private.invite_preview_at(p_code text, p_token text, p_now timestamptz)
returns json
language plpgsql set search_path = public, extensions as $$
declare
  v_actor  text := private.invite_actor();
  r        record;
  v_inv    pair_invites;
  v_couple couples;
  v_prof   profiles;
begin
  select * into r from private.resolve_invite(p_code, p_token, p_now);
  if not r.token_ok and private.invite_limited(v_actor, p_now) then
    perform private.raise_error('RATE_LIMITED');
  end if;
  if r.err is not null then return private.invite_fail(v_actor, r.err, p_now); end if;

  select * into v_inv from pair_invites where id = r.invite_id;
  select * into v_couple from couples where id = v_inv.couple_id;
  if not found or v_couple.status <> 'active'
     or (select count(*) from couple_members where couple_id = v_couple.id) >= 2 then
    return private.invite_fail(v_actor, 'COUPLE_FULL', p_now, not r.token_ok);
  end if;
  if v_inv.expires_at <= p_now then
    return private.invite_fail(v_actor, 'INVITE_EXPIRED', p_now, not r.token_ok);
  end if;

  select * into v_prof from profiles where id = v_inv.inviter_id;
  return json_build_object(
    'inviter_name', split_part(btrim(v_prof.display_name), ' ', 1),
    'inviter_avatar_url', v_prof.avatar_url,
    'inviter_answered_today', exists (
      select 1 from couple_questions cq join answers a on a.couple_question_id = cq.id
       where cq.couple_id = v_couple.id and cq.source = 'daily'
         and cq.assigned_for = (p_now at time zone v_couple.timezone)::date
         and a.user_id = v_inv.inviter_id),
    'expires_at', v_inv.expires_at);
end $$;

create function public.invite_preview(p_code text, p_token text default null) returns json
language plpgsql security definer set search_path = public as $$
begin
  return private.invite_preview_at(p_code, p_token, now());
end $$;

-- ───────────────────────────── grants ─────────────────────────────
revoke all on function private.invite_limits() from public, anon, authenticated;
revoke all on function private.invite_actor() from public, anon, authenticated;
revoke all on function private.invite_limited(text, timestamptz) from public, anon, authenticated;
revoke all on function private.invite_record_failure(text, timestamptz) from public, anon, authenticated;
revoke all on function private.invite_fail(text, public.error_code, timestamptz, boolean) from public, anon, authenticated;
revoke all on function private.resolve_invite(text, text, timestamptz) from public, anon, authenticated;
revoke all on function private.create_invite_at(timestamptz) from public, anon, authenticated;
revoke all on function private.accept_invite_at(text, text, timestamptz) from public, anon, authenticated;
revoke all on function private.invite_preview_at(text, text, timestamptz) from public, anon, authenticated;

revoke all on function public.create_invite() from public, anon;
revoke all on function public.accept_invite(text, text) from public, anon;
revoke all on function public.invite_preview(text, text) from public;
grant execute on function public.create_invite() to authenticated;
grant execute on function public.accept_invite(text, text) to authenticated;
grant execute on function public.invite_preview(text, text) to anon, authenticated;
