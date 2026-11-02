-- BE-09: ended couples (D08, D09; CONTRACTS §2).
--
-- An unpair ends rather than deletes a couple. Both former members retain a read-only archive
-- for 30 days; an active membership remains unique so either person can pair again immediately.

-- Only active memberships drive the product's normal RPCs.  A separate read helper below keeps
-- an ended archive from becoming writable (in particular through answer/message upserts).
create or replace function private.my_couple_id() returns uuid
language sql stable security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
  select m.couple_id
    from public.couple_members m
    join public.couples c on c.id = m.couple_id
   where m.user_id = auth.uid()
     and m.left_at is null
     and c.status = 'active'
   limit 1
$$;

create or replace function private.can_read_couple(p_couple uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
  select exists (
    select 1
      from public.couple_members m
      join public.couples c on c.id = m.couple_id
     where m.couple_id = p_couple
       and m.user_id = auth.uid()
       and (
         (c.status = 'active' and m.left_at is null)
         or (c.status = 'ended' and m.left_at is not null and c.ended_at >= now() - interval '30 days')
       )
  )
$$;

create or replace function private.is_cq_member(p_cq uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
  select coalesce((select private.can_read_couple(couple_id) from public.couple_questions where id = p_cq), false)
$$;

create or replace function private.is_active_cq_member(p_cq uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
  select coalesce((select couple_id = private.my_couple_id() from public.couple_questions where id = p_cq), false)
$$;

create or replace function private.can_read_profile(p_profile uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
  select p_profile = auth.uid() or exists (
    select 1
      from public.couple_members mine
      join public.couple_members member on member.couple_id = mine.couple_id
     where mine.user_id = auth.uid()
       and member.user_id = p_profile
       and private.can_read_couple(mine.couple_id)
  )
$$;

revoke all on function private.can_read_couple(uuid), private.is_active_cq_member(uuid), private.can_read_profile(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_couple(uuid), private.is_active_cq_member(uuid), private.can_read_profile(uuid)
  to authenticated, service_role;

-- A former member no longer blocks a new active pairing.
drop index public.couple_members_one_couple_per_user;
create unique index couple_members_one_active_couple_per_user
  on public.couple_members (user_id) where left_at is null;

-- ───────────────────────────── Read-only ended archive ─────────────────────────────

drop policy "read self and partner" on public.profiles;
create policy "read self and recent partner" on public.profiles for select to authenticated
  using (private.can_read_profile(id));

drop policy "read own couple" on public.couples;
create policy "read active or recent ended couple" on public.couples for select to authenticated
  using (private.can_read_couple(id));

drop policy "read own couple members" on public.couple_members;
create policy "read active or recent ended members" on public.couple_members for select to authenticated
  using (private.can_read_couple(couple_id));

drop policy "read own couple dates" on public.key_dates;
create policy "read active or recent ended couple dates" on public.key_dates for select to authenticated
  using (private.can_read_couple(couple_id));

drop policy "read own couple questions" on public.couple_questions;
create policy "read active or recent ended couple questions" on public.couple_questions for select to authenticated
  using (private.can_read_couple(couple_id));

drop policy "read own or revealed answers" on public.answers;
create policy "read own or revealed answers in accessible couple" on public.answers for select to authenticated
  using (private.is_cq_member(couple_question_id)
         and (user_id = auth.uid() or private.has_answered(couple_question_id)));

drop policy "read open threads" on public.thread_messages;
create policy "read open threads in accessible couple" on public.thread_messages for select to authenticated
  using (private.is_cq_member(couple_question_id) and private.both_answered(couple_question_id));

drop policy "read reactions in own couple" on public.reactions;
create policy "read reactions in accessible couple" on public.reactions for select to authenticated
  using (private.is_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
         and private.has_answered(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))));

drop policy "read own streak" on public.couple_streaks;
create policy "read active or recent ended streak" on public.couple_streaks for select to authenticated
  using (private.can_read_couple(couple_id));

drop policy "read couple entitlements" on public.entitlements;
create policy "read self or recent partner entitlements" on public.entitlements for select to authenticated
  using (private.can_read_profile(user_id));

-- ───────────────────────────── Archive is never writable ─────────────────────────────

drop policy "write own answer" on public.answers;
create policy "write own answer in active couple" on public.answers for insert to authenticated
  with check (user_id = auth.uid() and private.is_active_cq_member(couple_question_id));
drop policy "edit own answer" on public.answers;
create policy "edit own answer in active couple" on public.answers for update to authenticated
  using (user_id = auth.uid() and private.is_active_cq_member(couple_question_id))
  with check (user_id = auth.uid() and private.is_active_cq_member(couple_question_id));

drop policy "post to open threads" on public.thread_messages;
create policy "post to open threads in active couple" on public.thread_messages for insert to authenticated
  with check (user_id = auth.uid() and private.is_active_cq_member(couple_question_id) and private.both_answered(couple_question_id));
drop policy "edit own messages" on public.thread_messages;
create policy "edit own messages in active couple" on public.thread_messages for update to authenticated
  using (user_id = auth.uid() and private.is_active_cq_member(couple_question_id))
  with check (user_id = auth.uid() and private.is_active_cq_member(couple_question_id));

drop policy "react in own couple" on public.reactions;
create policy "react in active couple" on public.reactions for insert to authenticated
  with check (user_id = auth.uid()
              and private.is_active_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.has_answered(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))));
drop policy "change own reactions" on public.reactions;
create policy "change own reactions in active couple" on public.reactions for update to authenticated
  using (user_id = auth.uid()
         and private.is_active_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))))
  with check (user_id = auth.uid()
              and private.is_active_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.has_answered(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))));
drop policy "remove own reactions" on public.reactions;
create policy "remove own reactions in active couple" on public.reactions for delete to authenticated
  using (user_id = auth.uid()
         and private.is_active_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))));

drop policy "own read markers" on public.thread_reads;
create policy "read own markers in accessible couple" on public.thread_reads for select to authenticated
  using (user_id = auth.uid() and private.is_cq_member(couple_question_id));
create policy "write own markers in active couple" on public.thread_reads for insert to authenticated
  with check (user_id = auth.uid() and private.is_active_cq_member(couple_question_id));
create policy "edit own markers in active couple" on public.thread_reads for update to authenticated
  using (user_id = auth.uid() and private.is_active_cq_member(couple_question_id))
  with check (user_id = auth.uid() and private.is_active_cq_member(couple_question_id));
create policy "remove own markers in active couple" on public.thread_reads for delete to authenticated
  using (user_id = auth.uid() and private.is_active_cq_member(couple_question_id));

-- ───────────────────────────── End and purge ─────────────────────────────

create or replace function public.unpair() returns void
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  v_couple uuid := private.my_couple_id();
  v_now timestamptz := now();
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;

  perform 1 from public.couples where id = v_couple and status = 'active' for update;
  if not found then perform private.raise_error('NOT_PAIRED'); end if;

  update public.couples set status = 'ended', ended_at = v_now where id = v_couple;
  update public.couple_members set left_at = v_now where couple_id = v_couple and left_at is null;
  update public.pair_invites set revoked_at = v_now
   where couple_id = v_couple and accepted_at is null and revoked_at is null;
end $$;

create or replace function private.purge_ended_couples(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare v_deleted integer;
begin
  delete from public.couples
   where status = 'ended'
     and ended_at < p_now - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;
revoke all on function private.purge_ended_couples(timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.purge_ended_couples(timestamptz) to service_role;

-- Supabase exposes pg_cron on hosted projects. The extension is absent in PGlite and some local
-- installations, so keep migration and local tests portable while scheduling the hosted cleanup.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema extensions;
    if not exists (select 1 from cron.job where jobname = 'purge-ended-couples-daily') then
      perform cron.schedule('purge-ended-couples-daily', '17 3 * * *', 'select private.purge_ended_couples()');
    end if;
  end if;
end $$;
