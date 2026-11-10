-- BE-37 / #126: send the internal function secret as an HTTP header, never as URL params.
-- pg_net's signature is net.http_post(url, body, params, headers, timeout_milliseconds); the
-- earlier positional calls put the header object in `params`, so the bearer went out in the
-- query string (gateway logs) and every DB-triggered call failed with 401.  Both dispatchers are
-- redefined with named arguments only.  Every other behaviour (Vault lookup, no-op without
-- Vault or pg_net, payload, ACLs) is unchanged.  Messages never contain the URL or secret.

-- https:// always; http:// only for loopback, private-network and docker-internal hosts that the
-- local stack and QA harness use, so a misconfigured Vault value never sends the bearer over
-- cleartext on the public internet.
create or replace function private.internal_url_allowed(p_url text) returns boolean
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select p_url ~* '^https://[^/?#\s]+'
    or (p_url ~* '^http://' and coalesce(lower(substring(p_url from '^[hH][tT][tT][pP]://([^/:?#\s]+)')), '') ~ (
      '^(localhost|[a-z0-9-]+\.localhost|host\.docker\.internal|[a-z0-9_-]+|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+'
      || '|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|\[::1\])$'))
$$;
revoke all on function private.internal_url_allowed(text) from public, anon, authenticated, service_role;

create or replace function private.dispatch_notify(
  p_type public.push_type, p_record_id uuid, p_couple_id uuid,
  p_couple_question_id uuid, p_actor_user_id uuid
) returns void language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_url text; v_secret text; v_payload jsonb;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''functions_url''' into v_url;
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret''' into v_secret;
  exception when undefined_table then return;
  end;
  -- pg_net is absent on local development and PGlite: a silent no-op, as before.
  if v_url is null or v_secret is null or to_regnamespace('net') is null then return; end if;
  if not private.internal_url_allowed(v_url) then
    raise warning 'dispatch_notify: functions_url must use https';
    return;
  end if;
  v_payload := jsonb_build_object('type', p_type, 'record_id', p_record_id, 'couple_id', p_couple_id,
    'couple_question_id', p_couple_question_id, 'actor_user_id', p_actor_user_id);
  begin
    execute 'select net.http_post(url := $1, body := $2, params := ''{}''::jsonb, headers := $3, timeout_milliseconds := 5000)'
      using v_url || '/functions/v1/notify', v_payload,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
  exception when undefined_function then
    -- `net` exists but the call does not resolve (pg_net signature drift): surface it without
    -- the URL, headers or secret, and keep the user's write.
    raise warning 'dispatch_notify: pg_net call failed (%)', sqlstate;
  end;
end $$;
revoke all on function private.dispatch_notify(public.push_type, uuid, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.dispatch_daily_reminders() returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_url text; v_secret text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''functions_url''' into v_url;
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret''' into v_secret;
  exception when undefined_table then return; end;
  if v_url is null or v_secret is null or to_regnamespace('net') is null then return; end if;
  if not private.internal_url_allowed(v_url) then
    raise warning 'dispatch_daily_reminders: functions_url must use https';
    return;
  end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, params := ''{}''::jsonb, headers := $3, timeout_milliseconds := 5000)'
      using v_url || '/functions/v1/daily-reminder', '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
  exception when undefined_function then
    raise warning 'dispatch_daily_reminders: pg_net call failed (%)', sqlstate;
  end;
end $$;
revoke all on function private.dispatch_daily_reminders() from public, anon, authenticated, service_role;
