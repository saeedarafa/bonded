-- BE-02: error codes (D05, D16, D18; CONTRACTS §2).
-- Every RPC raises exactly one code from public.error_code as the exception message
-- (`error.message === 'COUPLE_FULL'` in supabase-js), through private.raise_error().
-- Codes for RPCs that don't exist yet (RATE_LIMITED: BE-04, NUDGE_LIMIT and
-- PARTNER_ALREADY_ANSWERED: BE-10, SAVER_UNAVAILABLE: BE-11) are catalogued here for reuse.
-- A new code later: `alter type public.error_code add value 'X';` in a new migration, plus CONTRACTS §2.

-- ───────────────────────────── Code catalogue ─────────────────────────────
-- An enum, so the generated types expose the full list (Database['public']['Enums']['error_code'])
-- and a typo in a raise fails instead of shipping an unknown code.
create type public.error_code as enum (
  'NOT_AUTHENTICATED',
  'NOT_PAIRED',
  'ALREADY_PAIRED',
  'INVALID_CODE',
  'INVITE_EXPIRED',
  'COUPLE_FULL',
  'OWN_CODE',
  'RATE_LIMITED',
  'LIBRARY_EXHAUSTED',
  'PREMIUM_REQUIRED',
  'SAVER_UNAVAILABLE',
  'PARTNER_ALREADY_ANSWERED',
  'NUDGE_LIMIT',
  'QUESTION_UNAVAILABLE'
);

-- Internal helpers live in `private`, which the API doesn't expose (config.toml api.schemas).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- The message is the code and nothing else: no ids, names or answer text.
create or replace function private.raise_error(p_code public.error_code) returns void
language plpgsql volatile as $$
begin
  raise exception using message = p_code::text, errcode = 'P0001';
end $$;
revoke all on function private.raise_error(public.error_code) from public, anon, authenticated;

-- ───────────────────────────── RPCs (same signatures as 0001) ─────────────────────────────

-- Current model (until BE-03/BE-04): an unpaired user creates an invite; anyone already in a
-- couple gets COUPLE_FULL (every couple has two members). NOT_PAIRED arrives with solo couples.
create or replace function public.create_invite() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 chars, no 0/O/1/I
  v_code text;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if my_couple_id() is not null then perform private.raise_error('COUPLE_FULL'); end if;
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

-- Order of checks: who you are, then whether the code exists, then its state.
-- A used invite, or an inviter who is already in a couple, means the couple is full (J10).
-- RATE_LIMITED (D02: failed typed attempts; a valid link token skips it) is added in BE-04.
create or replace function public.accept_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_invite pair_invites;
  v_couple uuid;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if exists (select 1 from couple_members where user_id = auth.uid()) then
    perform private.raise_error('ALREADY_PAIRED');
  end if;
  select * into v_invite from pair_invites where code = upper(trim(p_code)) for update;
  if not found then perform private.raise_error('INVALID_CODE'); end if;
  if v_invite.inviter_id = auth.uid() then perform private.raise_error('OWN_CODE'); end if;
  if v_invite.accepted_at is not null
     or exists (select 1 from couple_members where user_id = v_invite.inviter_id) then
    perform private.raise_error('COUPLE_FULL');
  end if;
  if v_invite.expires_at <= now() then perform private.raise_error('INVITE_EXPIRED'); end if;

  insert into couples (timezone)
    select timezone from profiles where id = v_invite.inviter_id
    returning id into v_couple;
  insert into couple_members (couple_id, user_id) values (v_couple, v_invite.inviter_id), (v_couple, auth.uid());
  insert into couple_streaks (couple_id) values (v_couple);
  update pair_invites set accepted_by = auth.uid(), accepted_at = now() where code = v_invite.code;
  return v_couple;
end $$;

-- Returns today's question for the caller's couple, assigning one on first call of the day.
-- Safe when both partners open the app at the same moment (unique index + ON CONFLICT).
create or replace function public.get_daily_question() returns public.couple_questions
language plpgsql security definer set search_path = public as $$
declare
  v_couple   uuid := my_couple_id();
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
     and (not q.is_premium or is_couple_premium(v_couple))
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

-- QUESTION_UNAVAILABLE: the question is in no active pack. PREMIUM_REQUIRED: it is only in
-- premium packs and neither partner is premium.
create or replace function public.start_pack_question(p_question uuid) returns public.couple_questions
language plpgsql security definer set search_path = public as $$
declare
  v_couple uuid := my_couple_id();
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
    where pq.question_id = p_question and p.active and (not p.is_premium or is_couple_premium(v_couple))
  ) then
    perform private.raise_error('PREMIUM_REQUIRED');
  end if;

  insert into couple_questions (couple_id, question_id, source)
  values (v_couple, p_question, 'pack')
  on conflict do nothing;

  select * into v_row from couple_questions where couple_id = v_couple and question_id = p_question;
  return v_row;
end $$;

-- NOT_PAIRED per CONTRACTS §2 (0001 returned silently). A retry after success gets NOT_PAIRED,
-- which the app treats as "already unpaired".
create or replace function public.unpair() returns void
language plpgsql security definer set search_path = public as $$
declare v_couple uuid := my_couple_id();
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  delete from couples where id = v_couple;  -- cascades members, questions, answers, threads, streak
end $$;

-- ───────────────────────────── Grants ─────────────────────────────
-- Signed-in users only; anon gets "permission denied" (42501) before the function runs.
revoke all on function public.create_invite() from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.get_daily_question() from public, anon;
revoke all on function public.start_pack_question(uuid) from public, anon;
revoke all on function public.unpair() from public, anon;
grant execute on function public.create_invite() to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.get_daily_question() to authenticated;
grant execute on function public.start_pack_question(uuid) to authenticated;
grant execute on function public.unpair() to authenticated;
