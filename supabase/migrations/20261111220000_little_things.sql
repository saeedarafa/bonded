-- BE-44 (D48; CONTRACTS §2): little things (data + limits). Push is BE-45.
--
--   * `public.little_things`: one row per send (a kiss batch of 3 is one row with amount 3).
--     Kinds: hug | kiss | goodnight | good_morning | miss_you. `amount`: kisses 1–5 per send,
--     a hug's hold in ms (1–5000), the others always 1. `local_date` is the SENDER's local day
--     (profile timezone, D48 default). `undone_at` is set by undo (the row stays so realtime tells
--     the partner and BE-45 can skip the push). `same_time` is decided by the server.
--   * Limits in the database, per sender per sender-local day, whatever the couple (re-pairing
--     does not reset them): free 10 kisses (counted per kiss), 5 hugs (any length counts 1),
--     3 miss-yous; Premium (couple-level, either current member) 50 / 30 / 15; everyone
--     1 goodnight and 1 good morning. Undone sends do not count. Over the limit raises
--     LITTLE_THING_LIMIT with DETAIL '{"kind":"kiss","more_with_premium":true}'. A batch that does
--     not fit is refused whole (no partial send).
--   * `send_little_thing(p_kind, p_amount, p_client_id)` → `{id, same_time, at_limit}`; a retry
--     with the same client id returns the first result and counts once.
--     `same_time`: a hug sent within 10 s after a (not undone) hug of the partner.
--   * `undo_little_thing(p_id)`: the sender only, within 5 s of the send; gives the count back.
--     Returns the `little_things_today()` state. Idempotent (an undone row stays undone).
--   * `little_things_today()`: per kind, whether the caller is at the limit and whether Premium
--     would give more. No counts (no visible countdown, D48).
--   * Clients read their couple's rows (active couple, or the 30-day ended archive) and write
--     nothing directly. In `supabase_realtime` (INSERT for the gesture, UPDATE for an undo).
--   * Deleted with the couple (D08 purge) and with the sender's account (D09).
--   * Also (SEC-09c Info 3, #193): `public.voice_sweep` loses its `p_now` parameter, so the sweep
--     always runs on the database clock. Only the tests passed it.

alter type public.error_code add value if not exists 'LITTLE_THING_LIMIT';
alter type public.error_code add value if not exists 'INVALID_LITTLE_THING';
alter type public.error_code add value if not exists 'UNDO_EXPIRED';

-- ───────────────────────────── Table ─────────────────────────────

create table public.little_things (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('hug', 'kiss', 'goodnight', 'good_morning', 'miss_you')),
  amount     integer not null default 1,
  local_date date not null,
  same_time  boolean not null default false,
  client_id  uuid,
  created_at timestamptz not null default now(),
  undone_at  timestamptz,
  constraint little_things_amount check (
    case kind
      when 'kiss' then amount between 1 and 5
      when 'hug'  then amount between 1 and 5000
      else amount = 1
    end),
  constraint little_things_same_time_hug check (not same_time or kind = 'hug')
);
create unique index little_things_sender_client on public.little_things (sender_id, client_id) where client_id is not null;
create index little_things_sender_day on public.little_things (sender_id, local_date);
create index little_things_couple_created on public.little_things (couple_id, created_at desc);

alter table public.little_things enable row level security;
revoke all on public.little_things from public, anon, authenticated;
grant select on public.little_things to authenticated;

create policy "read own couple little things" on public.little_things for select to authenticated
  using (private.can_read_couple(couple_id));

alter publication supabase_realtime add table public.little_things;

-- ───────────────────────────── Return shapes ─────────────────────────────

create type public.little_thing_sent as (id uuid, same_time boolean, at_limit boolean);
create type public.little_thing_state as (kind text, at_limit boolean, more_with_premium boolean);

-- ───────────────────────────── Helpers ─────────────────────────────

-- Daily limit per kind and tier (D48).
create or replace function private.little_thing_limit(p_kind text, p_premium boolean) returns integer
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case p_kind
    when 'kiss'         then case when p_premium then 50 else 10 end
    when 'hug'          then case when p_premium then 30 else 5 end
    when 'miss_you'     then case when p_premium then 15 else 3 end
    when 'goodnight'    then 1
    when 'good_morning' then 1
  end
$$;
revoke all on function private.little_thing_limit(text, boolean) from public, anon, authenticated, service_role;

-- The sender's local day (profile timezone; an invalid legacy value falls back to UTC).
create or replace function private.little_thing_day(p_user uuid, p_now timestamptz) returns date
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select (p_now at time zone coalesce(
    (select p.timezone from public.profiles p where p.id = p_user and private.is_valid_timezone(p.timezone)),
    'UTC'))::date
$$;
revoke all on function private.little_thing_day(uuid, timestamptz) from public, anon, authenticated, service_role;

-- What the sender used of a kind on a day: kisses per kiss, everything else per send.
create or replace function private.little_thing_used(p_user uuid, p_kind text, p_day date) returns integer
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select coalesce(sum(case when p_kind = 'kiss' then l.amount else 1 end), 0)::integer
    from public.little_things l
   where l.sender_id = p_user and l.kind = p_kind and l.local_date = p_day and l.undone_at is null
$$;
revoke all on function private.little_thing_used(uuid, text, date) from public, anon, authenticated, service_role;

create or replace function private.little_things_state(p_user uuid, p_couple uuid, p_now timestamptz)
returns setof public.little_thing_state
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  with ctx as (
    select private.little_thing_day(p_user, p_now) d, private.is_couple_premium(p_couple) prem
  )
  select k.kind,
         private.little_thing_used(p_user, k.kind, ctx.d) >= private.little_thing_limit(k.kind, ctx.prem),
         not ctx.prem and k.kind in ('kiss', 'hug', 'miss_you')
    from ctx, unnest(array['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you']) with ordinality k(kind, n)
   order by k.n
$$;
revoke all on function private.little_things_state(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;

-- The caller's active couple with two current members, or NOT_PAIRED.
create or replace function private.little_things_couple() returns uuid
language plpgsql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_couple uuid := private.my_couple_id();
begin
  if v_couple is null
     or (select count(*) from public.couple_members m where m.couple_id = v_couple and m.left_at is null) < 2 then
    perform private.raise_error('NOT_PAIRED');
  end if;
  return v_couple;
end $$;
revoke all on function private.little_things_couple() from public, anon, authenticated, service_role;

-- ───────────────────────────── send ─────────────────────────────

create or replace function private.send_little_thing_at(p_kind text, p_amount integer, p_client_id uuid, p_now timestamptz)
returns public.little_thing_sent
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_couple  uuid;
  v_amount  integer := coalesce(p_amount, 1);
  v_day     date;
  v_premium boolean;
  v_limit   integer;
  v_used    integer;
  v_row     public.little_things;
  v_same    boolean := false;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  v_couple := private.little_things_couple();
  if p_kind is null or p_kind not in ('hug', 'kiss', 'goodnight', 'good_morning', 'miss_you')
     or (p_kind = 'kiss' and v_amount not between 1 and 5)
     or (p_kind = 'hug' and v_amount not between 1 and 5000)
     or (p_kind not in ('kiss', 'hug') and v_amount <> 1) then
    perform private.raise_error('INVALID_LITTLE_THING');
  end if;

  -- Serialise the couple's sends: the sender's own concurrent sends (limit) and the partner's
  -- hug (same-time decision). A sender has one active couple, so this also covers the limit.
  perform pg_advisory_xact_lock(hashtext('little_things:' || v_couple::text));

  if p_client_id is not null then
    select * into v_row from public.little_things where sender_id = v_uid and client_id = p_client_id;
    if found then
      v_day := v_row.local_date;
      v_premium := private.is_couple_premium(v_row.couple_id);
      return (v_row.id, v_row.same_time,
              private.little_thing_used(v_uid, v_row.kind, v_day) >= private.little_thing_limit(v_row.kind, v_premium));
    end if;
  end if;

  v_day := private.little_thing_day(v_uid, p_now);
  v_premium := private.is_couple_premium(v_couple);
  v_limit := private.little_thing_limit(p_kind, v_premium);
  v_used := private.little_thing_used(v_uid, p_kind, v_day);
  if v_used + (case when p_kind = 'kiss' then v_amount else 1 end) > v_limit then
    raise exception using message = 'LITTLE_THING_LIMIT', errcode = 'P0001',
      detail = format('{"kind":"%s","more_with_premium":%s}', p_kind,
                      (not v_premium and p_kind in ('kiss', 'hug', 'miss_you'))::text);
  end if;

  if p_kind = 'hug' then
    v_same := exists (
      select 1 from public.little_things l
       where l.couple_id = v_couple and l.sender_id <> v_uid and l.kind = 'hug' and l.undone_at is null
         and l.created_at between p_now - interval '10 seconds' and p_now);
  end if;

  insert into public.little_things (couple_id, sender_id, kind, amount, local_date, same_time, client_id, created_at)
    values (v_couple, v_uid, p_kind, v_amount, v_day, v_same, p_client_id, p_now)
    returning * into v_row;
  return (v_row.id, v_row.same_time,
          v_used + (case when p_kind = 'kiss' then v_amount else 1 end) >= v_limit);
end $$;
revoke all on function private.send_little_thing_at(text, integer, uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.send_little_thing(p_kind text, p_amount integer default 1, p_client_id uuid default null)
returns public.little_thing_sent
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.send_little_thing_at(p_kind, p_amount, p_client_id, now())
$$;
revoke all on function public.send_little_thing(text, integer, uuid) from public, anon;
grant execute on function public.send_little_thing(text, integer, uuid) to authenticated;

-- ───────────────────────────── undo ─────────────────────────────

create or replace function private.undo_little_thing_at(p_id uuid, p_now timestamptz)
returns setof public.little_thing_state
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row public.little_things;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  select * into v_row from public.little_things where id = p_id and sender_id = v_uid for update;
  -- Unknown, or someone else's: the same code, so an id of another couple reveals nothing.
  if not found then perform private.raise_error('INVALID_LITTLE_THING'); end if;
  if v_row.undone_at is null then
    if p_now > v_row.created_at + interval '5 seconds' then
      perform private.raise_error('UNDO_EXPIRED');
    end if;
    update public.little_things set undone_at = p_now where id = v_row.id;
  end if;
  return query select * from private.little_things_state(v_uid, v_row.couple_id, p_now);
end $$;
revoke all on function private.undo_little_thing_at(uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.undo_little_thing(p_id uuid)
returns setof public.little_thing_state
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select * from private.undo_little_thing_at(p_id, now())
$$;
revoke all on function public.undo_little_thing(uuid) from public, anon;
grant execute on function public.undo_little_thing(uuid) to authenticated;

-- ───────────────────────────── today ─────────────────────────────

create or replace function private.little_things_today_at(p_now timestamptz)
returns setof public.little_thing_state
language plpgsql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_couple uuid;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  v_couple := private.little_things_couple();
  return query select * from private.little_things_state(v_uid, v_couple, p_now);
end $$;
revoke all on function private.little_things_today_at(timestamptz) from public, anon, authenticated, service_role;

create or replace function public.little_things_today()
returns setof public.little_thing_state
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select * from private.little_things_today_at(now())
$$;
revoke all on function public.little_things_today() from public, anon;
grant execute on function public.little_things_today() to authenticated;

-- ───────────────────────────── voice_sweep without p_now (SEC-09c Info 3) ─────────────────────────────

drop function public.voice_sweep(timestamptz, integer);
create function public.voice_sweep(p_limit integer default 500)
returns setof text
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  delete from private.voice_uploads where created_at < now() - interval '3 days';
  return query
    select o.name from storage.objects o
     where o.bucket_id = 'voice'
       and not exists (select 1 from public.answers a where a.voice_path = o.name)
       and not exists (select 1 from public.thread_messages m where m.voice_path = o.name)
       and (o.created_at < now() - interval '24 hours'
            or not exists (select 1 from public.couples c where c.id::text = split_part(o.name, '/', 1))
            or not exists (select 1 from public.profiles p where p.id::text = split_part(o.name, '/', 2)))
     order by o.created_at, o.name
     limit greatest(1, least(coalesce(p_limit, 500), 1000));
end $$;
revoke all on function public.voice_sweep(integer) from public, anon, authenticated;
grant execute on function public.voice_sweep(integer) to service_role;
