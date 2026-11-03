-- BE-16: account deletion (D09).
--
-- Auth admin deletion cascades through public.profiles. Archive an active couple before that
-- cascade removes the deleted user's membership, so the surviving partner keeps the required
-- 30-day read-only history.

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
    update public.couples set status = 'ended', ended_at = v_now where id = v_couple;
    update public.couple_members set left_at = v_now
      where couple_id = v_couple and left_at is null;
    update public.pair_invites set revoked_at = v_now
      where couple_id = v_couple and accepted_at is null and revoked_at is null;
  end if;

  return old;
end $$;

drop trigger if exists archive_couple_before_profile_delete on public.profiles;
create trigger archive_couple_before_profile_delete
  before delete on public.profiles
  for each row execute function private.archive_couple_before_profile_delete();
