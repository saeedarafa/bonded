-- BE-51 (D54, ANALYTICS.md rule 7): deleting the account also deletes the user's PostHog person
-- and events. The PostHog distinct id is the Supabase user uuid (`identify(uid)` in the app).
--
-- Design (kept small on purpose):
--   * `delete-account` records the user in `private.analytics_deletions` BEFORE it deletes the Auth
--     user, so the request is durable even if the function dies right after the Auth delete.
--   * After the Auth delete it calls PostHog inline (a few short attempts on 5xx / 429 / network
--     errors). Success removes the row; a failure reschedules it with backoff. A PostHog problem
--     never fails or blocks the account deletion.
--   * The `analytics-deletions` Edge Function (pg_cron hourly through pg_net, internal secret, same
--     dispatcher shape as voice-cleanup) drains due rows. Only rows whose Auth user is already gone
--     are handed out, so a failed account deletion never wipes analytics of a user who still exists.
--   * Without PostHog secrets the functions skip (log line only) and the rows wait until the
--     secrets are set; nothing is lost. Rows are never dropped automatically.
-- The table holds only the pseudonymous uuid, counters and the last HTTP status: no email, no
-- content. All access is service-role RPCs; clients get nothing.

create table private.analytics_deletions (
  distinct_id     uuid primary key,
  requested_at    timestamptz not null default now(),
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_status     integer
);
create index analytics_deletions_due on private.analytics_deletions (next_attempt_at);
alter table private.analytics_deletions enable row level security;
revoke all on private.analytics_deletions from public, anon, authenticated, service_role;

-- Record a deletion request (idempotent: a retried delete-account keeps the first row).
create or replace function public.analytics_deletion_request(p_user uuid) returns void
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  insert into private.analytics_deletions (distinct_id) select p_user where p_user is not null
  on conflict (distinct_id) do nothing
$$;
revoke all on function public.analytics_deletion_request(uuid) from public, anon, authenticated;
grant execute on function public.analytics_deletion_request(uuid) to service_role;

-- Claim up to p_limit due rows whose Auth user no longer exists. A claimed row is leased for
-- 10 minutes (next_attempt_at moves forward), so two overlapping runs do not take the same row.
-- Database clock only (no caller clock).
create or replace function public.analytics_deletions_due(p_limit integer default 100)
returns setof uuid
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  update private.analytics_deletions d
     set next_attempt_at = now() + interval '10 minutes'
   where d.distinct_id in (
     select x.distinct_id from private.analytics_deletions x
      where x.next_attempt_at <= now()
        and not exists (select 1 from auth.users u where u.id = x.distinct_id)
      order by x.next_attempt_at, x.distinct_id
      limit greatest(1, least(coalesce(p_limit, 100), 500))
      for update skip locked)
  returning d.distinct_id
$$;
revoke all on function public.analytics_deletions_due(integer) from public, anon, authenticated;
grant execute on function public.analytics_deletions_due(integer) to service_role;

-- Report one attempt. Success removes the row. Failure counts the attempt, stores the HTTP status
-- (0 = network error or timeout) and backs off: 15 min, 30 min, 1 h, ... capped at 24 h.
create or replace function public.analytics_deletion_result(p_user uuid, p_ok boolean, p_status integer)
returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if p_user is null then return; end if;
  if coalesce(p_ok, false) then
    delete from private.analytics_deletions where distinct_id = p_user;
    return;
  end if;
  update private.analytics_deletions
     set attempts = attempts + 1,
         last_status = p_status,
         next_attempt_at = now() + least(interval '24 hours',
                                         interval '15 minutes' * power(2, least(attempts, 10)))
   where distinct_id = p_user;
end $$;
revoke all on function public.analytics_deletion_result(uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.analytics_deletion_result(uuid, boolean, integer) to service_role;

create or replace function private.dispatch_analytics_deletions() returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from private.analytics_deletions where next_attempt_at <= now()) then
    return;
  end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''functions_url''' into v_url;
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret''' into v_secret;
  exception when undefined_table then return; end;
  if v_url is null or v_secret is null or to_regnamespace('net') is null then return; end if;
  if not private.internal_url_allowed(v_url) then
    raise warning 'dispatch_analytics_deletions: functions_url must use https';
    return;
  end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, params := ''{}''::jsonb, headers := $3, timeout_milliseconds := 5000)'
      using v_url || '/functions/v1/analytics-deletions', '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
  exception when undefined_function then
    raise warning 'dispatch_analytics_deletions: pg_net call failed (%)', sqlstate;
  end;
end $$;
revoke all on function private.dispatch_analytics_deletions() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema extensions;
    if not exists (select 1 from cron.job where jobname = 'analytics-deletions-hourly') then
      perform cron.schedule('analytics-deletions-hourly', '17 * * * *', 'select private.dispatch_analytics_deletions()');
    end if;
  end if;
end $$;
