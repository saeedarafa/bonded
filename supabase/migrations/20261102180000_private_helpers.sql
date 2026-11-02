-- BE-24: take the 0001 SECURITY DEFINER helpers out of the exposed API.
-- In `public` they were callable as RPCs by anon and by any signed-in user
-- (`is_couple_premium(any couple id)`, `answer_cq(any answer id)` leaked facts across couples).
-- They move to `private`, which PostgREST doesn't expose (config.toml api.schemas) and on which
-- anon/authenticated have no USAGE, so nobody can name them from a client.
--
-- RLS policies keep working: a policy stores the function's OID, not its name, so
-- `alter function … set schema` leaves every policy pointing at the same function. Policies run
-- as the caller, so `authenticated` keeps EXECUTE (it needs no schema USAGE to run a function a
-- policy already resolved). anon has no policy that calls them and loses EXECUTE.
--
-- The bodies are re-created with schema-qualified names, because a moved SQL function still
-- resolves `my_couple_id()` through its own search_path (= public) at run time. The RPCs that
-- call the helpers are re-created for the same reason (same signatures, same codes as BE-02).

alter function public.my_couple_id()            set schema private;
alter function public.is_cq_member(uuid)        set schema private;
alter function public.has_answered(uuid)        set schema private;
alter function public.both_answered(uuid)       set schema private;
alter function public.answer_cq(uuid)           set schema private;
alter function public.message_cq(uuid)          set schema private;
alter function public.is_couple_premium(uuid)   set schema private;

-- ───────────────────────────── Helpers (same behaviour, qualified names) ─────────────────────────────

create or replace function private.my_couple_id() returns uuid
language sql stable security definer set search_path = public as $$
  select couple_id from public.couple_members where user_id = auth.uid()
$$;

create or replace function private.is_cq_member(p_cq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select couple_id from public.couple_questions where id = p_cq) = private.my_couple_id(), false)
$$;

create or replace function private.has_answered(p_cq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.answers where couple_question_id = p_cq and user_id = auth.uid())
$$;

create or replace function private.both_answered(p_cq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.answers where couple_question_id = p_cq) >= 2
$$;

create or replace function private.answer_cq(p_answer uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select couple_question_id from public.answers where id = p_answer
$$;

create or replace function private.message_cq(p_message uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select couple_question_id from public.thread_messages where id = p_message
$$;

create or replace function private.is_couple_premium(p_couple uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entitlements e join public.couple_members m on m.user_id = e.user_id
    where m.couple_id = p_couple and e.is_active and (e.expires_at is null or e.expires_at > now())
  )
$$;

-- Grants: policies (authenticated) and server code (service_role) only. The moved functions kept
-- the public-schema default grants (anon included), so revoke them explicitly.
do $$
declare f text;
begin
  foreach f in array array[
    'private.my_couple_id()', 'private.is_cq_member(uuid)', 'private.has_answered(uuid)',
    'private.both_answered(uuid)', 'private.answer_cq(uuid)', 'private.message_cq(uuid)',
    'private.is_couple_premium(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ───────────────────────────── RPCs that call the helpers ─────────────────────────────

create or replace function public.create_invite() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 chars, no 0/O/1/I
  v_code text;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if private.my_couple_id() is not null then perform private.raise_error('COUPLE_FULL'); end if;
  loop
    select string_agg(substr(v_alphabet, 1 + get_byte(gen_random_bytes(1), 0) % 32, 1), '')
      into v_code from generate_series(1, 6);
    begin
      insert into pair_invites (code, inviter_id) values (v_code, auth.uid());
      return v_code;
    exception when unique_violation then
      -- code collision: try another
    end;
  end loop;
end $$;

create or replace function public.get_daily_question() returns public.couple_questions
language plpgsql security definer set search_path = public as $$
declare
  v_couple   uuid := private.my_couple_id();
  v_today    date;
  v_question uuid;
  v_row      couple_questions;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  select (now() at time zone timezone)::date into v_today from couples where id = v_couple;

  select * into v_row from couple_questions
   where couple_id = v_couple and source = 'daily' and assigned_for = v_today;
  if found then return v_row; end if;

  select q.id into v_question from questions q
   where q.active and q.daily_eligible
     and (not q.is_premium or private.is_couple_premium(v_couple))
     and not exists (select 1 from couple_questions cq where cq.couple_id = v_couple and cq.question_id = q.id)
   order by q.sort_order, q.id
   limit 1;
  if v_question is null then perform private.raise_error('LIBRARY_EXHAUSTED'); end if;

  insert into couple_questions (couple_id, question_id, source, assigned_for)
  values (v_couple, v_question, 'daily', v_today)
  on conflict do nothing;

  select * into v_row from couple_questions
   where couple_id = v_couple and source = 'daily' and assigned_for = v_today;
  return v_row;
end $$;

create or replace function public.start_pack_question(p_question uuid) returns public.couple_questions
language plpgsql security definer set search_path = public as $$
declare
  v_couple uuid := private.my_couple_id();
  v_row    couple_questions;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  if not exists (
    select 1 from pack_questions pq join question_packs p on p.id = pq.pack_id
    where pq.question_id = p_question and p.active
  ) then
    perform private.raise_error('QUESTION_UNAVAILABLE');
  end if;
  if not exists (
    select 1 from pack_questions pq join question_packs p on p.id = pq.pack_id
    where pq.question_id = p_question and p.active and (not p.is_premium or private.is_couple_premium(v_couple))
  ) then
    perform private.raise_error('PREMIUM_REQUIRED');
  end if;

  insert into couple_questions (couple_id, question_id, source)
  values (v_couple, p_question, 'pack')
  on conflict do nothing;

  select * into v_row from couple_questions where couple_id = v_couple and question_id = p_question;
  return v_row;
end $$;

create or replace function public.unpair() returns void
language plpgsql security definer set search_path = public as $$
declare v_couple uuid := private.my_couple_id();
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  delete from couples where id = v_couple;  -- cascades members, questions, answers, threads, streak
end $$;
