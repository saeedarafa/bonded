-- BE-57 (D56, PO 2026-11-11; CONTRACTS §2): a daily question can be answered only on its own day.
--
-- For every couple (free and Premium) a client write to `answers` (insert, the INSERT half of an
-- upsert, update; text and voice) on a DAILY couple question is accepted only while that question is
-- the couple's current one: its `assigned_for` is the couple-local today (`couples.timezone`, the
-- `get_daily_question` boundary), plus a 15-minute grace after midnight by ARRIVAL time on the
-- database clock (lead decision 1). `client_written_at` plays no part. Otherwise `DAY_ENDED`.
--
--   * Edits follow the same window (lead decision 2). An unchanged re-send of the caller's own
--     stored answer (a retry, the offline queue) is not an edit: it succeeds and changes nothing,
--     so a write that already landed never turns into an error on retry.
--   * Pack questions (D51) have no day: unaffected (Premium rules unchanged).
--   * A row assigned for a LATER local day than today (only after a `couples.timezone` change) stays
--     answerable: the check is `assigned_for >= the local date of (now - 15 min)`.
--   * Like the BE-55 history guard, only direct client writes (session role `authenticated`) of the
--     writer's own row, in their active couple, on a question of the pair period. Anything else
--     (another couple, a foreign user_id, an ended couple) is left to RLS, so the error cannot reveal
--     another couple's dates; server code (service role, seeds, cron) is not affected.
--   * The trigger sorts after `answers_before_write` (so on UPDATE couple_question_id and user_id are
--     already pinned to the stored row) and before `answers_history_lock`, `answers_length_check`
--     and `answers_voice_check`: a past day answers `DAY_ENDED`, never `PREMIUM_REQUIRED` (no paywall,
--     lead decision 3).
--   * D17 is unchanged in form (`counts_for_streak`); in practice a late daily answer can now only
--     arrive within the grace, so it still counts when it was written on its day.

alter type public.error_code add value if not exists 'DAY_ENDED';

-- Whether couple question p_cq can still be answered at p_now. Pure on its inputs except the row
-- lookup, so tests pin the clock. Non-daily (pack) questions and unknown ids: true.
create or replace function private.answer_day_open_at(p_cq uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select coalesce((
    select cq.source <> 'daily' or cq.assigned_for is null
        or cq.assigned_for >= ((p_now - interval '15 minutes') at time zone c.timezone)::date
      from public.couple_questions cq join public.couples c on c.id = cq.couple_id
     where cq.id = p_cq), true)
$$;
revoke all on function private.answer_day_open_at(uuid, timestamptz) from public, anon, authenticated, service_role;

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
  -- An unchanged re-send of the caller's own stored answer is a no-op, not an edit.
  if tg_op = 'UPDATE' then
    if (new.kind, new.body, new.voice_path, new.voice_duration_ms)
       is not distinct from (old.kind, old.body, old.voice_path, old.voice_duration_ms) then
      return new;
    end if;
  elsif exists (select 1 from public.answers a
                 where a.couple_question_id = new.couple_question_id and a.user_id = new.user_id
                   and (a.kind, a.body, a.voice_path, a.voice_duration_ms)
                       is not distinct from (new.kind, new.body, new.voice_path, new.voice_duration_ms)) then
    -- The INSERT half of such an upsert: BEFORE INSERT fires for the proposed row before the
    -- conflict is found; the DO UPDATE half then passes the UPDATE branch above.
    return new;
  end if;
  raise exception using message = 'DAY_ENDED', errcode = 'P0001';
end $$;
revoke all on function private.answer_day_guard() from public, anon, authenticated, service_role;

create trigger answers_day_window before insert or update on public.answers
  for each row execute function private.answer_day_guard();
