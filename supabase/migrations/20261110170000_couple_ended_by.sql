-- BE-38: who ended a couple, the former partner's first name, and Realtime on end (D08, D09; MOB-18).
--
-- couples.ended_by is the caller of unpair(), so the actor's other phone knows "I ended it" and
-- can skip screen 58. ended_reason says how the couple ended: 'unpaired' or 'deleted'.
-- D09 ("yours disappear", lead 2026-11-10): nothing of a deleted user is kept. An account deletion
-- sets ended_reason = 'deleted' and ended_by = null (no uuid, no name); the app shows "Your partner".
-- ended_by has no foreign key; if the unpair caller later deletes their account, the trigger sets
-- ended_by back to null (ended_reason stays 'unpaired'), so no uuid of a deleted user remains.
-- Couples ended before this migration (and solo spaces archived on join, D04/D37) keep null in
-- both columns: the app treats that as "partner ended it", the previous behaviour.
--
-- Former partner's name: after an unpair both profiles still exist and private.can_read_profile()
-- already lets each former member read the other within the window. No new exposure.
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
    check (status = 'ended' or (ended_by is null and ended_reason is null)),
  add constraint couples_deleted_keeps_no_actor
    check (ended_reason is distinct from 'deleted' or ended_by is null);
comment on column public.couples.ended_by is
  'BE-38: the unpair caller. Null after an account deletion (D09: nothing of the deleted user is kept), before BE-38, or for a solo archive. No FK; cleared if that user later deletes their account.';
comment on column public.couples.ended_reason is 'BE-38: unpaired | deleted; null on active couples, before BE-38, or for a solo archive.';
-- The delete trigger clears a deleted user's uuid from earlier unpairs (D09).
create index couples_ended_by on public.couples (ended_by) where ended_by is not null;
-- The column-level UPDATE grant (stage, goals, partner_name, timezone, relationship_start_date)
-- is unchanged, so both new columns are server-owned.

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
       set status = 'ended', ended_at = v_now, ended_by = null, ended_reason = 'deleted'
     where id = v_couple;
    update public.couple_members set left_at = v_now
      where couple_id = v_couple and left_at is null;
    update public.pair_invites set revoked_at = v_now
      where couple_id = v_couple and accepted_at is null and revoked_at is null;
  end if;

  -- D09: an earlier unpair by this user keeps no trace of them in the partner's archive.
  update public.couples set ended_by = null where ended_by = old.id;

  return old;
end $$;
