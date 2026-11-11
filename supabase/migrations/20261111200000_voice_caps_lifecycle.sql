-- BE-43 (D46; CONTRACTS §2–§5): voice caps and object lifecycle.
--
--   * Upload slots: an upload needs a server-issued object name from `start_voice_upload(p_ext)`.
--     That RPC is where the per-couple daily cap lives: at most 20 slots per couple per local day
--     (couple timezone), the 21st raises VOICE_LIMIT (DETAIL '{"max":20}'). It also checks the
--     active couple (NOT_PAIRED) and Premium (PREMIUM_REQUIRED), and serialises on the couple row.
--     The Storage upload policy now also requires an unexpired slot (1 hour) for exactly that name,
--     issued to the uploader, so the cap cannot be skipped by uploading a self-made name.
--   * Per-kind caps at row write: an answer recording ≤ 90 s and ≤ 400 KB, a thread message
--     recording ≤ 60 s and ≤ 300 KB (object `metadata.size`; the bucket's 400 KB limit stays the
--     upload backstop). Over a cap raises VOICE_TOO_LONG with DETAIL '{"max_ms":n,"max_bytes":n}'.
--     CHECK backstops on the duration columns (NOT VALID: they hold for every new write).
--   * Attaching a recording must happen within 23 hours of its upload (INVALID_VOICE after), so an
--     object the cleanup may remove (unreferenced and over 24 hours old) can never become referenced.
--   * SEC-09 Info 3: the reuse/existence checks and the owner's delete policy take the same
--     transaction advisory lock per object name, and re-read after it, so an object cannot end up
--     referenced twice (answer + message) or attached while its owner deletes it.
--   * Lifecycle: service-only `voice_sweep()` lists objects to remove: unreferenced and older than
--     24 hours (orphaned or replaced takes; rows removed by the D08 purge or by account deletion),
--     or at once when their couple or uploader no longer exists. The `voice-cleanup` Edge Function
--     (pg_cron hourly through pg_net) removes them through the Storage API (direct SQL deletes on
--     storage.objects would leave the files behind). `delete-account` removes the caller's objects
--     first via service-only `voice_objects_of_user(p_user)`.

alter type public.error_code add value if not exists 'VOICE_LIMIT';
alter type public.error_code add value if not exists 'VOICE_TOO_LONG';

-- ───────────────────────────── Duration backstops ─────────────────────────────

alter table public.answers
  add constraint answers_voice_duration_cap check (voice_duration_ms <= 90000) not valid;
alter table public.thread_messages
  add constraint thread_messages_voice_duration_cap check (voice_duration_ms <= 60000) not valid;

-- ───────────────────────────── Upload slots (daily cap) ─────────────────────────────

create table private.voice_uploads (
  name       text primary key,
  couple_id  uuid not null references public.couples(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  created_at timestamptz not null
);
create index voice_uploads_couple_day on private.voice_uploads (couple_id, local_date);
create index voice_uploads_user on private.voice_uploads (user_id);
create index voice_uploads_created on private.voice_uploads (created_at);
alter table private.voice_uploads enable row level security;
revoke all on private.voice_uploads from public, anon, authenticated, service_role;

create or replace function private.start_voice_upload_at(p_ext text, p_now timestamptz) returns text
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_couple public.couples;
  v_today  date;
  v_name   text;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  -- Parent lock: two partners taking the 20th slot at once are serialised here.
  select * into v_couple from public.couples
   where id = private.my_couple_id() and status = 'active' for update;
  if not found then perform private.raise_error('NOT_PAIRED'); end if;
  if not private.is_couple_premium(v_couple.id) then perform private.raise_error('PREMIUM_REQUIRED'); end if;
  if p_ext is null or p_ext not in ('m4a', 'aac', 'ogg', 'opus') then
    perform private.raise_error('INVALID_VOICE');
  end if;
  v_today := (p_now at time zone v_couple.timezone)::date;
  if (select count(*) from private.voice_uploads u
       where u.couple_id = v_couple.id and u.local_date = v_today) >= 20 then
    raise exception using message = 'VOICE_LIMIT', errcode = 'P0001', detail = '{"max":20}';
  end if;
  v_name := v_couple.id::text || '/' || v_uid::text || '/' || gen_random_uuid()::text || '.' || p_ext;
  insert into private.voice_uploads (name, couple_id, user_id, local_date, created_at)
    values (v_name, v_couple.id, v_uid, v_today, p_now);
  return v_name;
end $$;
revoke all on function private.start_voice_upload_at(text, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.start_voice_upload(p_ext text default 'm4a') returns text
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.start_voice_upload_at(p_ext, now())
$$;
revoke all on function public.start_voice_upload(text) from public, anon;
grant execute on function public.start_voice_upload(text) to authenticated;

-- Used by the upload policy (runs as the uploader; the slot table is private).
create or replace function private.voice_upload_reserved(p_name text) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from private.voice_uploads u
     where u.name = p_name and u.user_id = auth.uid() and u.created_at > now() - interval '1 hour')
$$;
revoke all on function private.voice_upload_reserved(text) from public, anon, authenticated, service_role;
grant execute on function private.voice_upload_reserved(text) to authenticated;

drop policy "voice upload own folder of premium active couple" on storage.objects;
create policy "voice upload reserved name in own folder of premium active couple" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'voice'
    and private.voice_path_ok(name, private.my_couple_id(), auth.uid())
    and private.is_couple_premium(private.my_couple_id())
    and private.voice_upload_reserved(name)
  );

-- ───────────────────────────── Serialised reference checks (SEC-09 Info 3) ─────────────────────────────

-- The owner's delete policy: lock the name, then look (plpgsql, so the lookup is a new statement
-- with a fresh snapshot under READ COMMITTED and sees an attach that committed while waiting).
create or replace function private.voice_object_referenced(p_name text) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('voice:' || p_name));
  return exists (select 1 from public.answers where voice_path = p_name)
      or exists (select 1 from public.thread_messages where voice_path = p_name);
end $$;
revoke all on function private.voice_object_referenced(text) from public, anon, authenticated, service_role;
grant execute on function private.voice_object_referenced(text) to authenticated, service_role;

-- A NEW voice reference by a client. Replaces BE-42's (uuid, uuid, text, boolean) version: the
-- reuse check now runs here, after the per-name lock, and the per-kind size cap is checked.
create or replace function private.voice_check_new(p_cq uuid, p_user uuid, p_path text, p_max_ms int, p_max_bytes bigint)
returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple  uuid;
  v_created timestamptz;
  v_size    bigint;
begin
  -- Not the writer's own row in their active couple: RLS rejects the row after the trigger. Say
  -- nothing here, so the error cannot reveal another couple's Premium state or objects.
  if auth.uid() is not null
     and (p_user is distinct from auth.uid() or not private.is_active_cq_member(p_cq)) then
    return;
  end if;
  select cq.couple_id into v_couple from public.couple_questions cq where cq.id = p_cq;
  if v_couple is null then return; end if;  -- the foreign key answers
  if not private.is_couple_premium(v_couple) then
    perform private.raise_error('PREMIUM_REQUIRED');
  end if;
  if not private.voice_path_ok(p_path, v_couple, p_user) then
    perform private.raise_error('INVALID_VOICE');
  end if;
  -- Serialise with every other attach of, and the owner's delete of, the same object. Each query
  -- below is a new statement, so it sees what committed while this waited.
  perform pg_advisory_xact_lock(hashtext('voice:' || p_path));
  if exists (select 1 from public.answers a where a.voice_path = p_path)
     or exists (select 1 from public.thread_messages m where m.voice_path = p_path) then
    perform private.raise_error('INVALID_VOICE');
  end if;
  select o.created_at, nullif(o.metadata->>'size', '')::bigint into v_created, v_size
    from storage.objects o where o.bucket_id = 'voice' and o.name = p_path;
  -- Missing, or uploaded so long ago that the cleanup may already be removing it (24 h).
  if not found or v_created < now() - interval '23 hours' then
    perform private.raise_error('INVALID_VOICE');
  end if;
  if v_size is not null and v_size > p_max_bytes then
    raise exception using message = 'VOICE_TOO_LONG', errcode = 'P0001',
      detail = format('{"max_ms":%s,"max_bytes":%s}', p_max_ms, p_max_bytes);
  end if;
end $$;
revoke all on function private.voice_check_new(uuid, uuid, text, int, bigint) from public, anon, authenticated, service_role;

create or replace function private.answers_validate_voice() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if new.kind is distinct from 'voice' or new.voice_path is null then return new; end if;  -- CHECK decides
  -- Depends only on the written value, so it reveals nothing about anyone's rows.
  if new.voice_duration_ms > 90000 then
    raise exception using message = 'VOICE_TOO_LONG', errcode = 'P0001',
      detail = '{"max_ms":90000,"max_bytes":409600}';
  end if;
  if tg_op = 'UPDATE' and new.voice_path is not distinct from old.voice_path then return new; end if;
  -- The INSERT half of an upsert fires before the conflict is found: the same reference on the
  -- same row is not new (retry / offline queue, also after a lapse). A row claiming someone
  -- else's user_id fails RLS either way, so this cannot confirm a guess.
  if exists (select 1 from public.answers a
              where a.couple_question_id = new.couple_question_id and a.user_id = new.user_id
                and a.voice_path = new.voice_path) then
    return new;
  end if;
  perform private.voice_check_new(new.couple_question_id, new.user_id, new.voice_path, 90000, 409600);
  return new;
end $$;
revoke all on function private.answers_validate_voice() from public, anon, authenticated, service_role;

create or replace function private.thread_messages_validate_voice() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    new.kind := old.kind;
    new.voice_path := old.voice_path;
    new.voice_duration_ms := old.voice_duration_ms;
    return new;
  end if;
  if new.kind is distinct from 'voice' or new.voice_path is null then return new; end if;
  if new.voice_duration_ms > 60000 then
    raise exception using message = 'VOICE_TOO_LONG', errcode = 'P0001',
      detail = '{"max_ms":60000,"max_bytes":307200}';
  end if;
  -- A resend with the same client_id (on conflict do nothing) is not new.
  if exists (select 1 from public.thread_messages m
              where m.client_id = new.client_id and m.user_id = new.user_id and m.voice_path = new.voice_path) then
    return new;
  end if;
  perform private.voice_check_new(new.couple_question_id, new.user_id, new.voice_path, 60000, 307200);
  return new;
end $$;
revoke all on function private.thread_messages_validate_voice() from public, anon, authenticated, service_role;

drop function private.voice_check_new(uuid, uuid, text, boolean);

-- ───────────────────────────── Cleanup (service role only) ─────────────────────────────

-- Objects the voice-cleanup function removes through the Storage API. Never referenced by a row,
-- and either older than 24 hours (an abandoned or replaced take, or rows gone with the D08 purge
-- or an account deletion) or belonging to a couple or uploader that no longer exists (at once).
-- Also drops upload slots older than 3 days (the daily cap only looks at today). Idempotent:
-- removing an already removed object is a no-op in Storage, and the next call no longer lists it.
create or replace function public.voice_sweep(p_now timestamptz default now(), p_limit integer default 500)
returns setof text
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  delete from private.voice_uploads where created_at < p_now - interval '3 days';
  return query
    select o.name from storage.objects o
     where o.bucket_id = 'voice'
       and not exists (select 1 from public.answers a where a.voice_path = o.name)
       and not exists (select 1 from public.thread_messages m where m.voice_path = o.name)
       and (o.created_at < p_now - interval '24 hours'
            or not exists (select 1 from public.couples c where c.id::text = split_part(o.name, '/', 1))
            or not exists (select 1 from public.profiles p where p.id::text = split_part(o.name, '/', 2)))
     order by o.created_at, o.name
     limit greatest(1, least(coalesce(p_limit, 500), 1000));
end $$;
revoke all on function public.voice_sweep(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.voice_sweep(timestamptz, integer) to service_role;

-- Every voice object the user uploaded (any couple), for delete-account (D09).
create or replace function public.voice_objects_of_user(p_user uuid) returns setof text
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select o.name from storage.objects o
   where o.bucket_id = 'voice' and p_user is not null and split_part(o.name, '/', 2) = p_user::text
   order by o.name
$$;
revoke all on function public.voice_objects_of_user(uuid) from public, anon, authenticated;
grant execute on function public.voice_objects_of_user(uuid) to service_role;

create or replace function private.dispatch_voice_cleanup() returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_url text; v_secret text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''functions_url''' into v_url;
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret''' into v_secret;
  exception when undefined_table then return; end;
  if v_url is null or v_secret is null or to_regnamespace('net') is null then return; end if;
  if not private.internal_url_allowed(v_url) then
    raise warning 'dispatch_voice_cleanup: functions_url must use https';
    return;
  end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, params := ''{}''::jsonb, headers := $3, timeout_milliseconds := 5000)'
      using v_url || '/functions/v1/voice-cleanup', '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
  exception when undefined_function then
    raise warning 'dispatch_voice_cleanup: pg_net call failed (%)', sqlstate;
  end;
end $$;
revoke all on function private.dispatch_voice_cleanup() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema extensions;
    if not exists (select 1 from cron.job where jobname = 'voice-cleanup-hourly') then
      perform cron.schedule('voice-cleanup-hourly', '43 * * * *', 'select private.dispatch_voice_cleanup()');
    end if;
  end if;
end $$;
