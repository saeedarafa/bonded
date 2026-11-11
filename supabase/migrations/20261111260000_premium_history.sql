-- BE-55 (D55, PO 2026-11-11; CONTRACTS §2): History is Premium beyond yesterday.
--
-- For a reader whose couple is not Premium, the CONTENT of a couple question older than yesterday
-- (couple-local day) is never returned: both partners' answers (text and voice), the thread
-- messages, the reactions and the voice objects of that day. The day itself stays listable:
-- `couple_questions` (question, date, answer_count) is unchanged, and the new `history_days` RPC
-- returns who answered, the thread's message count and a `locked` flag per day.
--
--   * A day = `couple_questions.assigned_for` (daily), or the couple-local date of `created_at`
--     for a pack question (no assigned_for; "counts on the day it was started"). "Today" = now in
--     `couples.timezone` (the same boundary as `get_daily_question`). Open = day >= yesterday.
--   * Premium (D29): active couple → `private.is_couple_premium(couple)` at read time; ended couple
--     (30-day archive, D08) → the READER's own active, unexpired entitlement. Lapse relocks at once;
--     nothing is deleted (the rows and objects stay; Premium again unlocks them).
--   * The reveal rule (D13) still applies on top: the open check is an extra AND on every policy.
--   * Writes into a locked day by a member of the couple raise `PREMIUM_REQUIRED` (answers, thread
--     messages, reactions; insert and the INSERT half of an upsert). Locked rows are also outside
--     the UPDATE/DELETE policies, so a plain update/delete of one matches nothing (0 rows).
--   * Storage `voice`: the owner's blanket read is narrowed to objects no row references (a take not
--     yet attached); attached objects are read only through a row the caller can read, so a locked
--     day's voice is unreadable for its owner too.
--   * Realtime `postgres_changes` checks the subscriber's SELECT policies per event, so locked rows
--     are not delivered (DELETE events carry only the primary key).

-- ───────────────────────────── Helpers ─────────────────────────────

-- The couple-local day a couple question belongs to.
create or replace function private.cq_day(p_assigned date, p_created timestamptz, p_tz text)
returns date
language sql immutable set search_path = pg_catalog as $$
  select coalesce(p_assigned, (p_created at time zone p_tz)::date)
$$;
revoke all on function private.cq_day(date, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function private.cq_day(date, timestamptz, text) to authenticated, service_role;

-- Whether the reader (auth.uid()) may see the content of couple question p_cq at p_now.
-- SECURITY DEFINER: reads couples and entitlements, which the caller may not see; returns a boolean.
create or replace function private.cq_content_open_at(p_cq uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select coalesce((
    select private.cq_day(cq.assigned_for, cq.created_at, c.timezone)
             >= (p_now at time zone c.timezone)::date - 1
        or case when c.status = 'active' then private.is_couple_premium(c.id)
                else exists (select 1 from public.entitlements e
                              where e.user_id = auth.uid() and e.is_active
                                and (e.expires_at is null or e.expires_at > p_now))
           end
      from public.couple_questions cq join public.couples c on c.id = cq.couple_id
     where cq.id = p_cq), false)
$$;
revoke all on function private.cq_content_open_at(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.cq_content_open_at(uuid, timestamptz) to authenticated, service_role;

-- The RLS form (the database clock).
create or replace function private.cq_content_open(p_cq uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.cq_content_open_at(p_cq, now())
$$;
revoke all on function private.cq_content_open(uuid) from public, anon, authenticated, service_role;
grant execute on function private.cq_content_open(uuid) to authenticated, service_role;

-- Whether any answer or message points at a voice object. Unlike voice_object_referenced (used by
-- the delete paths) it takes no lock, so it can sit in a SELECT policy.
create or replace function private.voice_object_attached(p_name text) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select exists (select 1 from public.answers where voice_path = p_name)
      or exists (select 1 from public.thread_messages where voice_path = p_name)
$$;
revoke all on function private.voice_object_attached(text) from public, anon, authenticated, service_role;
grant execute on function private.voice_object_attached(text) to authenticated, service_role;

-- ───────────────────────────── Read policies ─────────────────────────────

alter policy "read own or revealed answers in accessible couple" on public.answers
  using (
    private.is_cq_member(couple_question_id)
    and (user_id = auth.uid()
         or (private.has_answered(couple_question_id) and private.cq_in_pair_period(couple_question_id)))
    and private.cq_content_open(couple_question_id)
  );

alter policy "read open threads in accessible couple" on public.thread_messages
  using (
    private.is_cq_member(couple_question_id)
    and private.cq_in_pair_period(couple_question_id)
    and private.both_answered(couple_question_id)
    and private.cq_content_open(couple_question_id)
  );

alter policy "read reactions in accessible couple" on public.reactions
  using (
    private.is_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
    and private.cq_in_pair_period(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
    and private.has_answered(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
    and private.cq_content_open(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
  );

-- ───────────────────────────── Update / delete policies ─────────────────────────────
-- Locked rows are outside every change policy (also an update/delete without a filter).

alter policy "edit own answer in active couple" on public.answers
  using (
    user_id = auth.uid() and private.is_active_cq_member(couple_question_id)
    and private.cq_in_pair_period(couple_question_id) and private.cq_content_open(couple_question_id)
  );

alter policy "edit own messages in active couple" on public.thread_messages
  using (
    user_id = auth.uid() and private.is_active_cq_member(couple_question_id)
    and private.cq_in_pair_period(couple_question_id) and private.cq_content_open(couple_question_id)
  );

alter policy "change own reactions in active couple" on public.reactions
  using (
    user_id = auth.uid()
    and private.is_active_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
    and private.cq_in_pair_period(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
    and private.cq_content_open(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
  );

alter policy "remove own reactions in active couple" on public.reactions
  using (
    user_id = auth.uid()
    and private.is_active_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
    and private.cq_in_pair_period(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
    and private.cq_content_open(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
  );

-- ───────────────────────────── Writes into a locked day → PREMIUM_REQUIRED ─────────────────────────────
-- BEFORE INSERT/UPDATE; the trigger names sort before the existing validators, so the code comes
-- first. It acts only on direct client writes: the session role (the `role` setting, which
-- PostgREST sets per request and SECURITY DEFINER does not change) is `authenticated`; server code
-- (service_role, postgres, cron, seeds) is not affected. No RPC writes these tables for a client.
-- Only the writer's own row in their active couple, on a question of the pair period (D37): anything
-- else (another couple, a foreign user_id, an ended couple, a solo-era question) is left to RLS, so
-- the error cannot reveal another couple's dates or Premium state.
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
    raise exception using message = 'PREMIUM_REQUIRED', errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.history_write_guard() from public, anon, authenticated, service_role;

create trigger answers_history_lock before insert or update on public.answers
  for each row execute function private.history_write_guard();
create trigger thread_messages_history_lock before insert or update on public.thread_messages
  for each row execute function private.history_write_guard();
create trigger reactions_history_lock before insert or update on public.reactions
  for each row execute function private.history_write_guard();

-- ───────────────────────────── Storage `voice` read ─────────────────────────────

alter policy "voice read by owner or through a readable row" on storage.objects
  using (
    bucket_id = 'voice'
    and (
      ((storage.foldername(storage.objects.name))[2] = auth.uid()::text
        and not private.voice_object_attached(storage.objects.name))
      or exists (select 1 from public.answers a where a.voice_path = storage.objects.name)
      or exists (select 1 from public.thread_messages m where m.voice_path = storage.objects.name)
    )
  );

-- ───────────────────────────── History list ─────────────────────────────

-- One row per couple question of a couple the caller can read (active couple, or an ended couple
-- within its 30-day archive), newest first. Never returns answer or message content: only who
-- answered, the message count and whether the content is locked for the caller.
create or replace function private.history_days_at(
  p_couple_id uuid, p_limit integer, p_offset integer, p_couple_question_id uuid, p_now timestamptz)
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
     order by cq.created_at desc, cq.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 100)
     offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function private.history_days_at(uuid, integer, integer, uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.history_days(
  p_couple_id uuid default null, p_limit integer default 30, p_offset integer default 0,
  p_couple_question_id uuid default null)
returns table (
  couple_question_id uuid, couple_id uuid, question_id uuid, question jsonb, source text, day date,
  created_at timestamptz, my_answered boolean, partner_answered boolean, message_count integer,
  locked boolean)
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select * from private.history_days_at(p_couple_id, p_limit, p_offset, p_couple_question_id, now())
$$;
revoke all on function public.history_days(uuid, integer, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.history_days(uuid, integer, integer, uuid) to authenticated;
