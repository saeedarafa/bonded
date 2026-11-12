-- BE-58: hardening from SEC-18 (#330) and QA #307.
--
-- (a) SEC-18: `pack_questions` was readable by every signed-in user with `using (true)`, so the
--     ids of inactive (retired or not yet launched) packs and their question ids could be listed.
--     No text leaked (`questions` and `question_packs` are already active-only), but the mapping
--     should follow the pack: a row is visible only while its pack is active. Active packs read
--     exactly as before. `anon` has no policy (unchanged), so signed-out access stays denied.
--
-- (b) QA #307: `get_daily_question` on a couple's first day picks the `first_day` special question
--     (D12). If that question already has a `couple_questions` row for the couple (any source),
--     the insert was skipped by the unique index `couple_questions_once_per_couple` and the RPC
--     returned an all-null row. It now skips a `first_day` question the couple already has and
--     falls through to the normal pick; a lost insert race is retried with the next pick, so the
--     RPC returns a real row or raises a CONTRACTS §2 code, never a null row. Same signature,
--     same ACL, same codes; no type change.

-- ───────────────────────────── (a) pack_questions read policy ─────────────────────────────

drop policy "read pack items" on public.pack_questions;
create policy "read pack items of active packs" on public.pack_questions for select to authenticated
  using (exists (select 1 from public.question_packs p where p.id = pack_questions.pack_id and p.active));

-- ───────────────────────────── (b) get_daily_question ─────────────────────────────

create or replace function private.get_daily_question_at(p_now timestamptz) returns public.couple_questions
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple   uuid := private.my_couple_id();
  v_today    date;
  v_stage    public.couple_stage;
  v_question uuid;
  v_row      public.couple_questions;
  v_first    boolean;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  select private.couple_today_at(c.id, c.timezone, p_now), c.stage into v_today, v_stage
    from public.couples c where c.id = v_couple;

  select * into v_row from public.couple_questions
   where couple_id = v_couple and source = 'daily' and assigned_for = v_today;
  if found then return v_row; end if;

  v_first := not exists (select 1 from public.couple_questions where couple_id = v_couple and source = 'daily');

  -- At most three picks: each skipped insert means a concurrent call took either today's daily
  -- slot (returned below) or the picked question, which the next pick then excludes.
  for i in 1..3 loop
    v_question := null;
    if v_first then
      -- BE-58: never pick a first_day question the couple already has (the insert would be skipped).
      select q.id into v_question from public.questions q
       where q.active and q.special = 'first_day'
         and not exists (select 1 from public.couple_questions cq where cq.couple_id = v_couple and cq.question_id = q.id)
       order by q.sort_order, q.id limit 1;
    end if;

    if v_question is null then
      select q.id into v_question from public.questions q
       where q.active and q.daily_eligible and q.special is null
         and (cardinality(q.stages) = 0 or v_stage = any (q.stages))
         and (not q.is_premium or private.is_couple_premium(v_couple))
         and not exists (select 1 from public.couple_questions cq where cq.couple_id = v_couple and cq.question_id = q.id)
       order by q.sort_order, q.id
       limit 1;
    end if;
    if v_question is null then perform private.raise_error('LIBRARY_EXHAUSTED'); end if;

    insert into public.couple_questions (couple_id, question_id, source, assigned_for)
    values (v_couple, v_question, 'daily', v_today)
    on conflict do nothing;

    select * into v_row from public.couple_questions
     where couple_id = v_couple and source = 'daily' and assigned_for = v_today;
    if found then return v_row; end if;
  end loop;

  -- Three lost races in one call: report it as an error code, never as an all-null row.
  perform private.raise_error('LIBRARY_EXHAUSTED');
end $$;
revoke all on function private.get_daily_question_at(timestamptz) from public, anon, authenticated, service_role;
