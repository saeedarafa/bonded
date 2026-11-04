-- BE-11 / D18: one protected missed day per couple-local calendar month.
-- This ledger affects streaks only; no answers, reveals or daily completion are synthesized.
create table private.streak_savers (
  couple_id uuid not null references public.couples(id) on delete cascade,
  used_month date not null,
  saved_day date not null,
  saved_current int not null check (saved_current > 1),
  primary key (couple_id, used_month),
  unique (couple_id, saved_day),
  check (used_month = date_trunc('month', used_month)::date)
);
alter table private.streak_savers enable row level security;
revoke all on private.streak_savers from public, anon, authenticated, service_role;

-- Consecutive completed/protected days ending at p_end. Checkpoints preserve the run
-- that existed before saving, including history imported before daily answer bookkeeping.
create function private.streak_run(p_couple uuid, p_end date) returns int
language sql stable set search_path = public as $$
  with days as (
    select q.assigned_for d from couple_questions q
    where q.couple_id = p_couple and q.source = 'daily' and q.assigned_for <= p_end
      and (select count(*) from answers a where a.couple_question_id = q.id and a.counts_for_streak) >= 2
    union
    select saved_day from private.streak_savers where couple_id = p_couple and saved_day <= p_end
  ), numbered as (
    select d, row_number() over (order by d desc) rn from days
  ), run as (
    select count(*)::int n from numbered where d = p_end - (rn - 1)::int
  )
  select greatest(run.n, coalesce((
    select max(s.saved_current + (p_end - s.saved_day)) from private.streak_savers s
    where s.couple_id = p_couple and s.saved_day between p_end - run.n + 1 and p_end
  ), 0)) from run
$$;
revoke all on function private.streak_run(uuid, date) from public, anon, authenticated, service_role;

-- Returns the previous run only when yesterday is the single missing day.
create function private.saver_base(p_couple uuid, p_today date) returns int
language plpgsql stable set search_path = public as $$
declare s couple_streaks;
begin
  select * into s from couple_streaks where couple_id = p_couple;
  -- A month rollover cannot turn two consecutive missed days into one gap.
  if exists (select 1 from private.streak_savers where couple_id = p_couple and saved_day = p_today - 2)
    and not exists (select 1 from couple_questions q where q.couple_id = p_couple
      and q.source = 'daily' and q.assigned_for = p_today - 2
      and (select count(*) from answers a where a.couple_question_id = q.id and a.counts_for_streak) >= 2) then
    return 0;
  end if;
  if s.last_completed_on = p_today - 2 then return s.current; end if;
  if s.last_completed_on = p_today and private.streak_run(p_couple, p_today - 1) = 0 then
    return private.streak_run(p_couple, p_today - 2);
  end if;
  return 0;
end $$;
revoke all on function private.saver_base(uuid, date) from public, anon, authenticated, service_role;

create function private.saver_premium(p_couple uuid, p_now timestamptz) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from couple_members m join entitlements e on e.user_id = m.user_id
    where m.couple_id = p_couple and m.left_at is null and e.is_active
      and (e.expires_at is null or e.expires_at > p_now))
$$;
revoke all on function private.saver_premium(uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function private.get_streak_at(p_now timestamptz) returns public.streak_state
language plpgsql set search_path = public as $$
declare
  v_couple uuid := private.my_couple_id();
  v_today date;
  s couple_streaks;
  v_cur int;
  v_available boolean;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  select (p_now at time zone c.timezone)::date into v_today from couples c where c.id = v_couple;
  select * into s from couple_streaks where couple_id = v_couple;
  if not found then return row(0, 0, null, false, false, false)::public.streak_state; end if;
  v_cur := case when s.last_completed_on >= v_today - 1 then s.current else 0 end;
  v_available := private.saver_premium(v_couple, p_now)
    and private.saver_base(v_couple, v_today) > 0
    and not exists (select 1 from private.streak_savers where couple_id = v_couple
      and used_month = date_trunc('month', v_today)::date);
  return row(v_cur, s.longest, s.last_completed_on, coalesce(s.last_completed_on = v_today, false),
    v_cur >= 3 and s.last_completed_on is distinct from v_today, v_available)::public.streak_state;
end $$;

create function private.use_streak_saver_at(p_now timestamptz) returns public.streak_state
language plpgsql set search_path = public as $$
declare
  v_couple uuid := private.my_couple_id();
  v_today date;
  v_base int;
  s couple_streaks;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  -- Same parent lock as pairing/unpairing; recheck membership after waiting.
  select (p_now at time zone timezone)::date into v_today from couples
    where id = v_couple and status = 'active' for update;
  if not found or not exists (select 1 from couple_members where couple_id = v_couple
    and user_id = auth.uid() and left_at is null) then
    perform private.raise_error('NOT_PAIRED');
  end if;
  select * into s from couple_streaks where couple_id = v_couple for update;
  -- Retrying either partner's same-day success consumes nothing, even after expiry.
  if exists (select 1 from private.streak_savers where couple_id = v_couple and saved_day = v_today - 1) then
    return private.get_streak_at(p_now);
  end if;
  if not private.saver_premium(v_couple, p_now) then perform private.raise_error('PREMIUM_REQUIRED'); end if;
  v_base := private.saver_base(v_couple, v_today);
  if v_base <= 0 or exists (select 1 from private.streak_savers where couple_id = v_couple
    and used_month = date_trunc('month', v_today)::date) then
    perform private.raise_error('SAVER_UNAVAILABLE');
  end if;
  insert into private.streak_savers values (v_couple, date_trunc('month', v_today)::date, v_today - 1, v_base + 1);
  update couple_streaks set current = v_base + 1 + case when s.last_completed_on = v_today then 1 else 0 end,
    longest = greatest(longest, v_base + 1 + case when s.last_completed_on = v_today then 1 else 0 end),
    last_completed_on = greatest(s.last_completed_on, v_today - 1)
  where couple_id = v_couple;
  return private.get_streak_at(p_now);
end $$;
revoke all on function private.use_streak_saver_at(timestamptz) from public, anon, authenticated, service_role;

create function public.use_streak_saver() returns public.streak_state
language plpgsql security definer set search_path = public as $$
begin
  return private.use_streak_saver_at(now());
end $$;
revoke all on function public.use_streak_saver() from public, anon;
grant execute on function public.use_streak_saver() to authenticated;

-- Keep protected days when an offline arrival fills an older gap. New days extend
-- the same locked streak row, so a saver and an answer serialize without double counting.
create or replace function public.on_answer_inserted() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_cq      couple_questions;
  v_all     int;
  v_counted int;
  v_streak  couple_streaks;
  v_next    int;
  v_run     int;
begin
  -- Row lock serialises the two partners' inserts so the counts below see both.
  select * into v_cq from couple_questions where id = new.couple_question_id for update;
  select count(*), count(*) filter (where counts_for_streak) into v_all, v_counted
    from answers where couple_question_id = v_cq.id;
  update couple_questions set answer_count = v_all where id = v_cq.id;

  if v_cq.source <> 'daily' or v_counted < 2 then return new; end if;

  select * into v_streak from couple_streaks where couple_id = v_cq.couple_id for update;
  if v_streak.last_completed_on is null or v_cq.assigned_for > v_streak.last_completed_on then
    v_next := case when v_streak.last_completed_on = v_cq.assigned_for - 1 then v_streak.current + 1 else 1 end;
    update couple_streaks
       set current = v_next, longest = greatest(longest, v_next), last_completed_on = v_cq.assigned_for
     where couple_id = v_cq.couple_id;
  elsif v_cq.assigned_for < v_streak.last_completed_on then
    -- A late day: count the run of consecutive completed days that ends at the last one.
    v_run := private.streak_run(v_cq.couple_id, v_streak.last_completed_on);
    if v_run > v_streak.current then
      update couple_streaks set current = v_run, longest = greatest(longest, v_run) where couple_id = v_cq.couple_id;
    end if;
  end if;
  return new;
end $$;

