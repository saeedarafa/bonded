-- BE-55b (SEC-12 #216 follow-ups, SEC-13 #223 Info 3, mobile MOB-71 request; CONTRACTS §2).
--
-- 1. (SEC-12 Low) The History lock's "today" never moves behind an already-assigned day.
--    `couples.timezone` is writable by an active member; switching e.g. +14 → −12 moved the local
--    today back ~26 h and reopened day −2 (and briefly −3) for a free couple. The open window is now
--    anchored at greatest(couple-local today, the couple's newest daily `assigned_for`), the same
--    newest-daily-row rule BE-57 uses for answering (D56). Open = day >= anchor − 1, or Premium.
--    A zone change can now only close a day earlier, never reopen one.
-- 2. (SEC-12 Info) Second layer: the INSERT and UPDATE `with check`s of answers, thread_messages and
--    reactions also require `private.cq_content_open(...)`. BEFORE triggers run before WITH CHECK,
--    so a client still gets `PREMIUM_REQUIRED` / `DAY_ENDED` from the guards; if a guard ever
--    regresses, the write fails as an RLS error instead of landing in a locked day. An unchanged
--    re-send that a guard skips (BE-57 follow-up: the trigger returns NULL) writes nothing, so no
--    check runs and it still succeeds. Server code (service role, owner) bypasses RLS as before.
-- 3. (SEC-13 Info 3, documented + pinned in tests) A daily row assigned for a LATER local date than
--    today (only after an eastward zone change pulled "tomorrow" early through get_daily_question)
--    stays answerable while it is the couple's newest daily row, and it anchors the History window
--    (item 1). A row for the local today created below it answers DAY_ENDED. Own couple only, no
--    content of another couple, no paywall bypass: accepted, no schema change.
-- 4. (mobile) `history_days(..., p_answered_only boolean default false)`: true returns only days
--    with at least one answer (either partner), filtered before limit/offset, so a page of N holds
--    N answered days. The four-argument call keeps working (named arguments, default false).

-- ───────────────────────────── 1. Anchored couple "today" ─────────────────────────────

-- greatest(the couple-local date at p_now, the couple's newest daily assigned_for). Index lookup on
-- couple_questions_one_daily_per_day. Definer, no grants: called only from definer functions.
create or replace function private.couple_history_today_at(p_couple uuid, p_tz text, p_now timestamptz)
returns date
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select greatest((p_now at time zone p_tz)::date,
                  (select max(n.assigned_for) from public.couple_questions n
                    where n.couple_id = p_couple and n.source = 'daily'))
$$;
revoke all on function private.couple_history_today_at(uuid, text, timestamptz) from public, anon, authenticated, service_role;

create or replace function private.cq_content_open_at(p_cq uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select coalesce((
    select private.cq_day(cq.assigned_for, cq.created_at, c.timezone)
             >= private.couple_history_today_at(c.id, c.timezone, p_now) - 1
        or case when c.status = 'active' then private.is_couple_premium(c.id)
                else exists (select 1 from public.entitlements e
                              where e.user_id = auth.uid() and e.is_active
                                and (e.expires_at is null or e.expires_at > p_now))
           end
      from public.couple_questions cq join public.couples c on c.id = cq.couple_id
     where cq.id = p_cq), false)
$$;
-- (Grants unchanged: create or replace keeps them; restated for clarity.)
revoke all on function private.cq_content_open_at(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.cq_content_open_at(uuid, timestamptz) to authenticated, service_role;

-- ───────────────────────────── 2. Second-layer write checks ─────────────────────────────

alter policy "write own answer in active couple" on public.answers
  with check (user_id = auth.uid() and private.is_active_cq_member(couple_question_id)
              and private.cq_in_pair_period(couple_question_id)
              and private.cq_content_open(couple_question_id));

alter policy "edit own answer in active couple" on public.answers
  with check (user_id = auth.uid() and private.is_active_cq_member(couple_question_id)
              and private.cq_in_pair_period(couple_question_id)
              and private.cq_content_open(couple_question_id));

alter policy "post to open threads in active couple" on public.thread_messages
  with check (user_id = auth.uid() and private.is_active_cq_member(couple_question_id)
              and private.cq_in_pair_period(couple_question_id)
              and private.both_answered(couple_question_id)
              and private.cq_content_open(couple_question_id));

alter policy "edit own messages in active couple" on public.thread_messages
  with check (user_id = auth.uid() and private.is_active_cq_member(couple_question_id)
              and private.cq_in_pair_period(couple_question_id)
              and private.cq_content_open(couple_question_id));

alter policy "react in active couple" on public.reactions
  with check (user_id = auth.uid()
              and private.is_active_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.cq_in_pair_period(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.has_answered(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.cq_content_open(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))));

alter policy "change own reactions in active couple" on public.reactions
  with check (user_id = auth.uid()
              and private.is_active_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.cq_in_pair_period(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.has_answered(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.cq_content_open(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))));

-- ───────────────────────────── 4. history_days(p_answered_only) ─────────────────────────────

drop function public.history_days(uuid, integer, integer, uuid);
drop function private.history_days_at(uuid, integer, integer, uuid, timestamptz);

create function private.history_days_at(
  p_couple_id uuid, p_limit integer, p_offset integer, p_couple_question_id uuid, p_now timestamptz,
  p_answered_only boolean default false)
returns table (
  couple_question_id uuid, couple_id uuid, question_id uuid, question jsonb, source text, day date,
  created_at timestamptz, my_answered boolean, partner_answered boolean, message_count integer,
  locked boolean)
language plpgsql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  v_couple uuid := p_couple_id;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if p_couple_question_id is not null then
    select cq.couple_id into v_couple from public.couple_questions cq where cq.id = p_couple_question_id;
  elsif v_couple is null then
    v_couple := private.my_couple_id();
    if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  end if;
  if v_couple is null or not private.can_read_couple(v_couple) then return; end if;

  return query
    select cq.id, cq.couple_id, cq.question_id, to_jsonb(q.*), cq.source,
           private.cq_day(cq.assigned_for, cq.created_at, c.timezone), cq.created_at,
           exists (select 1 from public.answers a where a.couple_question_id = cq.id and a.user_id = v_uid),
           exists (select 1 from public.answers a where a.couple_question_id = cq.id and a.user_id <> v_uid),
           case when private.cq_in_pair_period(cq.id) and private.both_answered(cq.id)
                then (select count(*)::int from public.thread_messages m where m.couple_question_id = cq.id)
                else 0 end,
           not private.cq_content_open_at(cq.id, p_now)
      from public.couple_questions cq
      join public.couples c on c.id = cq.couple_id
      left join public.questions q on q.id = cq.question_id
     where cq.couple_id = v_couple
       and (p_couple_question_id is null or cq.id = p_couple_question_id)
       and (not coalesce(p_answered_only, false)
            or exists (select 1 from public.answers a where a.couple_question_id = cq.id))
     order by cq.created_at desc, cq.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 100)
     offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function private.history_days_at(uuid, integer, integer, uuid, timestamptz, boolean)
  from public, anon, authenticated, service_role;

create function public.history_days(
  p_couple_id uuid default null, p_limit integer default 30, p_offset integer default 0,
  p_couple_question_id uuid default null, p_answered_only boolean default false)
returns table (
  couple_question_id uuid, couple_id uuid, question_id uuid, question jsonb, source text, day date,
  created_at timestamptz, my_answered boolean, partner_answered boolean, message_count integer,
  locked boolean)
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select * from private.history_days_at(p_couple_id, p_limit, p_offset, p_couple_question_id, now(), p_answered_only)
$$;
revoke all on function public.history_days(uuid, integer, integer, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.history_days(uuid, integer, integer, uuid, boolean) to authenticated;
