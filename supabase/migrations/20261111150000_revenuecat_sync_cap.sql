-- BE-48b (SEC-10 optional Low hardening on #156): a global per-minute cap on `revenuecat-sync`
-- lookups, so many accounts calling at once can't exhaust the shared RevenueCat REST API quota
-- that the webhook also needs. The per-user 30 s limit is unchanged and checked first, so a
-- caller refused by its own limit never uses a global slot; a global refusal leaves the caller's
-- 30 s slot untouched (it may retry as soon as the minute has room). Both refusals return false
-- (the function answers 429 RATE_LIMITED, as before). Cap: 120 lookups per UTC minute.
-- Only per-minute counters are stored (no user ids); rows older than an hour are pruned.
create table private.revenuecat_sync_minutes (
  minute timestamptz primary key,
  calls integer not null check (calls between 1 and 120)
);
alter table private.revenuecat_sync_minutes enable row level security;
revoke all on private.revenuecat_sync_minutes from public, anon, authenticated, service_role;

create or replace function public.claim_revenuecat_sync(p_user uuid, p_now timestamptz default now())
returns boolean language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_last timestamptz; v_calls integer; v_user uuid;
begin
  if p_user is null or p_now is null or not isfinite(p_now) then return false; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return false; end if;
  -- Same per-user lock as push claims: a user's concurrent calls serialize here.
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  select last_at into v_last from private.revenuecat_syncs where user_id = p_user;
  if v_last is not null and v_last > p_now - interval '30 seconds' then return false; end if;
  insert into private.revenuecat_sync_minutes(minute, calls)
    values (date_trunc('minute', p_now), 1)
    on conflict (minute) do update set calls = private.revenuecat_sync_minutes.calls + 1
    where private.revenuecat_sync_minutes.calls < 120
    returning calls into v_calls;
  if v_calls is null then return false; end if;
  if v_calls = 1 then
    delete from private.revenuecat_sync_minutes where minute < date_trunc('minute', p_now) - interval '1 hour';
  end if;
  insert into private.revenuecat_syncs(user_id, last_at) values (p_user, p_now)
    on conflict (user_id) do update set last_at = excluded.last_at
    where private.revenuecat_syncs.last_at <= excluded.last_at - interval '30 seconds'
    returning user_id into v_user;
  return v_user is not null;
end $$;
revoke all on function public.claim_revenuecat_sync(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_revenuecat_sync(uuid, timestamptz) to service_role;
