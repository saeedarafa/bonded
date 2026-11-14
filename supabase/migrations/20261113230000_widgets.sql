-- BE-60 (D59; SEC-21 option A; CONTRACTS §2/§3): Premium widgets — widget send + widget sign-in.
--
--   * `little_things.source` ('app' | 'widget'). The app path (`public.send_little_thing`) always
--     writes 'app'; it has no parameter for the source. Only the service-only widget path writes
--     'widget', and it refuses a free couple with PREMIUM_REQUIRED before any insert.
--   * The send/undo cores take the user id explicitly (`private.send_little_thing_core`,
--     `private.undo_little_thing_core`); auth.uid() is never faked. All the existing rules are shared:
--     the couple lock, limits, D24 (the push claim), undo (5 s, sender-only, 10 a day), UNDO_EXPIRED
--     once dispatched, and `(sender_id, client_id)` replay.
--   * Widget tokens (`bwt_` + 32 random bytes, base64url) are opaque, minted by
--     `public.mint_widget_token(p_device_id)` for a signed-in, paired user (no Premium check), and
--     returned once. Only sha256(token) (hex) is stored in `private.widget_tokens`. Absolute
--     lifetime 48 h (use never extends it). One live token per (user, device): minting rotates.
--     At most 5 live tokens per user (the oldest are revoked) and 20 mints per rolling 24 h
--     (RATE_LIMITED). `public.revoke_widget_tokens(p_device_id)` revokes (null = all the caller's).
--   * The `widget` edge function (verify_jwt = false) hashes the bearer token and calls one
--     service-only RPC per action: `widget_send`, `widget_undo`, `widget_state`. Each checks the
--     token itself (`private.widget_auth`): exists, not revoked, not expired, scope, Auth user,
--     the minting `session_id` still in auth.sessions, and the token's couple still the user's
--     active, paired couple. Every failure is the same WIDGET_AUTH. Premium is read on every call.
--   * Per-token rate limits: 30 sends/undos per 10 min, 120 reads per hour (RATE_LIMITED).
--   * `widget_state` returns allow-listed keys only, built field by field: never answer, thread,
--     voice, path or URL fields. A free or lapsed couple gets `{premium:false, server_now}`.
--   * Unpair/end revokes the couple's tokens (trigger on couple_members.left_at), account deletion
--     cascades, and a daily cron purges rows 7 days past expiry or revocation.

alter type public.error_code add value if not exists 'WIDGET_AUTH';

-- ───────────────────────────── 1. Source on little things ─────────────────────────────

alter table public.little_things add column source text not null default 'app'
  constraint little_things_source check (source in ('app', 'widget'));

-- ───────────────────────────── 2. Send/undo cores with an explicit user ─────────────────────────────

-- The user's active couple with two current members, or NOT_PAIRED (little_things_couple for a uid).
create or replace function private.widget_couple_of(p_uid uuid) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_couple uuid;
begin
  select m.couple_id into v_couple
    from public.couple_members m join public.couples c on c.id = m.couple_id
   where m.user_id = p_uid and m.left_at is null and c.status = 'active'
   limit 1;
  if v_couple is null
     or (select count(*) from public.couple_members m where m.couple_id = v_couple and m.left_at is null) < 2 then
    perform private.raise_error('NOT_PAIRED');
  end if;
  return v_couple;
end $$;
revoke all on function private.widget_couple_of(uuid) from public, anon, authenticated, service_role;

create or replace function private.send_little_thing_core(
  p_uid uuid, p_kind text, p_amount integer, p_client_id uuid, p_source text, p_now timestamptz)
returns public.little_thing_sent
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple  uuid;
  v_amount  integer := coalesce(p_amount, 1);
  v_day     date;
  v_premium boolean;
  v_limit   integer;
  v_used    integer;
  v_row     public.little_things;
  v_same    boolean := false;
begin
  if p_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if p_source is null or p_source not in ('app', 'widget') then
    perform private.raise_error('INVALID_LITTLE_THING');
  end if;
  v_couple := private.widget_couple_of(p_uid);
  if p_kind is null or p_kind not in ('hug', 'kiss', 'goodnight', 'good_morning', 'miss_you')
     or (p_kind = 'kiss' and v_amount not between 1 and 5)
     or (p_kind = 'hug' and v_amount not between 1 and 5000)
     or (p_kind not in ('kiss', 'hug') and v_amount <> 1) then
    perform private.raise_error('INVALID_LITTLE_THING');
  end if;

  perform pg_advisory_xact_lock(hashtext('little_things:' || v_couple::text));

  v_premium := private.is_couple_premium(v_couple);
  -- D59: a widget send is Premium-only. Refused before any insert, so no free quota is used.
  if p_source = 'widget' and not v_premium then perform private.raise_error('PREMIUM_REQUIRED'); end if;

  if p_client_id is not null then
    select * into v_row from public.little_things where sender_id = p_uid and client_id = p_client_id;
    if found then
      v_day := v_row.local_date;
      v_premium := private.is_couple_premium(v_row.couple_id);
      return (v_row.id, v_row.same_time,
              private.little_thing_used(p_uid, v_row.kind, v_day) >= private.little_thing_limit(v_row.kind, v_premium));
    end if;
  end if;

  v_day := private.little_thing_day(p_uid, p_now);
  v_limit := private.little_thing_limit(p_kind, v_premium);
  v_used := private.little_thing_used(p_uid, p_kind, v_day);
  if v_used + (case when p_kind = 'kiss' then v_amount else 1 end) > v_limit then
    raise exception using message = 'LITTLE_THING_LIMIT', errcode = 'P0001',
      detail = format('{"kind":"%s","more_with_premium":%s}', p_kind,
                      (not v_premium and p_kind in ('kiss', 'hug', 'miss_you'))::text);
  end if;

  if p_kind = 'hug' then
    v_same := exists (
      select 1 from public.little_things l
       where l.couple_id = v_couple and l.sender_id <> p_uid and l.kind = 'hug' and l.undone_at is null
         and l.created_at between p_now - interval '10 seconds' and p_now);
  end if;

  insert into public.little_things (couple_id, sender_id, kind, amount, local_date, same_time, client_id, created_at, source)
    values (v_couple, p_uid, p_kind, v_amount, v_day, v_same, p_client_id, p_now, p_source)
    returning * into v_row;
  return (v_row.id, v_row.same_time,
          v_used + (case when p_kind = 'kiss' then v_amount else 1 end) >= v_limit);
end $$;
revoke all on function private.send_little_thing_core(uuid, text, integer, uuid, text, timestamptz) from public, anon, authenticated, service_role;

-- The app path: the caller from auth.uid(), always source 'app' (signature and grants unchanged).
create or replace function private.send_little_thing_at(p_kind text, p_amount integer, p_client_id uuid, p_now timestamptz)
returns public.little_thing_sent
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.send_little_thing_core(auth.uid(), p_kind, p_amount, p_client_id, 'app', p_now)
$$;
revoke all on function private.send_little_thing_at(text, integer, uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function private.undo_little_thing_core(p_uid uuid, p_id uuid, p_now timestamptz)
returns setof public.little_thing_state
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_row public.little_things;
begin
  if p_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  select * into v_row from public.little_things where id = p_id and sender_id = p_uid;
  if not found then perform private.raise_error('INVALID_LITTLE_THING'); end if;
  if v_row.undone_at is not null then
    return query select * from private.little_things_state(p_uid, v_row.couple_id, p_now);
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('little_things:' || v_row.couple_id::text));
  select * into v_row from public.little_things where id = p_id and sender_id = p_uid for update;
  if not found then perform private.raise_error('INVALID_LITTLE_THING'); end if;
  if v_row.undone_at is null then
    if p_now > v_row.created_at + interval '5 seconds'
       or exists (select 1 from private.little_thing_dispatch d where d.little_thing_id = v_row.id)
       or (select count(*) from public.little_things l
            where l.sender_id = p_uid and l.local_date = v_row.local_date and l.undone_at is not null) >= 10 then
      perform private.raise_error('UNDO_EXPIRED');
    end if;
    update public.little_things set undone_at = p_now where id = v_row.id;
  end if;
  return query select * from private.little_things_state(p_uid, v_row.couple_id, p_now);
end $$;
revoke all on function private.undo_little_thing_core(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function private.undo_little_thing_at(p_id uuid, p_now timestamptz)
returns setof public.little_thing_state
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select * from private.undo_little_thing_core(auth.uid(), p_id, p_now)
$$;
revoke all on function private.undo_little_thing_at(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ───────────────────────────── 3. Widget tokens ─────────────────────────────

create table private.widget_tokens (
  token_hash   text primary key check (token_hash ~ '^[0-9a-f]{64}$'),  -- sha256(token), hex; never the token
  user_id      uuid not null references auth.users(id) on delete cascade,
  couple_id    uuid not null references public.couples(id) on delete cascade,
  session_id   uuid not null,
  device_id    uuid not null,
  scopes       text[] not null default array['send_little_thing', 'undo_little_thing', 'widget_read'],
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  constraint widget_tokens_lifetime check (expires_at > created_at and expires_at <= created_at + interval '48 hours')
);
create index widget_tokens_user on private.widget_tokens (user_id, created_at desc);
create index widget_tokens_couple on private.widget_tokens (couple_id) where revoked_at is null;
alter table private.widget_tokens enable row level security;
revoke all on private.widget_tokens from public, anon, authenticated, service_role;

-- Per-token fixed-window counters ('write' = sends and undos, 'read' = state).
create table private.widget_token_usage (
  token_hash   text not null references private.widget_tokens(token_hash) on delete cascade,
  bucket       text not null check (bucket in ('write', 'read')),
  window_start timestamptz not null,
  n            integer not null default 0,
  primary key (token_hash, bucket)
);
alter table private.widget_token_usage enable row level security;
revoke all on private.widget_token_usage from public, anon, authenticated, service_role;

-- ───────────────────────────── 4. Mint and revoke (user JWT) ─────────────────────────────

create or replace function private.jwt_session_id() returns uuid
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare v text;
begin
  v := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id';
  if v is null or v !~ '^[0-9a-fA-F-]{36}$' then return null; end if;
  return v::uuid;
exception when others then return null;
end $$;
revoke all on function private.jwt_session_id() from public, anon, authenticated, service_role;

create or replace function private.mint_widget_token_at(p_device_id uuid, p_now timestamptz)
returns json
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_session uuid := private.jwt_session_id();
  v_device  uuid := coalesce(p_device_id, '00000000-0000-0000-0000-000000000000');
  v_couple  uuid;
  v_token   text;
  v_expires timestamptz := p_now + interval '48 hours';
begin
  if v_uid is null or v_session is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  v_couple := private.widget_couple_of(v_uid);
  perform pg_advisory_xact_lock(hashtext('widget_tokens:' || v_uid::text));
  if (select count(*) from private.widget_tokens t
       where t.user_id = v_uid and t.created_at > p_now - interval '24 hours') >= 20 then
    perform private.raise_error('RATE_LIMITED');
  end if;
  -- Rotate: one live token per (user, device).
  update private.widget_tokens set revoked_at = p_now
   where user_id = v_uid and device_id = v_device and revoked_at is null;
  v_token := 'bwt_' || rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into private.widget_tokens (token_hash, user_id, couple_id, session_id, device_id, created_at, expires_at)
    values (encode(digest(v_token, 'sha256'), 'hex'), v_uid, v_couple, v_session, v_device, p_now, v_expires);
  -- At most 5 live tokens per user: revoke the oldest beyond that.
  update private.widget_tokens set revoked_at = p_now
   where token_hash in (
     select t.token_hash from private.widget_tokens t
      where t.user_id = v_uid and t.revoked_at is null and t.expires_at > p_now
      order by t.created_at desc, t.token_hash offset 5);
  return json_build_object('token', v_token, 'expires_at', v_expires);
end $$;
revoke all on function private.mint_widget_token_at(uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.mint_widget_token(p_device_id uuid)
returns json
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.mint_widget_token_at(p_device_id, now())
$$;
revoke all on function public.mint_widget_token(uuid) from public, anon;
grant execute on function public.mint_widget_token(uuid) to authenticated;

create or replace function public.revoke_widget_tokens(p_device_id uuid default null)
returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  update private.widget_tokens set revoked_at = now()
   where user_id = v_uid and revoked_at is null
     and (p_device_id is null or device_id = p_device_id);
end $$;
revoke all on function public.revoke_widget_tokens(uuid) from public, anon;
grant execute on function public.revoke_widget_tokens(uuid) to authenticated;

-- ───────────────────────────── 5. The token check (inside every widget RPC) ─────────────────────────────

-- Returns the user and couple, or raises WIDGET_AUTH (the same code for every failure: no oracle).
-- Counts the call against the token's rate window (RATE_LIMITED past it).
create or replace function private.widget_auth(p_token_hash text, p_scope text, p_now timestamptz,
  out user_id uuid, out couple_id uuid)
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  t        private.widget_tokens;
  v_bucket text := case when p_scope = 'widget_read' then 'read' else 'write' end;
  v_window interval := case when p_scope = 'widget_read' then interval '1 hour' else interval '10 minutes' end;
  v_max    integer := case when p_scope = 'widget_read' then 120 else 30 end;
  v_n      integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then perform private.raise_error('WIDGET_AUTH'); end if;
  select * into t from private.widget_tokens w where w.token_hash = p_token_hash for update;
  if not found
     or t.revoked_at is not null
     or t.expires_at <= p_now
     or not (p_scope = any (t.scopes))
     or not exists (select 1 from auth.users u where u.id = t.user_id)
     or not exists (select 1 from auth.sessions s where s.id = t.session_id and s.user_id = t.user_id)
     or not exists (
       select 1 from public.couple_members m join public.couples c on c.id = m.couple_id
        where m.couple_id = t.couple_id and m.user_id = t.user_id and m.left_at is null and c.status = 'active')
     or (select count(*) from public.couple_members m where m.couple_id = t.couple_id and m.left_at is null) < 2 then
    perform private.raise_error('WIDGET_AUTH');
  end if;

  insert into private.widget_token_usage as u (token_hash, bucket, window_start, n)
    values (t.token_hash, v_bucket, p_now, 1)
  on conflict (token_hash, bucket) do update
    set window_start = case when u.window_start + v_window <= p_now then p_now else u.window_start end,
        n = case when u.window_start + v_window <= p_now then 1 else u.n + 1 end
  returning u.n into v_n;
  if v_n > v_max then perform private.raise_error('RATE_LIMITED'); end if;

  update private.widget_tokens w set last_used_at = p_now where w.token_hash = t.token_hash;
  user_id := t.user_id;
  couple_id := t.couple_id;
end $$;
revoke all on function private.widget_auth(text, text, timestamptz) from public, anon, authenticated, service_role;

-- ───────────────────────────── 6. Widget write path (service only) ─────────────────────────────

create or replace function private.widget_send_at(p_token_hash text, p_kind text, p_client_id uuid, p_now timestamptz)
returns json
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid uuid;
  r     public.little_thing_sent;
begin
  select w.user_id into v_uid from private.widget_auth(p_token_hash, 'send_little_thing', p_now) w;
  -- Each tap carries a fresh client id: the unique (sender_id, client_id) makes a replay return
  -- the first result.
  if p_client_id is null then perform private.raise_error('INVALID_LITTLE_THING'); end if;
  r := private.send_little_thing_core(v_uid, p_kind, 1, p_client_id, 'widget', p_now);
  return json_build_object('id', r.id, 'same_time', r.same_time, 'at_limit', r.at_limit);
end $$;
revoke all on function private.widget_send_at(text, text, uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.widget_send(p_token_hash text, p_kind text, p_client_id uuid)
returns json
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.widget_send_at(p_token_hash, p_kind, p_client_id, now())
$$;
revoke all on function public.widget_send(text, text, uuid) from public, anon, authenticated;
grant execute on function public.widget_send(text, text, uuid) to service_role;

create or replace function private.widget_undo_at(p_token_hash text, p_id uuid, p_now timestamptz)
returns json
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_uid uuid;
begin
  select w.user_id into v_uid from private.widget_auth(p_token_hash, 'undo_little_thing', p_now) w;
  return coalesce((select json_agg(json_build_object('kind', s.kind, 'at_limit', s.at_limit))
                     from private.undo_little_thing_core(v_uid, p_id, p_now) s), '[]'::json);
end $$;
revoke all on function private.widget_undo_at(text, uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.widget_undo(p_token_hash text, p_id uuid)
returns json
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.widget_undo_at(p_token_hash, p_id, now())
$$;
revoke all on function public.widget_undo(text, uuid) from public, anon, authenticated;
grant execute on function public.widget_undo(text, uuid) to service_role;

-- ───────────────────────────── 7. Widget read path (service only) ─────────────────────────────

-- The next yearly occurrence of a date on or after p_today (29 Feb → 28 Feb in other years).
create or replace function private.next_yearly(p_date date, p_today date) returns date
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case when o >= p_today then o
              else (p_date + make_interval(years => extract(year from p_today)::int + 1 - extract(year from p_date)::int))::date end
    from (select (p_date + make_interval(years => greatest(0, extract(year from p_today)::int - extract(year from p_date)::int)))::date o) x
$$;
revoke all on function private.next_yearly(date, date) from public, anon, authenticated, service_role;

-- Allow-listed widget data. Every key is chosen here, field by field: no answer, thread-message or
-- voice field, no path or URL, no key-date title (key dates have none). Never `select *` /
-- row_to_json of a content table.
create or replace function private.widget_state_at(p_token_hash text, p_now timestamptz)
returns json
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  a          record;
  v_couple   public.couples;
  v_tz       text;
  v_local    date;
  v_today    date;
  v_partner  uuid;
  v_since    date;
  v_streak   public.couple_streaks;
  v_cur      integer := 0;
  v_cq       uuid;
  v_qtext    text;
  v_me       boolean := false;
  v_them     boolean := false;
  v_mascot   text;
  v_otd      json;
  v_offset   record;
  v_expires  timestamptz;
begin
  select w.user_id, w.couple_id into a from private.widget_auth(p_token_hash, 'widget_read', p_now) w;
  if not private.is_couple_premium(a.couple_id) then
    return json_build_object('premium', false, 'server_now', p_now);
  end if;

  select * into v_couple from public.couples c where c.id = a.couple_id;
  v_tz := case when private.is_valid_timezone(v_couple.timezone) then v_couple.timezone else 'UTC' end;
  v_local := (p_now at time zone v_tz)::date;
  v_today := private.couple_today_at(v_couple.id, v_tz, p_now);
  select m.user_id into v_partner from public.couple_members m
   where m.couple_id = v_couple.id and m.left_at is null and m.user_id <> a.user_id limit 1;
  select t.expires_at into v_expires from private.widget_tokens t where t.token_hash = p_token_hash;

  v_since := coalesce((select k.date from public.key_dates k where k.couple_id = v_couple.id and k.kind = 'together_since'),
                      v_couple.relationship_start_date);

  select * into v_streak from public.couple_streaks s where s.couple_id = v_couple.id;
  if found and v_streak.last_completed_on >= v_today - 1 then v_cur := v_streak.current; end if;

  select q.id, qq.body into v_cq, v_qtext
    from public.couple_questions q join public.questions qq on qq.id = q.question_id
   where q.couple_id = v_couple.id and q.source = 'daily' and q.assigned_for = v_today
   limit 1;
  if v_cq is not null then
    v_me := exists (select 1 from public.answers x where x.couple_question_id = v_cq and x.user_id = a.user_id);
    v_them := exists (select 1 from public.answers x where x.couple_question_id = v_cq and x.user_id = v_partner);
  end if;
  v_mascot := case
    when v_me and v_them then 'together'
    when not v_me and not v_them and v_streak.current > 0 and v_streak.last_completed_on < v_today - 1 then 'napping'
    else 'waiting' end;

  for v_offset in select * from (values ('1y', interval '1 year', 1), ('6m', interval '6 months', 2), ('1m', interval '1 month', 3)) o(ago, span, n) order by n loop
    select json_build_object('couple_question_id', q.id, 'question_text', qq.body, 'date', q.assigned_for, 'ago', v_offset.ago)
      into v_otd
      from public.couple_questions q join public.questions qq on qq.id = q.question_id
     where q.couple_id = v_couple.id and q.source = 'daily'
       and q.assigned_for = (v_today - v_offset.span)::date
       and q.assigned_for >= coalesce(v_couple.history_floor, '-infinity'::date)
       and (select count(distinct x.user_id) from public.answers x
             where x.couple_question_id = q.id
               and x.user_id in (select m.user_id from public.couple_members m
                                  where m.couple_id = v_couple.id and m.left_at is null)) >= 2
     limit 1;
    exit when v_otd is not null;
  end loop;

  return json_build_object(
    'premium', true,
    'server_now', p_now,
    'token_expires_at', v_expires,
    'partner_first_name', (select left(private.first_name(p.display_name), 20) from public.profiles p where p.id = v_partner),
    'days_together', case when v_since is not null and v_since <= v_local then v_local - v_since end,
    'days_in_bonded', v_local - (coalesce(v_couple.paired_at, v_couple.created_at) at time zone v_tz)::date,
    'next_key_dates', coalesce((
      select json_agg(json_build_object('kind', n.kind, 'date', n.next_on, 'days_until', n.next_on - v_local,
                                        'years', extract(year from n.next_on)::int - extract(year from n.date)::int,
                                        'whose', n.whose) order by n.next_on, n.kind)
        from (select k.kind, k.date, private.next_yearly(k.date, v_local) next_on,
                     case when k.user_id is null then null when k.user_id = a.user_id then 'me' else 'partner' end whose
                from public.key_dates k
               where k.couple_id = v_couple.id
                 and (k.user_id is null or k.user_id in (a.user_id, v_partner))
               order by 3, 1 limit 2) n), '[]'::json),
    'streak', json_build_object(
      'current', v_cur,
      'next_badge', (select json_build_object('slug', b.slug, 'threshold', b.threshold) from public.badges b
                      where b.kind = 'streak' and b.threshold > v_cur order by b.threshold limit 1),
      'saver_available', private.saver_premium(v_couple.id, p_now) and private.saver_base(v_couple.id, v_today) > 0
        and not exists (select 1 from private.streak_savers s where s.couple_id = v_couple.id
                         and s.used_month = date_trunc('month', v_today)::date)),
    'today', case when v_cq is null then null else json_build_object(
      'couple_question_id', v_cq, 'question_text', v_qtext, 'me_answered', v_me, 'partner_answered', v_them) end,
    'mascot', v_mascot,
    'last_from_partner', (
      select json_build_object('kind', l.kind, 'count', case when l.kind = 'kiss' then l.amount else 1 end, 'sent_at', l.created_at)
        from public.little_things l
       where l.couple_id = v_couple.id and l.sender_id = v_partner and l.undone_at is null
         and l.created_at > p_now - interval '7 days' and l.created_at <= p_now
       order by l.created_at desc limit 1),
    'on_this_day', v_otd,
    'ritual_time', (select to_char(coalesce(np.ritual_time, '21:00'::time), 'HH24:MI')
                      from (select 1) one left join public.notification_prefs np on np.user_id = a.user_id),
    'little_things', (select json_agg(json_build_object('kind', s.kind, 'at_limit', s.at_limit))
                        from private.little_things_state(a.user_id, v_couple.id, p_now) s)
  );
end $$;
revoke all on function private.widget_state_at(text, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.widget_state(p_token_hash text)
returns json
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.widget_state_at(p_token_hash, now())
$$;
revoke all on function public.widget_state(text) from public, anon, authenticated;
grant execute on function public.widget_state(text) to service_role;

-- ───────────────────────────── 8. Revocation and purge ─────────────────────────────

-- Unpair / end (defence in depth: widget_auth already refuses a left membership).
create or replace function private.revoke_widget_tokens_on_leave() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  update private.widget_tokens set revoked_at = now()
   where couple_id = new.couple_id and user_id = new.user_id and revoked_at is null;
  return null;
end $$;
revoke all on function private.revoke_widget_tokens_on_leave() from public, anon, authenticated, service_role;

create trigger couple_members_revoke_widget_tokens
  after update of left_at on public.couple_members
  for each row when (old.left_at is null and new.left_at is not null)
  execute function private.revoke_widget_tokens_on_leave();

create or replace function private.purge_widget_tokens(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_n integer;
begin
  delete from private.widget_tokens
   where expires_at < p_now - interval '7 days' or revoked_at < p_now - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.purge_widget_tokens(timestamptz) from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema extensions;
    if not exists (select 1 from cron.job where jobname = 'purge-widget-tokens') then
      perform cron.schedule('purge-widget-tokens', '41 4 * * *', 'select private.purge_widget_tokens()');
    end if;
  end if;
end $$;
