-- BE-64 (MOB-78b step 4; SEC-21 "refresh after a silent push"; CONTRACTS §5 `widget_refresh`).
--
-- A silent, data-only push that wakes the app so it can mint a fresh widget token (the same body as
-- its WorkManager / BGTask refresh) before the device's token expires. The payload is exactly
-- `data: {type: "widget_refresh"}`: no title, body, sound, token, id or user content.
--
-- Who gets one: a person with a live widget token (not revoked, not expired) that expires within
-- the next 12 h, while
--   * that token is still the device's live one ("not seen since it was minted": the app mints on
--     every foreground once less than 24 h is left, and minting rotates the device's token, so a
--     live token this old means the app has not refreshed since; the server has no other
--     app-activity signal);
--   * the minting Auth session still exists and is not past `not_after` (never to signed-out
--     people), the Auth user exists, and the token's couple is still the person's active, paired
--     couple (never to unpaired people) — the same checks as `private.widget_auth`;
--   * the person has at least one registered push token;
--   * no widget_refresh push was claimed for the person in the last 24 h (at most one a day).
-- It is not a user-visible push: it is not written to `push_log`, so it never counts toward D24
-- (four a day, per-type caps) and is not held by quiet hours (it makes no sound and shows nothing).
-- It is sent to all of the person's push tokens (a push token is not linked to a widget device);
-- a device whose own token is still fresh simply rotates early, well inside the 20 mints a day.
--
-- Sent by the existing `daily-reminder` function (pg_cron every 15 min), which calls the
-- service-only `due_widget_refreshes(p_now)` below; the claim is recorded before sending, so an
-- unknown delivery outcome is never resent within 24 h.

create table private.widget_refresh_pushes (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  last_claimed_at timestamptz not null check (isfinite(last_claimed_at))
);
alter table private.widget_refresh_pushes enable row level security;
revoke all on private.widget_refresh_pushes from public, anon, authenticated, service_role;

create or replace function public.due_widget_refreshes(p_now timestamptz default now())
returns table (user_id uuid)
language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r record; v_uid uuid;
begin
  if p_now is null or not isfinite(p_now) then return; end if;
  for r in
    select distinct t.user_id uid
      from private.widget_tokens t
     where t.revoked_at is null
       and t.expires_at > p_now
       and t.expires_at <= p_now + interval '12 hours'
       and exists (select 1 from auth.users u where u.id = t.user_id)
       and exists (select 1 from auth.sessions s
         where s.id = t.session_id and s.user_id = t.user_id
           and (s.not_after is null or s.not_after > p_now))
       and exists (select 1 from public.couple_members m join public.couples c on c.id = m.couple_id
         where m.couple_id = t.couple_id and m.user_id = t.user_id and m.left_at is null
           and c.status = 'active')
       and (select count(*) from public.couple_members m
         where m.couple_id = t.couple_id and m.left_at is null) = 2
       and exists (select 1 from public.push_tokens pt where pt.user_id = t.user_id)
       and not exists (select 1 from private.widget_refresh_pushes w
         where w.user_id = t.user_id and w.last_claimed_at > p_now - interval '24 hours')
     order by 1
  loop
    -- Atomic claim: two overlapping cron runs cannot both send (the conditional upsert wins once).
    v_uid := null;
    insert into private.widget_refresh_pushes as w (user_id, last_claimed_at) values (r.uid, p_now)
      on conflict on constraint widget_refresh_pushes_pkey do update
        set last_claimed_at = excluded.last_claimed_at
        where w.last_claimed_at <= p_now - interval '24 hours'
      returning w.user_id into v_uid;
    if v_uid is not null then
      user_id := v_uid;
      return next;
    end if;
  end loop;
end $$;
revoke all on function public.due_widget_refreshes(timestamptz) from public, anon, authenticated;
grant execute on function public.due_widget_refreshes(timestamptz) to service_role;
