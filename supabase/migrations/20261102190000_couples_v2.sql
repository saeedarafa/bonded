-- BE-03: couples v2 (D03, D10; CONTRACTS §2).
-- D03: a user creates a solo couple (1 member) at the end of onboarding with create_couple();
--      get_daily_question() works for it; joining = joining the inviter's couple.
-- D10: couples.stage, couples.goals, a partner name for the invite, and key_dates.
--      The joiner inherits stage, goals and dates because they join the same couple row.
-- Couple status (D08): `status` and `ended_at` columns, `couple_members.left_at`. unpair() still
-- deletes the couple; the ended state and the 30-day window arrive with BE-09.
-- Not here: D04 (a solo user accepting an invite; still ALREADY_PAIRED) and the BND code are BE-04.

-- ───────────────────────────── Types ─────────────────────────────
create type public.couple_stage as enum ('dating', 'living_together', 'engaged_married', 'long_distance');
create type public.couple_status as enum ('active', 'ended');
create type public.key_date_kind as enum ('together_since', 'anniversary', 'birthday');

-- ───────────────────────────── Couples ─────────────────────────────
alter table public.couples
  add column stage        public.couple_stage,
  add column goals        text[] not null default '{}' check (cardinality(goals) <= 12),
  add column partner_name text check (char_length(partner_name) between 1 and 40),
  add column status       public.couple_status not null default 'active',
  add column ended_at     timestamptz,
  add constraint couples_ended_at_matches_status check ((status = 'ended') = (ended_at is not null));
comment on column public.couples.partner_name is 'What the creator calls their partner (screen 07); pre-fills invite copy.';
comment on column public.couples.relationship_start_date is 'Deprecated: use key_dates kind together_since (D10).';

alter table public.couple_members add column left_at timestamptz;

-- Members may edit the settings only; status, ended_at and ids are server-owned.
-- Column-level grants replace the table-wide UPDATE that the default privileges gave.
revoke update on public.couples from anon, authenticated;
grant update (stage, goals, partner_name, timezone, relationship_start_date) on public.couples to authenticated;

-- ───────────────────────────── Invites point at the couple to join ─────────────────────────────
alter table public.pair_invites
  add column couple_id    uuid references public.couples(id) on delete cascade,
  add column partner_name text;
create index pair_invites_by_couple on public.pair_invites (couple_id);
-- Existing rows: the inviter's current couple, if any. An unused invite without one is dead.
update public.pair_invites i set couple_id = m.couple_id
  from public.couple_members m where m.user_id = i.inviter_id and i.couple_id is null;

-- ───────────────────────────── Key dates ─────────────────────────────
-- One together_since and one anniversary per couple; one birthday per member (user_id set).
-- NULLS NOT DISTINCT so the app can upsert with onConflict 'couple_id,kind,user_id'.
create table public.key_dates (
  id                  uuid primary key default gen_random_uuid(),
  couple_id           uuid not null references public.couples(id) on delete cascade,
  kind                public.key_date_kind not null,
  user_id             uuid references public.profiles(id) on delete cascade,
  date                date not null,
  remind_week_before  boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((kind = 'birthday') = (user_id is not null)),
  constraint key_dates_one_per_kind unique nulls not distinct (couple_id, kind, user_id)
);
create index key_dates_by_user on public.key_dates (user_id) where user_id is not null;
alter table public.key_dates enable row level security;

create trigger key_dates_touch before update on public.key_dates
  for each row execute function public.touch_updated_at();

-- Both members read and edit the couple's dates; a birthday only by its owner (the partner adds
-- their own, screen 47).
create policy "read own couple dates" on public.key_dates for select to authenticated
  using (couple_id = private.my_couple_id());
create policy "add own couple dates" on public.key_dates for insert to authenticated
  with check (couple_id = private.my_couple_id() and (user_id is null or user_id = auth.uid()));
create policy "edit own couple dates" on public.key_dates for update to authenticated
  using (couple_id = private.my_couple_id() and (user_id is null or user_id = auth.uid()))
  with check (couple_id = private.my_couple_id() and (user_id is null or user_id = auth.uid()));
create policy "remove own couple dates" on public.key_dates for delete to authenticated
  using (couple_id = private.my_couple_id() and (user_id is null or user_id = auth.uid()));
revoke all on public.key_dates from anon;

-- ───────────────────────────── RPCs ─────────────────────────────

-- D03: solo couple at the end of onboarding. Idempotent: a retry (or a second call while still
-- solo) updates the settings of the caller's solo couple and returns the same id.
-- ALREADY_PAIRED when the caller's couple already has two members.
create or replace function public.create_couple(
  p_stage public.couple_stage, p_goals text[] default '{}', p_partner_name text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_couple  uuid;
  v_goals   text[];
  v_partner text := nullif(left(btrim(coalesce(p_partner_name, '')), 40), '');
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  -- Blank and duplicate goals dropped, first 12 kept, order preserved.
  select coalesce(array_agg(g order by i), '{}') into v_goals from (
    select g, min(i) i from unnest(coalesce(p_goals, '{}')) with ordinality u(g, i)
     where btrim(g) <> '' group by g order by min(i) limit 12) x;

  v_couple := private.my_couple_id();
  if v_couple is not null then
    perform 1 from couples where id = v_couple for update;
    if (select count(*) from couple_members where couple_id = v_couple) >= 2 then
      perform private.raise_error('ALREADY_PAIRED');
    end if;
    update couples set stage = p_stage, goals = v_goals, partner_name = v_partner where id = v_couple;
    return v_couple;
  end if;

  insert into couples (timezone, stage, goals, partner_name)
    select timezone, p_stage, v_goals, v_partner from profiles where id = auth.uid()
    returning id into v_couple;
  insert into couple_members (couple_id, user_id) values (v_couple, auth.uid());
  insert into couple_streaks (couple_id) values (v_couple);
  return v_couple;
exception when unique_violation then
  -- A concurrent first call created the couple: same answer as a retry.
  v_couple := private.my_couple_id();
  if v_couple is null then raise; end if;
  return v_couple;
end $$;
revoke all on function public.create_couple(public.couple_stage, text[], text) from public, anon;
grant execute on function public.create_couple(public.couple_stage, text[], text) to authenticated;

-- CONTRACTS §2: NOT_PAIRED without a couple (create_couple first), COUPLE_FULL when it has two.
-- Still the 6-character code; BND + 4 digits, 48 h and one active invite are BE-04.
create or replace function public.create_invite() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 chars, no 0/O/1/I
  v_couple   uuid := private.my_couple_id();
  v_code     text;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  if (select count(*) from couple_members where couple_id = v_couple) >= 2 then
    perform private.raise_error('COUPLE_FULL');
  end if;
  loop
    select string_agg(substr(v_alphabet, 1 + get_byte(gen_random_bytes(1), 0) % 32, 1), '')
      into v_code from generate_series(1, 6);
    begin
      insert into pair_invites (code, inviter_id, couple_id, partner_name)
        select v_code, auth.uid(), v_couple, partner_name from couples where id = v_couple;
      return v_code;
    exception when unique_violation then
      -- code collision: try another
    end;
  end loop;
end $$;

-- D03: the joiner joins the inviter's couple and so inherits its stage, goals, dates and timezone.
-- Order: ALREADY_PAIRED (caller in a full couple), INVALID_CODE, OWN_CODE (a solo inviter typing
-- their own code), ALREADY_PAIRED (caller has a solo couple; D04 lifts this in BE-04), COUPLE_FULL,
-- INVITE_EXPIRED. The couple row is locked so two joiners can't both get in.
create or replace function public.accept_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_invite pair_invites;
  v_couple couples;
  v_mine   uuid := private.my_couple_id();
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_mine is not null and (select count(*) from couple_members where couple_id = v_mine) >= 2 then
    perform private.raise_error('ALREADY_PAIRED');
  end if;
  select * into v_invite from pair_invites where code = upper(trim(p_code)) for update;
  if not found or v_invite.couple_id is null then perform private.raise_error('INVALID_CODE'); end if;
  if v_invite.inviter_id = auth.uid() then perform private.raise_error('OWN_CODE'); end if;
  if v_mine is not null then perform private.raise_error('ALREADY_PAIRED'); end if;
  select * into v_couple from couples where id = v_invite.couple_id for update;
  if v_invite.accepted_at is not null
     or v_couple.status <> 'active'
     or (select count(*) from couple_members where couple_id = v_couple.id) >= 2 then
    perform private.raise_error('COUPLE_FULL');
  end if;
  if v_invite.expires_at <= now() then perform private.raise_error('INVITE_EXPIRED'); end if;

  insert into couple_members (couple_id, user_id) values (v_couple.id, auth.uid());
  update pair_invites set accepted_by = auth.uid(), accepted_at = now() where code = v_invite.code;
  return v_couple.id;
end $$;
