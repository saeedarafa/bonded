-- BE-60b (SEC-21 Info follow-ups on BE-60; CONTRACTS §3 `widget`).
--
--   * Info 3: `private.widget_auth` now also refuses a token whose minting Auth session is past its
--     `auth.sessions.not_after` (a session with a time-box / inactivity limit that GoTrue has ended
--     but not yet deleted). Same WIDGET_AUTH as every other failure. A null `not_after` (the
--     default: no time-box) keeps the old behaviour.
--   * Info 1 (documented, not changed): the per-token counter is written in the RPC's own
--     transaction, so a call that raises (RATE_LIMITED, LITTLE_THING_LIMIT, UNDO_EXPIRED,
--     INVALID_LITTLE_THING, PREMIUM_REQUIRED) rolls its own hit back. That is intended: a failed call
--     writes nothing (no row, no push, no `last_used_at`), and once a token reaches its limit the
--     counter is already at the cap, so RATE_LIMITED keeps answering until the window ends. A
--     separate write that survives the raise would need a second transaction (dblink / a second
--     RPC from the function) for no gain in what the limiter protects. Pinned by widgets.test.mjs.
--
-- Body identical to 20261113230000_widgets.sql except the `auth.sessions` check. The grants are
-- unchanged (create or replace keeps the ACL; re-stated below for clarity).

create or replace function private.widget_auth(p_token_hash text, p_scope text, p_now timestamptz,
  out user_id uuid, out couple_id uuid)
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  t        private.widget_tokens;
  v_bucket text := case when p_scope = 'widget_read' then 'read' else 'write' end;
  v_window interval := case when p_scope = 'widget_read' then interval '1 hour' else interval '10 minutes' end;
  v_max    integer := case when p_scope = 'widget_read' then 120 else 30 end;
  v_n      integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then perform private.raise_error('WIDGET_AUTH'); end if;
  select * into t from private.widget_tokens w where w.token_hash = p_token_hash for update;
  if not found
     or t.revoked_at is not null
     or t.expires_at <= p_now
     or not (p_scope = any (t.scopes))
     or not exists (select 1 from auth.users u where u.id = t.user_id)
     or not exists (select 1 from auth.sessions s
                     where s.id = t.session_id and s.user_id = t.user_id
                       and (s.not_after is null or s.not_after > p_now))
     or not exists (
       select 1 from public.couple_members m join public.couples c on c.id = m.couple_id
        where m.couple_id = t.couple_id and m.user_id = t.user_id and m.left_at is null and c.status = 'active')
     or (select count(*) from public.couple_members m where m.couple_id = t.couple_id and m.left_at is null) < 2 then
    perform private.raise_error('WIDGET_AUTH');
  end if;

  insert into private.widget_token_usage as u (token_hash, bucket, window_start, n)
    values (t.token_hash, v_bucket, p_now, 1)
  on conflict (token_hash, bucket) do update
    set window_start = case when u.window_start + v_window <= p_now then p_now else u.window_start end,
        n = case when u.window_start + v_window <= p_now then 1 else u.n + 1 end
  returning u.n into v_n;
  if v_n > v_max then perform private.raise_error('RATE_LIMITED'); end if;

  update private.widget_tokens w set last_used_at = p_now where w.token_hash = t.token_hash;
  user_id := t.user_id;
  couple_id := t.couple_id;
end $$;
revoke all on function private.widget_auth(text, text, timestamptz) from public, anon, authenticated, service_role;
