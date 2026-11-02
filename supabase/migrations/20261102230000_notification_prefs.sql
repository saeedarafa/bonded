-- BE-07: notification_prefs (D23), timezone validation, push_tokens (CONTRACTS §2).
--   D23  one row per user: ritual time, one toggle per push type, quiet hours. Replaces
--        profiles.reminder_time. Copy and caps live in supabase/content/notifications.json.
--   Timezones are IANA names: profiles.timezone and couples.timezone are checked.
--   push_tokens: own rows only; register_push_token() moves a token to the signed-in user.

-- ───────────────────────────── timezone check ─────────────────────────────
-- IANA names only (Europe/Berlin, America/New_York, UTC). pg_timezone_names also lists abbreviations
-- and POSIX forms ('EST', 'UTC+3') that would silently mean something else, so the shape is checked too.
create or replace function private.is_valid_timezone(p_tz text) returns boolean
language sql stable set search_path = pg_catalog as $$
  select p_tz is not null
     and p_tz ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'
     and (p_tz = 'UTC' or p_tz like '%/%')
     and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = p_tz)
$$;

-- NOT VALID: rows written before this migration are not re-checked; every new or changed value is.
alter table public.profiles add constraint profiles_timezone_is_iana check (private.is_valid_timezone(timezone)) not valid;
alter table public.couples  add constraint couples_timezone_is_iana  check (private.is_valid_timezone(timezone)) not valid;

-- ───────────────────────────── notification_prefs ─────────────────────────────
create table public.notification_prefs (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  ritual_time      time not null default '21:00',       -- local time of the daily ritual reminder
  daily_reminder   boolean not null default true,       -- type ritual_reminder
  partner_answered boolean not null default true,       -- types partner_answered, both_answered
  replies          boolean not null default true,       -- replies and reactions (grouped within 5 min)
  last_call        boolean not null default true,       -- 22:30 when a streak of 3+ is at risk
  nudges           boolean not null default true,
  tips             boolean not null default false,      -- "tips and news": opt-in
  quiet_start      time not null default '23:00',
  quiet_end        time not null default '07:00',
  updated_at       timestamptz not null default now(),
  constraint notification_prefs_quiet_hours_differ check (quiet_start <> quiet_end)
);
alter table public.notification_prefs enable row level security;
create trigger notification_prefs_touch before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

create policy "read own prefs" on public.notification_prefs for select to authenticated using (user_id = auth.uid());
create policy "add own prefs" on public.notification_prefs for insert to authenticated with check (user_id = auth.uid());
create policy "change own prefs" on public.notification_prefs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.notification_prefs from anon;
revoke delete on public.notification_prefs from authenticated;   -- removed with the account (cascade)

-- Carry over the old reminder time, then drop it.
insert into public.notification_prefs (user_id, ritual_time)
  select id, coalesce(reminder_time, '21:00') from public.profiles
  on conflict (user_id) do nothing;
alter table public.profiles drop column reminder_time;

-- Every new account starts with the defaults, so the server can always read a row.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  insert into notification_prefs (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

-- Quiet hours may wrap midnight (23:00 → 07:00). For the notify function (BE-08): is the local time inside?
create or replace function private.in_quiet_hours(p_local time, p_start time, p_end time) returns boolean
language sql immutable as $$
  select case when p_start < p_end then p_local >= p_start and p_local < p_end
              else p_local >= p_start or p_local < p_end end
$$;

-- ───────────────────────────── push_tokens ─────────────────────────────
-- Policy from 0001 ("own push tokens", FOR ALL, user_id = auth.uid()) stays. Anon gets nothing.
revoke all on public.push_tokens from anon;
alter table public.push_tokens add constraint push_tokens_token_length check (char_length(token) between 8 and 512);
create index push_tokens_by_user on public.push_tokens (user_id);

-- A device keeps its token when another person signs in on it, so the row must move to the new
-- user; a client can't do that with a plain upsert (it doesn't own the old row). Idempotent.
create or replace function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  insert into push_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;
revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
