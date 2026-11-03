-- BE-06 / QA-BUG-3: `streak_state.completed_today` is a boolean, never SQL NULL.
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
  return row(v_cur, s.longest, s.last_completed_on, coalesce(s.last_completed_on = v_today, false),
             v_cur >= 3 and s.last_completed_on is distinct from v_today, false)::public.streak_state;
end $$;
