-- BE-57 follow-up (SEC-13 on #223, lead decision 2026-11-11).
--
-- Info 1: a free member's UNCHANGED re-send of an own answer on day −2 or older passed
-- `answers_day_window` but then hit `PREMIUM_REQUIRED` from `answers_history_lock`. D56: a past day
-- never opens the paywall and an unchanged re-send succeeds.
--
-- It cannot succeed by writing: on a D55-locked day the caller's own stored row is outside the
-- SELECT/UPDATE policies, so the DO UPDATE half of the upsert would fail RLS. So when a guard would
-- refuse the write (`answers_day_window`: day ended; `answers_history_lock`: D55 lock) and the write
-- is an unchanged re-send of the caller's own stored answer, the guard now SKIPS the row (BEFORE
-- trigger returns NULL): no error, nothing written, no new row version, no Realtime event, no
-- `updated_at` change. For an upsert the skip happens in the INSERT half (BEFORE INSERT fires before
-- the conflict is found), so the DO UPDATE half never runs. The client sees success with 0 rows
-- (`upsert` without `.select()`, as the app does, returns no error). A real change on a past daily
-- day still gets `DAY_ENDED` (the day trigger sorts first); a real change on a locked pack question
-- still gets `PREMIUM_REQUIRED`; a new answer is never a re-send.
--
-- Info 2: on an open day an unchanged re-send is still written (the row passes every check), but
-- `answers_touch` now moves `updated_at` only when the content (kind, body, voice_path,
-- voice_duration_ms) changes. Postgres still writes a row version there, so Realtime may deliver an
-- UPDATE with identical content (CONTRACTS §2).
--
-- One shared predicate for both guards: "the caller's own stored row already has exactly this
-- content". UPDATE compares with OLD (couple_question_id and user_id are pinned to OLD by
-- `answers_before_write`); INSERT looks up the caller's stored row. Never another user's row.

create or replace function private.answer_resend_unchanged(p_op text, p_new public.answers, p_old public.answers)
returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select case
    when p_op = 'UPDATE' then
      (p_new.kind, p_new.body, p_new.voice_path, p_new.voice_duration_ms)
        is not distinct from (p_old.kind, p_old.body, p_old.voice_path, p_old.voice_duration_ms)
    else exists (
      select 1 from public.answers a
       where a.couple_question_id = p_new.couple_question_id and a.user_id = p_new.user_id
         and (a.kind, a.body, a.voice_path, a.voice_duration_ms)
             is not distinct from (p_new.kind, p_new.body, p_new.voice_path, p_new.voice_duration_ms))
  end
$$;
revoke all on function private.answer_resend_unchanged(text, public.answers, public.answers) from public, anon, authenticated, service_role;

-- Same behaviour as 20261111270000, now through the shared predicate.
create or replace function private.answer_day_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if coalesce(current_setting('role', true), 'none') <> 'authenticated' or auth.uid() is null
     or new.user_id is distinct from auth.uid() then
    return new;
  end if;
  if new.couple_question_id is null or not private.is_active_cq_member(new.couple_question_id)
     or not private.cq_in_pair_period(new.couple_question_id) then
    return new;
  end if;
  if private.answer_day_open_at(new.couple_question_id, now()) then
    return new;
  end if;
  if private.answer_resend_unchanged(tg_op, new, case when tg_op = 'UPDATE' then old end) then
    return null;  -- skip: nothing to write (see header)
  end if;
  raise exception using message = 'DAY_ENDED', errcode = 'P0001';
end $$;
revoke all on function private.answer_day_guard() from public, anon, authenticated, service_role;

-- BE-55's guard with the answers re-send shortcut (Info 1). Threads and reactions unchanged.
create or replace function private.history_write_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_cq uuid;
begin
  if coalesce(current_setting('role', true), 'none') <> 'authenticated' or auth.uid() is null or new.user_id is distinct from auth.uid() then
    return new;
  end if;
  if tg_table_name = 'reactions' then
    v_cq := coalesce(private.answer_cq(new.answer_id), private.message_cq(new.message_id));
  else
    v_cq := new.couple_question_id;
  end if;
  if v_cq is null or not private.is_active_cq_member(v_cq) or not private.cq_in_pair_period(v_cq) then
    return new;
  end if;
  if not private.cq_content_open(v_cq) then
    -- Nested so the answers-typed expression is only planned when the trigger is on answers.
    if tg_table_name = 'answers' then
      if private.answer_resend_unchanged(tg_op, new, case when tg_op = 'UPDATE' then old end) then
        return null;  -- skip: nothing to write (see header)
      end if;
    end if;
    raise exception using message = 'PREMIUM_REQUIRED', errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.history_write_guard() from public, anon, authenticated, service_role;

-- Info 2: updated_at moves only when the content changes.
create or replace function private.answers_touch() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if (new.kind, new.body, new.voice_path, new.voice_duration_ms)
     is distinct from (old.kind, old.body, old.voice_path, old.voice_duration_ms) then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;
revoke all on function private.answers_touch() from public, anon, authenticated, service_role;

drop trigger answers_touch on public.answers;
create trigger answers_touch before update on public.answers
  for each row execute function private.answers_touch();
