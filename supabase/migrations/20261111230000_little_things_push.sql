-- BE-45 (D48, D24; CONTRACTS §2, §4, §5): little-things push.
--
--   * Push type `little_thing`; own toggle `notification_prefs.little_things` (default on).
--   * Delivery is claimed in the database, on the database clock, by service-only
--     `public.claim_little_thing_pushes()`; `notify` calls it when the 10-second cron dispatcher
--     sees work (`{"type":"little_thing"}` event) and only builds and sends the pushes.
--   * Rules, per recipient (the other current member of an active couple):
--       - a gesture is eligible 10 s after it was sent (the undo window is 5 s; SEC-09d Info 1);
--       - grouping: everything eligible goes into one push. After a little-things push, new
--         gestures wait until 10 minutes after it and then go out together in one push;
--       - at most one push per gesture type per hour: a kind already pushed in the last hour is
--         dropped from the next push (the gesture still shows in the app through realtime);
--       - shares the D24 four-a-day cap with every other type (same per-user advisory lock and
--         `push_log` as `claim_push`); cap reached → dropped, not queued;
--       - toggle off → dropped; inside the recipient's quiet hours → sent silently (`silent`);
--       - a gesture older than 30 minutes that was never handled (dispatcher down) is dropped;
--         the scans look back one day only (older unhandled rows are simply never pushed);
--       - an undone gesture never pushes.
--   * Undo/claim race (SEC-09d Info 1): the claim locks each `little_things` row (FOR UPDATE,
--     re-checking `undone_at`) and records it in `private.little_thing_dispatch` in the same
--     transaction. `undo_little_thing` locks the same row and refuses with UNDO_EXPIRED once a
--     dispatch row exists. Whichever commits first wins; an undo can never leave a push behind.
--   * Push bookkeeping is in a private table so the partner gets no extra realtime UPDATEs and no
--     client sees ledger ids. Nothing in it or in `push_log` carries names or text.

alter type public.push_type add value if not exists 'little_thing';

alter table public.notification_prefs add column if not exists little_things boolean not null default true;

-- ───────────────────────────── Dispatch ledger ─────────────────────────────

create table private.little_thing_dispatch (
  little_thing_id uuid primary key references public.little_things(id) on delete cascade,
  recipient_id    uuid references public.profiles(id) on delete cascade,
  push_id         uuid references public.push_log(id) on delete set null,
  outcome         text not null check (outcome in
                    ('pushed', 'type_cap', 'daily_cap', 'preference', 'stale', 'no_recipient')),
  handled_at      timestamptz not null
);
create index little_thing_dispatch_push on private.little_thing_dispatch (push_id) where push_id is not null;
alter table private.little_thing_dispatch enable row level security;
revoke all on private.little_thing_dispatch from public, anon, authenticated, service_role;

-- The 10-second check and the claim scan the last day of not-undone gestures by created_at.
create index little_things_pending on public.little_things (created_at) where undone_at is null;

-- ───────────────────────────── Claim ─────────────────────────────

create or replace function private.claim_little_thing_pushes_at(p_now timestamptz)
returns table (user_id uuid, claim_id uuid, silent boolean, partner_name text, gesture text, counts jsonb)
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
#variable_conflict use_column
declare
  r         record;
  v_last    timestamptz;
  v_prefs   public.notification_prefs;
  v_tz      text;
  v_day     date;
  v_daily   integer;
  v_ids     uuid[];
  v_keep    uuid[];
  v_capped  uuid[];
  v_claim   uuid;
  v_gesture text;
  v_counts  jsonb;
begin
  if p_now is null then return; end if;

  -- Gestures whose couple has no other current member (ended, partner left): handled, no push.
  insert into private.little_thing_dispatch (little_thing_id, outcome, handled_at)
    select l.id, 'no_recipient', p_now
      from public.little_things l
     where l.undone_at is null and l.created_at <= p_now - interval '10 seconds' and l.created_at > p_now - interval '1 day'
       and not exists (select 1 from private.little_thing_dispatch d where d.little_thing_id = l.id)
       and not exists (
         select 1 from public.couples c join public.couple_members m on m.couple_id = c.id
          where c.id = l.couple_id and c.status = 'active' and m.left_at is null and m.user_id <> l.sender_id)
    on conflict do nothing;

  for r in
    select distinct l.couple_id, m.user_id rcpt, l.sender_id
      from public.little_things l
      join public.couples c on c.id = l.couple_id and c.status = 'active'
      join public.couple_members m on m.couple_id = l.couple_id and m.left_at is null and m.user_id <> l.sender_id
     where l.undone_at is null and l.created_at <= p_now - interval '10 seconds' and l.created_at > p_now - interval '1 day'
       and not exists (select 1 from private.little_thing_dispatch d where d.little_thing_id = l.id)
     order by 2, 1
  loop
    -- Same lock as claim_push / due_reminders: the four-a-day cap is decided once per user.
    perform pg_advisory_xact_lock(hashtext(r.rcpt::text));

    -- Stale (never handled within 30 min): dropped. Locked like any claim, so a racing undo
    -- either wins or is refused.
    insert into private.little_thing_dispatch (little_thing_id, recipient_id, outcome, handled_at)
      select s.id, r.rcpt, 'stale', p_now from (
        select l.id from public.little_things l
         where l.couple_id = r.couple_id and l.sender_id = r.sender_id and l.undone_at is null
           and l.created_at <= p_now - interval '30 minutes' and l.created_at > p_now - interval '1 day'
           and not exists (select 1 from private.little_thing_dispatch d where d.little_thing_id = l.id)
         for update of l) s
      on conflict do nothing;

    -- Grouping: within 10 minutes of the last little-things push, wait and send them together.
    select max(p.created_at) into v_last from public.push_log p
     where p.user_id = r.rcpt and p.type = 'little_thing' and p.status in ('claimed', 'sent');
    if v_last is not null and p_now < v_last + interval '10 minutes' then continue; end if;

    -- Claim: lock the rows. FOR UPDATE waits for a concurrent undo and re-checks undone_at, so an
    -- undo that committed first is skipped; an undo that comes after sees the dispatch row.
    select coalesce(array_agg(x.id order by x.created_at, x.id), '{}') into v_ids from (
      select l.id, l.created_at from public.little_things l
       where l.couple_id = r.couple_id and l.sender_id = r.sender_id and l.undone_at is null
         and l.created_at <= p_now - interval '10 seconds' and l.created_at > p_now - interval '1 day'
         and not exists (select 1 from private.little_thing_dispatch d where d.little_thing_id = l.id)
       for update of l) x;
    if cardinality(v_ids) = 0 then continue; end if;

    select * into v_prefs from public.notification_prefs np where np.user_id = r.rcpt;
    if not found or not v_prefs.little_things then
      insert into private.little_thing_dispatch (little_thing_id, recipient_id, outcome, handled_at)
        select unnest(v_ids), r.rcpt, 'preference', p_now;
      continue;
    end if;

    -- One push per gesture type per hour: drop kinds already pushed in the last hour.
    select coalesce(array_agg(l.id) filter (where k.capped), '{}'),
           coalesce(array_agg(l.id) filter (where not k.capped), '{}')
      into v_capped, v_keep
      from public.little_things l
      cross join lateral (select exists (
        select 1 from public.push_log p
          join private.little_thing_dispatch d on d.push_id = p.id
          join public.little_things l2 on l2.id = d.little_thing_id
         where p.user_id = r.rcpt and p.type = 'little_thing' and p.status in ('claimed', 'sent')
           and p.created_at > p_now - interval '1 hour' and l2.kind = l.kind) capped) k
     where l.id = any(v_ids);
    if cardinality(v_capped) > 0 then
      insert into private.little_thing_dispatch (little_thing_id, recipient_id, outcome, handled_at)
        select unnest(v_capped), r.rcpt, 'type_cap', p_now;
    end if;
    if cardinality(v_keep) = 0 then continue; end if;

    select pr.timezone into v_tz from public.profiles pr
     where pr.id = r.rcpt and private.is_valid_timezone(pr.timezone);
    v_tz := coalesce(v_tz, 'UTC');
    v_day := (p_now at time zone v_tz)::date;

    -- D24: shared four-a-day cap (recipient-local day).
    select count(*) into v_daily from public.push_log p
     where p.user_id = r.rcpt and p.local_date = v_day and p.status in ('claimed', 'sent');
    if v_daily >= 4 then
      insert into private.little_thing_dispatch (little_thing_id, recipient_id, outcome, handled_at)
        select unnest(v_keep), r.rcpt, 'daily_cap', p_now;
      continue;
    end if;

    -- record_id: the newest gesture in the push (each gesture is claimed once).
    v_claim := null;
    insert into public.push_log (user_id, type, record_id, couple_question_id, local_date, created_at)
      values (r.rcpt, 'little_thing', v_keep[cardinality(v_keep)], null, v_day, p_now)
      on conflict do nothing
      returning id into v_claim;
    if v_claim is null then continue; end if;
    insert into private.little_thing_dispatch (little_thing_id, recipient_id, push_id, outcome, handled_at)
      select unnest(v_keep), r.rcpt, v_claim, 'pushed', p_now;

    -- Counts: kisses per kiss, every other kind per send. Lead gesture (sound/channel): the newest.
    select jsonb_object_agg(c.kind, c.n) into v_counts from (
      select l.kind, sum(case when l.kind = 'kiss' then l.amount else 1 end)::integer n
        from public.little_things l where l.id = any(v_keep) group by l.kind) c;
    select l.kind into v_gesture from public.little_things l
     where l.id = any(v_keep) order by l.created_at desc, l.id desc limit 1;

    user_id := r.rcpt;
    claim_id := v_claim;
    silent := private.in_quiet_hours((p_now at time zone v_tz)::time, v_prefs.quiet_start, v_prefs.quiet_end);
    partner_name := (select left(p.display_name, 30) from public.profiles p where p.id = r.sender_id);
    gesture := v_gesture;
    counts := v_counts;
    return next;
  end loop;
end $$;
revoke all on function private.claim_little_thing_pushes_at(timestamptz) from public, anon, authenticated, service_role;

-- Service-only entry point for `notify`. Always the database clock (no caller clock).
create or replace function public.claim_little_thing_pushes()
returns table (user_id uuid, claim_id uuid, silent boolean, partner_name text, gesture text, counts jsonb)
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  return query select * from private.claim_little_thing_pushes_at(now());
end $$;
revoke all on function public.claim_little_thing_pushes() from public, anon, authenticated;
grant execute on function public.claim_little_thing_pushes() to service_role;

-- ───────────────────────────── Undo: refused once the push is claimed ─────────────────────────────

create or replace function private.undo_little_thing_at(p_id uuid, p_now timestamptz)
returns setof public.little_thing_state
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row public.little_things;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  select * into v_row from public.little_things where id = p_id and sender_id = v_uid for update;
  -- Unknown, or someone else's: the same code, so an id of another couple reveals nothing.
  if not found then perform private.raise_error('INVALID_LITTLE_THING'); end if;
  if v_row.undone_at is null then
    -- The row lock above waited for any claim in flight; a claimed gesture can't be undone
    -- (SEC-09d Info 1), whatever the transaction's start time says.
    if p_now > v_row.created_at + interval '5 seconds'
       or exists (select 1 from private.little_thing_dispatch d where d.little_thing_id = v_row.id) then
      perform private.raise_error('UNDO_EXPIRED');
    end if;
    update public.little_things set undone_at = p_now where id = v_row.id;
  end if;
  return query select * from private.little_things_state(v_uid, v_row.couple_id, p_now);
end $$;
revoke all on function private.undo_little_thing_at(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ───────────────────────────── 10-second dispatcher ─────────────────────────────

-- Is there anything for claim_little_thing_pushes to do? Cheap; avoids calling the function
-- every 10 s while gestures wait for their group window.
create or replace function private.little_things_due(p_now timestamptz) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  return exists (
    select 1 from public.little_things l
     where l.undone_at is null and l.created_at <= p_now - interval '10 seconds' and l.created_at > p_now - interval '1 day'
       and not exists (select 1 from private.little_thing_dispatch d where d.little_thing_id = l.id)
       and (l.created_at <= p_now - interval '30 minutes'
            or not exists (
              select 1 from public.couple_members m join public.push_log p on p.user_id = m.user_id
               where m.couple_id = l.couple_id and m.left_at is null and m.user_id <> l.sender_id
                 and p.type = 'little_thing' and p.status in ('claimed', 'sent')
                 and p.created_at > p_now - interval '10 minutes')));
end $$;
revoke all on function private.little_things_due(timestamptz) from public, anon, authenticated, service_role;

create or replace function private.dispatch_little_things() returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_url text; v_secret text;
begin
  if not private.little_things_due(now()) then return; end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''functions_url''' into v_url;
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret''' into v_secret;
  exception when undefined_table then return; end;
  if v_url is null or v_secret is null or to_regnamespace('net') is null then return; end if;
  if not private.internal_url_allowed(v_url) then
    raise warning 'dispatch_little_things: functions_url must use https';
    return;
  end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, params := ''{}''::jsonb, headers := $3, timeout_milliseconds := 5000)'
      using v_url || '/functions/v1/notify', '{"type":"little_thing"}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
  exception when undefined_function then
    raise warning 'dispatch_little_things: pg_net call failed (%)', sqlstate;
  end;
end $$;
revoke all on function private.dispatch_little_things() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema extensions;
    if not exists (select 1 from cron.job where jobname = 'little-things-push') then
      begin
        -- pg_cron ≥ 1.5 runs sub-minute jobs; older versions fall back to every minute.
        perform cron.schedule('little-things-push', '10 seconds', 'select private.dispatch_little_things()');
      exception when others then
        perform cron.schedule('little-things-push', '* * * * *', 'select private.dispatch_little_things()');
      end;
    end if;
  end if;
end $$;
