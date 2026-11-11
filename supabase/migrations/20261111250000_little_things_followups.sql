-- BE-45b (SEC-09e follow-ups on #202) and issue #206 (QA-28).
--
--   1. #206: `private.claim_little_thing_pushes_at` built `v_keep` / `v_capped` with an unordered
--      `array_agg`, so `push_log.record_id = v_keep[last]` followed the heap order, not the send
--      order. CONTRACTS §4 says `record_id` = the newest gesture of the push: both arrays are now
--      ordered by (created_at, id), the same order as `v_ids` and as the lead `gesture`. Nothing
--      else in the claim changes.
--   2. (Info) `undo_little_thing`: when the locked re-read finds nothing (the gesture was deleted
--      by an account deletion or couple purge while the undo waited for the lock), raise
--      INVALID_LITTLE_THING instead of falling through with an empty row. Same code as an unknown id.
--   3. Ops: the 10-second `little-things-push` job adds ~8,640 rows a day to
--      `cron.job_run_details`. New daily job `purge-cron-history` (04:29 UTC) deletes run history
--      older than 3 days for every job, through `private.purge_cron_history(p_now)`.
--      No user data is involved (job ids, status, timings, the job's SQL text).
--   4. pg_net (lead decision on #210): installed by migration where available, so a hosted project
--      (bonded-dev, prod at BE-22) never silently lacks it. Without it every pg_net dispatcher
--      (notify triggers, reminders, little things, voice-cleanup) is a silent no-op. Guarded like
--      pg_cron, so PGlite/plain Postgres still apply. The Vault secrets stay a manual step (PO).

-- ───────────────────────────── 1. Claim: ordered keep/capped (#206) ─────────────────────────────
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
    select coalesce(array_agg(l.id order by l.created_at, l.id) filter (where k.capped), '{}'),
           coalesce(array_agg(l.id order by l.created_at, l.id) filter (where not k.capped), '{}')
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

-- ───────────────────────────── 2. Undo: the locked re-read can find nothing ─────────────────────────────
create or replace function private.undo_little_thing_at(p_id uuid, p_now timestamptz)
returns setof public.little_thing_state
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row public.little_things;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  -- Look up first (no lock) only to find the couple for the advisory lock.
  select * into v_row from public.little_things where id = p_id and sender_id = v_uid;
  -- Unknown, or someone else's: the same code, so an id of another couple reveals nothing.
  if not found then perform private.raise_error('INVALID_LITTLE_THING'); end if;
  if v_row.undone_at is not null then
    return query select * from private.little_things_state(v_uid, v_row.couple_id, p_now);
    return;
  end if;
  -- Same lock as send_little_thing: the undo count is decided once per couple at a time.
  perform pg_advisory_xact_lock(hashtext('little_things:' || v_row.couple_id::text));
  -- The row lock waits for any push claim in flight (BE-45, SEC-09d Info 1).
  select * into v_row from public.little_things where id = p_id and sender_id = v_uid for update;
  -- Deleted while we waited for the lock (account deletion, couple purge): same code as unknown.
  if not found then perform private.raise_error('INVALID_LITTLE_THING'); end if;
  if v_row.undone_at is null then
    if p_now > v_row.created_at + interval '5 seconds'
       or exists (select 1 from private.little_thing_dispatch d where d.little_thing_id = v_row.id)
       or (select count(*) from public.little_things l
            where l.sender_id = v_uid and l.local_date = v_row.local_date and l.undone_at is not null) >= 10 then
      perform private.raise_error('UNDO_EXPIRED');
    end if;
    update public.little_things set undone_at = p_now where id = v_row.id;
  end if;
  return query select * from private.little_things_state(v_uid, v_row.couple_id, p_now);
end $$;
revoke all on function private.undo_little_thing_at(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ───────────────────────────── 3. Purge pg_cron run history ─────────────────────────────
-- Keeps 3 days of `cron.job_run_details` (every job), enough to debug a failed night. Rows that never
-- got a start time are left alone. Returns the number of rows deleted. A database without pg_cron
-- (PGlite tests, a plain Postgres) has no table: 0. Runs as the job owner (postgres), like the
-- cron job itself; not callable by clients or the service role.
create or replace function private.purge_cron_history(p_now timestamptz default now())
returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_n integer := 0;
begin
  if p_now is null or to_regclass('cron.job_run_details') is null then return 0; end if;
  execute 'delete from cron.job_run_details where coalesce(end_time, start_time) < $1'
    using p_now - interval '3 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.purge_cron_history(timestamptz) from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema extensions;
    if not exists (select 1 from cron.job where jobname = 'purge-cron-history') then
      perform cron.schedule('purge-cron-history', '29 4 * * *', 'select private.purge_cron_history()');
    end if;
  end if;
end $$;

-- ───────────────────────────── 4. pg_net ─────────────────────────────
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;
