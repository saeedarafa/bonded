-- BE-53 (D48 amended, PO 2026-11-11): "Little things sounds" switch on 41 also mutes the push sound.
--   * `notification_prefs.little_things_sound boolean not null default true` (existing rows on). Own
--     row only through the existing policies ("read own prefs" / "add own prefs" / "change own prefs");
--     no RLS or grant change.
--   * `private.claim_little_thing_pushes_at`: a claim is `silent` in quiet hours (as before) **or**
--     when the recipient's `little_things_sound` is false. A silent claim is still pushed (no sound,
--     channel `little_thing_quiet`, iOS `interruptionLevel: passive`, built by `notify`) and still
--     counts toward the D24 four-a-day cap and the one-per-type-per-hour cap. Body otherwise identical
--     to 20261111250000_little_things_followups.sql.

alter table public.notification_prefs
  add column if not exists little_things_sound boolean not null default true;
comment on column public.notification_prefs.little_things_sound is
  'BE-53 (D48): false = little-thing pushes arrive silently (quiet channel); in-app gesture sounds off too.';

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
    -- Quiet hours (D48) or the recipient's "Little things sounds" switch off (BE-53): sent silently,
    -- still delivered and still counted (D24 cap, 1 per type per hour, grouping all unchanged).
    silent := private.in_quiet_hours((p_now at time zone v_tz)::time, v_prefs.quiet_start, v_prefs.quiet_end)
              or not v_prefs.little_things_sound;
    partner_name := (select left(p.display_name, 30) from public.profiles p where p.id = r.sender_id);
    gesture := v_gesture;
    counts := v_counts;
    return next;
  end loop;
end $$;
revoke all on function private.claim_little_thing_pushes_at(timestamptz) from public, anon, authenticated, service_role;
