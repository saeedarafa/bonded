-- BE-11 / #121 P2: additive context for screen 28. Existing saver rules stay in SQL.
create type public.streak_saver_reason as enum ('used_this_month', 'too_many_missed');
alter type public.streak_state add attribute saver_reason public.streak_saver_reason;
alter type public.streak_state add attribute previous_streak int;

create or replace function private.get_streak_at(p_now timestamptz) returns public.streak_state
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid := private.my_couple_id();
  v_today date;
  s couple_streaks;
  v_cur int;
  v_available boolean;
  v_base int;
  v_used boolean;
  v_reason public.streak_saver_reason;
  v_previous int;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  select (p_now at time zone c.timezone)::date into v_today from couples c where c.id = v_couple;
  select * into s from couple_streaks where couple_id = v_couple;
  if not found then return row(0, 0, null, false, false, false, null, null)::public.streak_state; end if;
  v_cur := case when s.last_completed_on >= v_today - 1 then s.current else 0 end;
  v_base := private.saver_base(v_couple, v_today);
  v_used := exists (select 1 from private.streak_savers where couple_id = v_couple
    and used_month = date_trunc('month', v_today)::date);
  v_available := private.saver_premium(v_couple, p_now) and v_base > 0 and not v_used;
  -- Explain the gap before the monthly quota. Fresh/ongoing/protected runs and
  -- lack of premium alone have no reason in this two-value vocabulary.
  if s.current > 0 and s.last_completed_on < v_today - 1 then
    v_previous := s.current;
    if v_base = 0 then v_reason := 'too_many_missed';
    elsif v_used then v_reason := 'used_this_month';
    end if;
  elsif v_base > 0 and v_used then
    -- Today's completion may restart the run while yesterday remains repairable.
    v_reason := 'used_this_month';
  end if;
  return row(v_cur, s.longest, s.last_completed_on, coalesce(s.last_completed_on = v_today, false),
    v_cur >= 3 and s.last_completed_on is distinct from v_today, v_available, v_reason, v_previous)::public.streak_state;
end $$;

-- Replacing the private function preserves its existing revoked ACL.
