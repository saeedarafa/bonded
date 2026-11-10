-- BE-38: who ended a couple, the former partner's first name, and Realtime on end (D08, D09; MOB-18).
--
-- couples.ended_by is the actor: the caller of unpair(), or the user whose account was deleted.
-- It deliberately has no foreign key: after an account deletion the auth/profile row is gone, but
-- the surviving partner still needs to know "my partner ended it" (and the actor's other phone,
-- after an unpair, needs "I ended it" so it can skip screen 58). It lives only as long as the
-- ended couple: the D08 purge deletes the row after 30 days. ended_reason tells the two apart.
-- Couples ended before this migration (and solo spaces archived on join, D04/D37) keep null:
-- the app treats null as "partner ended it", the previous behaviour.
--
-- Former partner's name: after an unpair both profiles still exist and private.can_read_profile()
-- already lets each former member read the other within the window. After an account deletion
-- the profile is gone, so the trigger keeps only the deleted user's FIRST name (<= 30 chars, the
-- same reduction as invite_preview/pending_join_requests) in a private table, not readable through
-- the API. public.ended_partner_name() returns it only to the remaining former member of that
-- ended couple within the 30-day window; the couple purge cascades it away.
--
-- Realtime: no publication change. couple_members is already in supabase_realtime (BE-20) and both
-- unpair() and the delete trigger UPDATE the remaining member's row (left_at). Its RLS policy
-- (private.can_read_couple: ended + left_at + 30 days) admits that row for the remaining member,
-- so their `couple:{id}` channel receives the change; the app refetches the couple as usual.

create type public.couple_end_reason as enum ('unpaired', 'deleted');

alter table public.couples
  add column ended_by     uuid,
  add column ended_reason public.couple_end_reason,
  add constraint couples_end_fields_only_when_ended
    check (status = 'ended' or (ended_by is null and ended_reason is null));
comment on column public.couples.ended_by is
  'BE-38: user who ended the couple (unpair caller or deleted account). No FK: survives the account deletion until the 30-day purge. Null = unknown (before BE-38, or a solo archive).';
comment on column public.couples.ended_reason is 'BE-38: unpaired | deleted; null when ended_by is null.';
-- The column-level UPDATE grant (stage, goals, partner_name, timezone, relationship_start_date)
-- is unchanged, so both new columns are server-owned.

create table private.ended_couple_names (
  couple_id  uuid primary key references public.couples(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 30)
);
alter table private.ended_couple_names enable row level security;
revoke all on private.ended_couple_names from public, anon, authenticated;

create or replace function public.unpair() returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid := private.my_couple_id();
  v_now timestamptz := now();
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;

  perform 1 from public.couples where id = v_couple and status = 'active' for update;
  if not found then perform private.raise_error('NOT_PAIRED'); end if;

  update public.couples
     set status = 'ended', ended_at = v_now, ended_by = auth.uid(), ended_reason = 'unpaired'
   where id = v_couple;
  update public.couple_members set left_at = v_now where couple_id = v_couple and left_at is null;
  update public.pair_invites set revoked_at = v_now
   where couple_id = v_couple and accepted_at is null and revoked_at is null;
end $$;
revoke all on function public.unpair() from public, anon;
grant execute on function public.unpair() to authenticated;

create or replace function private.archive_couple_before_profile_delete() returns trigger
language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid;
  v_now timestamptz := now();
  v_name text := nullif(left(split_part(btrim(old.display_name), ' ', 1), 30), '');
begin
  select c.id into v_couple
    from public.couple_members m
    join public.couples c on c.id = m.couple_id
   where m.user_id = old.id
     and m.left_at is null
     and c.status = 'active'
   for update of c;

  if found then
    update public.couples
       set status = 'ended', ended_at = v_now, ended_by = old.id, ended_reason = 'deleted'
     where id = v_couple;
    update public.couple_members set left_at = v_now
      where couple_id = v_couple and left_at is null;
    update public.pair_invites set revoked_at = v_now
      where couple_id = v_couple and accepted_at is null and revoked_at is null;
    if v_name is not null then
      insert into private.ended_couple_names (couple_id, first_name) values (v_couple, v_name)
      on conflict (couple_id) do update set first_name = excluded.first_name;
    end if;
  end if;

  return old;
end $$;

-- The other former member's first name for an ended couple the caller can still read (D08 window).
-- Null for an active, unknown, foreign, purged or solo couple, or when no name is known: never an
-- error, so it is no existence oracle. Never more than the first name.
create or replace function public.ended_partner_name(p_couple uuid) returns text
language plpgsql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_couple public.couples;
  v_name text;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;

  select * into v_couple from public.couples where id = p_couple and status = 'ended';
  if not found or not private.can_read_couple(p_couple) then return null; end if;

  select nullif(left(split_part(btrim(p.display_name), ' ', 1), 30), '') into v_name
    from public.couple_members m
    join public.profiles p on p.id = m.user_id
   where m.couple_id = p_couple and m.user_id <> v_uid
   limit 1;
  if v_name is not null then return v_name; end if;

  if v_couple.ended_reason = 'deleted' and v_couple.ended_by is distinct from v_uid then
    select n.first_name into v_name from private.ended_couple_names n where n.couple_id = p_couple;
  end if;
  return v_name;
end $$;
revoke all on function public.ended_partner_name(uuid) from public, anon;
grant execute on function public.ended_partner_name(uuid) to authenticated;
