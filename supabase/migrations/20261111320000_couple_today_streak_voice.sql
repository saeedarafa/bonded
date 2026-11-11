-- BE-55d (SEC-15 #250 Info 1; CONTRACTS §2): the streak state, the streak saver and the voice-cap
-- bucket use the shared couple "today" from BE-55c instead of the plain local date.
--
--   private.couple_today_at = greatest(local today, newest daily assigned_for, history_floor − 1)
--
-- On a normal day (no timezone change that moves the local date back) this IS the local date: the
-- newest daily row is today's or older, and history_floor is null or at most local today + 1.
-- Behaviour only changes after a westward jump:
--   * get_streak (`completed_today`, `at_risk`, `current`, `saver_available`, `saver_reason`)
--     follows the day the couple is actually answering (the row get_daily_question returns), so
--     +14 → −12 no longer shows a completed day as not completed / at risk for about a day.
--   * use_streak_saver protects the day before the couple today and books it on that month, so a
--     zone switch around a month boundary cannot move `used_month` back for an extra save.
--   * start_voice_upload counts the 35 slots in the bucket
--       greatest(couple today, the couple's newest slot bucket)
--     so a zone switch can never reopen an older bucket: the per-couple daily cap cannot be
--     stretched by switching zones (SEC-09b Info 4 closed). Slots are kept 3 days by the sweep,
--     longer than any zone gap (26 h).
-- All three functions keep their signatures, grants (create or replace preserves the ACLs) and
-- error codes. Streak increments were already keyed on the row's `assigned_for` (unchanged).
-- Not changed (SEC-15 Info 3, fails closed): due_reminders' last_call date.

-- ───────────────────────────── get_streak ─────────────────────────────

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
  -- BE-55d: the couple today (same day as get_daily_question), not the plain local date.
  select private.couple_today_at(c.id, c.timezone, p_now) into v_today from couples c where c.id = v_couple;
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

-- ───────────────────────────── use_streak_saver ─────────────────────────────

create or replace function private.use_streak_saver_at(p_now timestamptz) returns public.streak_state
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid := private.my_couple_id();
  v_tz text;
  v_today date;
  v_base int;
  s couple_streaks;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  -- Same parent lock as pairing/unpairing; recheck membership after waiting.
  select timezone into v_tz from couples
    where id = v_couple and status = 'active' for update;
  if not found or not exists (select 1 from couple_members where couple_id = v_couple
    and user_id = auth.uid() and left_at is null) then
    perform private.raise_error('NOT_PAIRED');
  end if;
  -- BE-55d: the couple today, read under the parent lock (the newest daily row and the floor
  -- are written under the same lock).
  v_today := private.couple_today_at(v_couple, v_tz, p_now);
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
  insert into private.streak_savers values (v_couple, date_trunc('month', v_today)::date, v_today - 1, v_base);
  update couple_streaks set current = v_base + case when s.last_completed_on = v_today then 1 else 0 end,
    longest = greatest(longest, v_base + case when s.last_completed_on = v_today then 1 else 0 end),
    last_completed_on = greatest(s.last_completed_on, v_today - 1)
  where couple_id = v_couple;
  return private.get_streak_at(p_now);
end $$;

-- ───────────────────────────── start_voice_upload (35 per couple per day) ─────────────────────────────

create or replace function private.start_voice_upload_at(p_ext text, p_now timestamptz) returns text
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_couple public.couples;
  v_today  date;
  v_name   text;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  -- Parent lock: two partners taking the 35th slot at once are serialised here.
  select * into v_couple from public.couples
   where id = private.my_couple_id() and status = 'active' for update;
  if not found then perform private.raise_error('NOT_PAIRED'); end if;
  if not private.is_couple_premium(v_couple.id) then perform private.raise_error('PREMIUM_REQUIRED'); end if;
  if p_ext is null or p_ext not in ('m4a', 'aac', 'ogg', 'opus') then
    perform private.raise_error('INVALID_VOICE');
  end if;
  -- BE-55d: the couple today, and never an older bucket than the newest one used (monotone, so a
  -- zone switch cannot reopen a full day).
  v_today := greatest(private.couple_today_at(v_couple.id, v_couple.timezone, p_now),
                      (select max(u.local_date) from private.voice_uploads u where u.couple_id = v_couple.id));
  if (select count(*) from private.voice_uploads u
       where u.couple_id = v_couple.id and u.local_date = v_today) >= 35 then
    raise exception using message = 'VOICE_LIMIT', errcode = 'P0001', detail = '{"max":35}';
  end if;
  v_name := v_couple.id::text || '/' || v_uid::text || '/' || gen_random_uuid()::text || '.' || p_ext;
  insert into private.voice_uploads (name, couple_id, user_id, local_date, created_at)
    values (v_name, v_couple.id, v_uid, v_today, p_now);
  return v_name;
end $$;
-- Replacing the private functions preserves their existing revoked ACLs.
