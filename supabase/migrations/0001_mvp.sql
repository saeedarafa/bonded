-- Couples app MVP schema (Supabase / Postgres 15+)
-- Core loop: pair -> daily question -> both answer -> answers reveal -> discuss -> streak.
-- Security model: clients talk to Postgres directly through PostgREST; every rule lives in RLS
-- or in SECURITY DEFINER functions below. Service-role writes: entitlements (RevenueCat webhook).

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────────── Tables ─────────────────────────────

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default '',
  avatar_url    text,
  timezone      text not null default 'UTC',
  locale        text not null default 'en',
  reminder_time time,                       -- local time for the daily reminder push
  created_at    timestamptz not null default now()
);

create table public.couples (
  id                       uuid primary key default gen_random_uuid(),
  relationship_start_date  date,
  timezone                 text not null default 'UTC',  -- decides when "today's" question rolls over
  created_at               timestamptz not null default now()
);

create table public.couple_members (
  couple_id  uuid not null references public.couples(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (couple_id, user_id)
);
create unique index couple_members_one_couple_per_user on public.couple_members (user_id);

create table public.pair_invites (
  code         text primary key,
  inviter_id   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_by  uuid references public.profiles(id) on delete set null,
  accepted_at  timestamptz
);

create table public.questions (
  id              uuid primary key default gen_random_uuid(),
  body            text not null,
  category        text not null default 'general',
  depth           smallint not null default 1 check (depth between 1 and 3),
  is_premium      boolean not null default false,
  daily_eligible  boolean not null default true,
  sort_order      int not null default 0,
  locale          text not null default 'en',
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table public.question_packs (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  description  text not null default '',
  is_premium   boolean not null default true,
  sort_order   int not null default 0,
  active       boolean not null default true
);

create table public.pack_questions (
  pack_id      uuid not null references public.question_packs(id) on delete cascade,
  question_id  uuid not null references public.questions(id) on delete cascade,
  position     int not null,
  primary key (pack_id, question_id)
);

-- A question "instance" for one couple. Daily questions carry the local date they belong to.
create table public.couple_questions (
  id             uuid primary key default gen_random_uuid(),
  couple_id      uuid not null references public.couples(id) on delete cascade,
  question_id    uuid not null references public.questions(id),
  source         text not null check (source in ('daily', 'pack')),
  assigned_for   date,
  answer_count   smallint not null default 0,  -- public progress signal; lets the partner see "answered" without the text
  created_at     timestamptz not null default now(),
  check ((source = 'daily') = (assigned_for is not null))
);
create unique index couple_questions_one_daily_per_day
  on public.couple_questions (couple_id, assigned_for) where source = 'daily';
create unique index couple_questions_once_per_couple
  on public.couple_questions (couple_id, question_id);

create table public.answers (
  id                  uuid primary key default gen_random_uuid(),
  couple_question_id  uuid not null references public.couple_questions(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  body                text not null check (char_length(body) between 1 and 2000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (couple_question_id, user_id)        -- client upserts on this, so retries are idempotent
);

create table public.thread_messages (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null unique,   -- generated on device; makes resends idempotent
  couple_question_id  uuid not null references public.couple_questions(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  body                text not null check (char_length(body) between 1 and 2000),
  created_at          timestamptz not null default now(),
  edited_at           timestamptz
);
create index thread_messages_by_question on public.thread_messages (couple_question_id, created_at);

create table public.reactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  answer_id   uuid references public.answers(id) on delete cascade,
  message_id  uuid references public.thread_messages(id) on delete cascade,
  emoji       text not null check (char_length(emoji) <= 16),
  created_at  timestamptz not null default now(),
  check (num_nonnulls(answer_id, message_id) = 1)
);
create unique index reactions_one_per_answer  on public.reactions (answer_id, user_id)  where answer_id is not null;
create unique index reactions_one_per_message on public.reactions (message_id, user_id) where message_id is not null;

create table public.thread_reads (
  couple_question_id  uuid not null references public.couple_questions(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  last_read_at        timestamptz not null default now(),
  primary key (couple_question_id, user_id)
);

create table public.couple_streaks (
  couple_id          uuid primary key references public.couples(id) on delete cascade,
  current            int not null default 0,
  longest            int not null default 0,
  last_completed_on  date               -- client shows 0 when this is older than yesterday
);

-- Written only by the RevenueCat webhook (service role). One active row makes the whole couple premium.
create table public.entitlements (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  is_active   boolean not null default false,
  product_id  text,
  store       text,
  expires_at  timestamptz,
  updated_at  timestamptz not null default now()
);

create table public.push_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android')),
  updated_at  timestamptz not null default now()
);

-- ───────────────────────────── Helpers ─────────────────────────────
-- SECURITY DEFINER so policies can call them without recursing through RLS.

create or replace function public.my_couple_id() returns uuid
language sql stable security definer set search_path = public as $$
  select couple_id from couple_members where user_id = auth.uid()
$$;

create or replace function public.is_cq_member(p_cq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select couple_id from couple_questions where id = p_cq) = my_couple_id(), false)
$$;

create or replace function public.has_answered(p_cq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from answers where couple_question_id = p_cq and user_id = auth.uid())
$$;

create or replace function public.both_answered(p_cq uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from answers where couple_question_id = p_cq) >= 2
$$;

create or replace function public.answer_cq(p_answer uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select couple_question_id from answers where id = p_answer
$$;

create or replace function public.message_cq(p_message uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select couple_question_id from thread_messages where id = p_message
$$;

create or replace function public.is_couple_premium(p_couple uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from entitlements e join couple_members m on m.user_id = e.user_id
    where m.couple_id = p_couple and e.is_active and (e.expires_at is null or e.expires_at > now())
  )
$$;

-- ───────────────────────────── RPCs ─────────────────────────────

create or replace function public.create_invite() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 chars, no 0/O/1/I
  v_code text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if my_couple_id() is not null then raise exception 'already paired'; end if;
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

create or replace function public.accept_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_invite pair_invites;
  v_couple uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_invite from pair_invites where code = upper(trim(p_code)) for update;
  if not found or v_invite.accepted_at is not null or v_invite.expires_at < now() then
    raise exception 'invalid or expired code';
  end if;
  if v_invite.inviter_id = auth.uid() then raise exception 'cannot pair with yourself'; end if;
  if exists (select 1 from couple_members where user_id in (auth.uid(), v_invite.inviter_id)) then
    raise exception 'already paired';
  end if;

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
  if v_couple is null then raise exception 'not paired'; end if;
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
  if v_question is null then raise exception 'question library exhausted'; end if;

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
  v_couple uuid := my_couple_id();
  v_row    couple_questions;
begin
  if v_couple is null then raise exception 'not paired'; end if;
  if not exists (
    select 1 from pack_questions pq join question_packs p on p.id = pq.pack_id
    where pq.question_id = p_question and p.active and (not p.is_premium or is_couple_premium(v_couple))
  ) then
    raise exception 'premium required or question not in an available pack';
  end if;

  insert into couple_questions (couple_id, question_id, source)
  values (v_couple, p_question, 'pack')
  on conflict do nothing;

  select * into v_row from couple_questions where couple_id = v_couple and question_id = p_question;
  return v_row;
end $$;

create or replace function public.unpair() returns void
language plpgsql security definer set search_path = public as $$
declare v_couple uuid := my_couple_id();
begin
  if v_couple is null then return; end if;
  delete from couples where id = v_couple;  -- cascades members, questions, answers, threads, streak
end $$;

-- ───────────────────────────── Triggers ─────────────────────────────

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- After an answer lands: bump the public answer_count and, when both partners have
-- answered a daily question, advance the couple's streak.
create or replace function public.on_answer_inserted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cq     couple_questions;
  v_count  int;
  v_streak couple_streaks;
  v_next   int;
begin
  -- Row lock serialises the two partners' inserts so the count below sees both.
  select * into v_cq from couple_questions where id = new.couple_question_id for update;
  select count(*) into v_count from answers where couple_question_id = v_cq.id;
  update couple_questions set answer_count = v_count where id = v_cq.id;

  if v_cq.source <> 'daily' or v_count < 2 then return new; end if;

  select * into v_streak from couple_streaks where couple_id = v_cq.couple_id for update;
  if v_streak.last_completed_on is not null and v_cq.assigned_for <= v_streak.last_completed_on then
    return new;  -- already counted, or a late answer to an older day
  end if;
  v_next := case when v_streak.last_completed_on = v_cq.assigned_for - 1 then v_streak.current + 1 else 1 end;
  update couple_streaks
     set current = v_next, longest = greatest(longest, v_next), last_completed_on = v_cq.assigned_for
   where couple_id = v_cq.couple_id;
  return new;
end $$;

create trigger answers_after_insert
  after insert on public.answers for each row execute function public.on_answer_inserted();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger answers_touch before update on public.answers
  for each row execute function public.touch_updated_at();

-- ───────────────────────────── Row-level security ─────────────────────────────

alter table public.profiles         enable row level security;
alter table public.couples          enable row level security;
alter table public.couple_members   enable row level security;
alter table public.pair_invites     enable row level security;
alter table public.questions        enable row level security;
alter table public.question_packs   enable row level security;
alter table public.pack_questions   enable row level security;
alter table public.couple_questions enable row level security;
alter table public.answers          enable row level security;
alter table public.thread_messages  enable row level security;
alter table public.reactions        enable row level security;
alter table public.thread_reads     enable row level security;
alter table public.couple_streaks   enable row level security;
alter table public.entitlements     enable row level security;
alter table public.push_tokens      enable row level security;

create policy "read self and partner" on public.profiles for select to authenticated
  using (id = auth.uid() or id in (select user_id from public.couple_members where couple_id = public.my_couple_id()));
create policy "update self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "read own couple" on public.couples for select to authenticated
  using (id = public.my_couple_id());
create policy "update own couple" on public.couples for update to authenticated
  using (id = public.my_couple_id()) with check (id = public.my_couple_id());

create policy "read own couple members" on public.couple_members for select to authenticated
  using (couple_id = public.my_couple_id());

create policy "read own invites" on public.pair_invites for select to authenticated
  using (inviter_id = auth.uid());

create policy "read catalog" on public.questions for select to authenticated using (active);
create policy "read packs" on public.question_packs for select to authenticated using (active);
create policy "read pack items" on public.pack_questions for select to authenticated using (true);

create policy "read own couple questions" on public.couple_questions for select to authenticated
  using (couple_id = public.my_couple_id());

-- THE reveal rule: you always see your own answer; you see your partner's only after you have answered.
create policy "read own or revealed answers" on public.answers for select to authenticated
  using (
    user_id = auth.uid()
    or (public.is_cq_member(couple_question_id) and public.has_answered(couple_question_id))
  );
create policy "write own answer" on public.answers for insert to authenticated
  with check (user_id = auth.uid() and public.is_cq_member(couple_question_id));
create policy "edit own answer" on public.answers for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_cq_member(couple_question_id));

-- Threads open once both partners have answered.
create policy "read open threads" on public.thread_messages for select to authenticated
  using (public.is_cq_member(couple_question_id) and public.both_answered(couple_question_id));
create policy "post to open threads" on public.thread_messages for insert to authenticated
  with check (user_id = auth.uid() and public.is_cq_member(couple_question_id) and public.both_answered(couple_question_id));
create policy "edit own messages" on public.thread_messages for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "read reactions in own couple" on public.reactions for select to authenticated
  using (public.is_cq_member(coalesce(public.answer_cq(answer_id), public.message_cq(message_id)))
         and public.has_answered(coalesce(public.answer_cq(answer_id), public.message_cq(message_id))));
create policy "react in own couple" on public.reactions for insert to authenticated
  with check (user_id = auth.uid()
              and public.is_cq_member(coalesce(public.answer_cq(answer_id), public.message_cq(message_id)))
              and public.has_answered(coalesce(public.answer_cq(answer_id), public.message_cq(message_id))));
create policy "remove own reactions" on public.reactions for delete to authenticated
  using (user_id = auth.uid());

create policy "own read markers" on public.thread_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_cq_member(couple_question_id));

create policy "read own streak" on public.couple_streaks for select to authenticated
  using (couple_id = public.my_couple_id());

create policy "read couple entitlements" on public.entitlements for select to authenticated
  using (user_id = auth.uid() or user_id in (select user_id from public.couple_members where couple_id = public.my_couple_id()));

create policy "own push tokens" on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────────────────────── Realtime ─────────────────────────────
-- Postgres Changes respects RLS, so a locked answer never reaches the partner;
-- the couple_questions.answer_count update is what signals "partner answered".
alter publication supabase_realtime add table public.couple_questions, public.answers, public.thread_messages, public.reactions;
