-- BE-06: streak v2 (D17; CONTRACTS §2).
--   D17  An answer to the daily question of local day D counts for D if it was written on D
--        (answers.client_written_at, or arrival time when the client sent none) and it arrives
--        before the end of D+1 in the couple's timezone. Later answers are saved but don't count.
--   get_streak()  current is already 0 after a missed day.
--   Late arrivals that fill a gap merge the streak instead of being ignored.
--   Concurrent get_daily_question() calls are covered by the existing unique index + ON CONFLICT.

-- ───────────────────────────── answers.client_written_at / counts_for_streak ─────────────────────────────
alter table public.answers
  add column client_written_at timestamptz,
  add column counts_for_streak boolean not null default true;
comment on column public.answers.client_written_at is 'Device time the answer was written (offline queue, D17). Clamped to arrival time; the day it names is the day the answer counts for.';
comment on column public.answers.counts_for_streak is 'Server-computed at insert (D17): written on the question''s local day and arrived before the end of the next day. Never client-writable.';

-- The pure rule, so tests can pin every timestamp. Pack questions have no day: always true.
create or replace function private.answer_counts_for_day(
  p_assigned date, p_tz text, p_written timestamptz, p_arrived timestamptz) returns boolean
language sql immutable set search_path = pg_catalog, extensions, public, pg_temp as $$
  select p_assigned is null
      or ((p_written at time zone p_tz)::date = p_assigned
          and p_arrived < ((p_assigned + 2)::timestamp at time zone p_tz))
$$;
revoke all on function private.answer_counts_for_day(date, text, timestamptz, timestamptz) from public, anon, authenticated;

-- Server owns the clock: a client (auth.uid() set) can't backdate created_at, set the flag, or
-- change where an answer belongs. Without a JWT user (owner: seed, migrations, service role) the
-- row's own timestamps are trusted, which is what lets the seed build history.
create or replace function public.answers_before_write() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_assigned date;
  v_tz       text;
  v_arrived  timestamptz;
begin
  if tg_op = 'UPDATE' then
    new.couple_question_id := old.couple_question_id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
    new.client_written_at := old.client_written_at;
    new.counts_for_streak := old.counts_for_streak;
    return new;
  end if;
  v_arrived := case when auth.uid() is null then new.created_at else now() end;
  new.created_at := v_arrived;
  new.updated_at := v_arrived;
  new.client_written_at := least(coalesce(new.client_written_at, v_arrived), v_arrived);
  select cq.assigned_for, c.timezone into v_assigned, v_tz
    from couple_questions cq join couples c on c.id = cq.couple_id
   where cq.id = new.couple_question_id and cq.source = 'daily';
  new.counts_for_streak := private.answer_counts_for_day(v_assigned, coalesce(v_tz, 'UTC'), new.client_written_at, v_arrived);
  return new;
end $$;
create trigger answers_before_write before insert or update on public.answers
  for each row execute function public.answers_before_write();
-- (answers_touch from 0001 still sets updated_at on update; this trigger runs first by name order
--  and leaves updated_at alone on update.)

-- Clients write the text and the device time, nothing else (upsert on couple_question_id,user_id).
revoke insert, update on public.answers from anon, authenticated;
grant insert (couple_question_id, user_id, body, client_written_at) on public.answers to authenticated;
grant update (couple_question_id, user_id, body, client_written_at) on public.answers to authenticated;

-- ───────────────────────────── streak bookkeeping ─────────────────────────────
-- Replaces 0001's trigger function (same trigger). A daily question is complete when two answers
-- count for it. Completing the newest day extends (or restarts) the streak; completing an older
-- day late (offline sync) merges the streak if that fills a gap.
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
    select count(*) into v_run from (
      select d.assigned_for, row_number() over (order by d.assigned_for desc) rn
        from couple_questions d
       where d.couple_id = v_cq.couple_id and d.source = 'daily' and d.assigned_for <= v_streak.last_completed_on
         and (select count(*) from answers a where a.couple_question_id = d.id and a.counts_for_streak) >= 2
    ) t where t.assigned_for = v_streak.last_completed_on - (t.rn - 1)::int;
    if v_run > v_streak.current then
      update couple_streaks set current = v_run, longest = greatest(longest, v_run) where couple_id = v_cq.couple_id;
    end if;
  end if;
  return new;
end $$;

-- ───────────────────────────── get_streak ─────────────────────────────
create type public.streak_state as (
  current int, longest int, last_completed_on date,
  completed_today boolean, at_risk boolean, saver_available boolean);

-- current is 0 once last_completed_on is older than yesterday (couple's local date). at_risk: a
-- streak of 3+ that today's answers haven't secured yet (the "last call" push, D23).
-- saver_available stays false until BE-11.
create or replace function private.get_streak_at(p_now timestamptz) returns public.streak_state
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid := private.my_couple_id();
  v_today  date;
  s        couple_streaks;
  v_cur    int;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  select (p_now at time zone c.timezone)::date into v_today from couples c where c.id = v_couple;
  select * into s from couple_streaks where couple_id = v_couple;
  if not found then return row(0, 0, null, false, false, false)::public.streak_state; end if;
  v_cur := case when s.last_completed_on is not null and s.last_completed_on >= v_today - 1 then s.current else 0 end;
  return row(v_cur, s.longest, s.last_completed_on, s.last_completed_on = v_today,
             v_cur >= 3 and s.last_completed_on is distinct from v_today, false)::public.streak_state;
end $$;
revoke all on function private.get_streak_at(timestamptz) from public, anon, authenticated;

create function public.get_streak() returns public.streak_state
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  return private.get_streak_at(now());
end $$;
revoke all on function public.get_streak() from public, anon;
grant execute on function public.get_streak() to authenticated;
