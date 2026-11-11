-- BE-55c (SEC-13 #223 Info 3, SEC-14 #245 Low 1 + Low 2; CONTRACTS §2): one couple "today",
-- a history floor on timezone changes, and a fixed local day on every couple question.
--
-- 1. (SEC-14 Low 1) `couples.history_floor date`: on every `couples.timezone` change a trigger stamps
--    greatest(old floor, the couple-local date under the OLD zone at the change, database clock),
--    when the change moves the local date back and the couple already has questions (otherwise
--    there is nothing to reopen and the floor stays as it was).
--    BE-55b anchored the History window at greatest(local today, newest daily assigned_for), which
--    only holds once today's daily row exists; a client that never called get_daily_question could
--    switch westward and reopen day −2. The History anchor is now
--      greatest(local today, newest daily assigned_for, history_floor)
--    and a day's content is open iff day >= anchor − 1 (or Premium), so a zone change can never
--    reopen a day that was locked when it happened. Not client-writable (no column grant; the
--    trigger keeps it monotone for every writer).
--    No rate limit on timezone changes (decision, documented in CONTRACTS): with the floor a change
--    can only keep days locked, never reopen one, and the couple today is bounded by the easternmost
--    zone's date (UTC+14), so repeated switches gain nothing. A legitimate traveller is never refused.
-- 2. (SEC-13 Info 3) The couple "today" used by get_daily_question, send_nudge, due_reminders and
--    the invite previews is
--      private.couple_today_at = greatest(local today, newest daily assigned_for, history_floor − 1)
--    so after an east-then-west switch get_daily_question keeps returning the newest (answerable)
--    row instead of creating/returning an older row that answers DAY_ENDED. `history_floor − 1`
--    (not the floor itself) keeps an ordinary westward trip (Berlin → New York) on the natural local
--    day; it only moves today forward after a ≥ 2-date jump back (e.g. +14 → −12 just after
--    midnight), where today's question would otherwise sit below the History window.
--    `get_daily_question()` is unchanged for clients; `private.get_daily_question_at(p_now)` pins
--    the clock in tests.
-- 3. (SEC-14 Low 2) `couple_questions.local_day date not null`: the couple-local day a question
--    belongs to, fixed when the row is created (daily: assigned_for; pack: created_at in the
--    couple's zone AT CREATION). Existing rows are backfilled with the current zone (the best
--    information there is). The History lock and history_days use it instead of re-deriving a
--    pack day from created_at in the current zone, so an eastward switch cannot reopen a
--    late-evening pack question. Read-only for clients (no insert/update policy on the table).

-- ───────────────────────────── 3. couple_questions.local_day ─────────────────────────────

alter table public.couple_questions add column local_day date;
update public.couple_questions cq
   set local_day = coalesce(cq.assigned_for, (cq.created_at at time zone c.timezone)::date)
  from public.couples c where c.id = cq.couple_id;
alter table public.couple_questions alter column local_day set not null;
-- A default keeps local_day optional on Insert for clients/types; the trigger always overwrites it.
alter table public.couple_questions alter column local_day set default current_date;
comment on column public.couple_questions.local_day is
  'BE-55c: the couple-local day this question belongs to, fixed at creation (daily: assigned_for; pack: created_at in the couple zone at creation). Server-set.';

create or replace function private.couple_questions_local_day() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.local_day := coalesce(new.assigned_for,
      (new.created_at at time zone (select c.timezone from public.couples c where c.id = new.couple_id))::date);
  else
    -- Fixed: only a (server) change of assigned_for moves a daily row's day.
    new.local_day := coalesce(new.assigned_for, old.local_day);
  end if;
  return new;
end $$;
revoke all on function private.couple_questions_local_day() from public, anon, authenticated, service_role;

create trigger couple_questions_local_day before insert or update on public.couple_questions
  for each row execute function private.couple_questions_local_day();

-- ───────────────────────────── 1. couples.history_floor ─────────────────────────────

alter table public.couples add column history_floor date;
comment on column public.couples.history_floor is
  'BE-55c: the couple-local date under the previous zone at the last timezone change (monotone). Part of the History anchor. Server-set.';

create or replace function private.couples_history_floor() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  -- Only a change that moves the local date back can reopen a day, and only a couple with
  -- questions has a day to reopen; otherwise the anchor (>= the new local today) already holds.
  if new.timezone is distinct from old.timezone then
    -- An invalid zone is left to the couples_timezone_is_iana CHECK (it runs after this trigger).
    if not private.is_valid_timezone(new.timezone) or not private.is_valid_timezone(old.timezone) then
      new.history_floor := old.history_floor;
    elsif (now() at time zone new.timezone)::date < (now() at time zone old.timezone)::date
       and exists (select 1 from public.couple_questions cq where cq.couple_id = old.id) then
      new.history_floor := greatest(old.history_floor, (now() at time zone old.timezone)::date);
    else
      new.history_floor := old.history_floor;
    end if;
  else
    new.history_floor := greatest(old.history_floor, new.history_floor);
  end if;
  return new;
end $$;
revoke all on function private.couples_history_floor() from public, anon, authenticated, service_role;

create trigger couples_history_floor before update on public.couples
  for each row execute function private.couples_history_floor();

-- ───────────────────────────── 2. Couple today + History anchor ─────────────────────────────

-- The couple "today": greatest(local today, newest daily assigned_for, history_floor − 1).
-- Definer, no grants: called only from definer code.
create or replace function private.couple_today_at(p_couple uuid, p_tz text, p_now timestamptz)
returns date
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select greatest((p_now at time zone p_tz)::date,
                  (select max(n.assigned_for) from public.couple_questions n
                    where n.couple_id = p_couple and n.source = 'daily'),
                  (select c.history_floor - 1 from public.couples c where c.id = p_couple))
$$;
revoke all on function private.couple_today_at(uuid, text, timestamptz) from public, anon, authenticated, service_role;

-- The History anchor (open = day >= anchor − 1): the couple today, and never below history_floor.
create or replace function private.couple_history_today_at(p_couple uuid, p_tz text, p_now timestamptz)
returns date
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select greatest(private.couple_today_at(p_couple, p_tz, p_now),
                  (select c.history_floor from public.couples c where c.id = p_couple))
$$;
revoke all on function private.couple_history_today_at(uuid, text, timestamptz) from public, anon, authenticated, service_role;

create or replace function private.cq_content_open_at(p_cq uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select coalesce((
    select cq.local_day >= private.couple_history_today_at(c.id, c.timezone, p_now) - 1
        or case when c.status = 'active' then private.is_couple_premium(c.id)
                else exists (select 1 from public.entitlements e
                              where e.user_id = auth.uid() and e.is_active
                                and (e.expires_at is null or e.expires_at > p_now))
           end
      from public.couple_questions cq join public.couples c on c.id = cq.couple_id
     where cq.id = p_cq), false)
$$;
revoke all on function private.cq_content_open_at(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.cq_content_open_at(uuid, timestamptz) to authenticated, service_role;

-- history_days: same signature and output; `day` is the fixed local_day.
create or replace function private.history_days_at(
  p_couple_id uuid, p_limit integer, p_offset integer, p_couple_question_id uuid, p_now timestamptz,
  p_answered_only boolean default false)
returns table (
  couple_question_id uuid, couple_id uuid, question_id uuid, question jsonb, source text, day date,
  created_at timestamptz, my_answered boolean, partner_answered boolean, message_count integer,
  locked boolean)
language plpgsql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
#variable_conflict use_column
declare
  v_uid    uuid := auth.uid();
  v_couple uuid := p_couple_id;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if p_couple_question_id is not null then
    select cq.couple_id into v_couple from public.couple_questions cq where cq.id = p_couple_question_id;
  elsif v_couple is null then
    v_couple := private.my_couple_id();
    if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  end if;
  if v_couple is null or not private.can_read_couple(v_couple) then return; end if;

  return query
    select cq.id, cq.couple_id, cq.question_id, to_jsonb(q.*), cq.source,
           cq.local_day, cq.created_at,
           exists (select 1 from public.answers a where a.couple_question_id = cq.id and a.user_id = v_uid),
           exists (select 1 from public.answers a where a.couple_question_id = cq.id and a.user_id <> v_uid),
           case when private.cq_in_pair_period(cq.id) and private.both_answered(cq.id)
                then (select count(*)::int from public.thread_messages m where m.couple_question_id = cq.id)
                else 0 end,
           not private.cq_content_open_at(cq.id, p_now)
      from public.couple_questions cq
      left join public.questions q on q.id = cq.question_id
     where cq.couple_id = v_couple
       and (p_couple_question_id is null or cq.id = p_couple_question_id)
       and (not coalesce(p_answered_only, false)
            or exists (select 1 from public.answers a where a.couple_question_id = cq.id))
     order by cq.created_at desc, cq.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 100)
     offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function private.history_days_at(uuid, integer, integer, uuid, timestamptz, boolean)
  from public, anon, authenticated, service_role;

-- ───────────────────────────── get_daily_question ─────────────────────────────

create or replace function private.get_daily_question_at(p_now timestamptz) returns public.couple_questions
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple   uuid := private.my_couple_id();
  v_today    date;
  v_stage    public.couple_stage;
  v_question uuid;
  v_row      public.couple_questions;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  select private.couple_today_at(c.id, c.timezone, p_now), c.stage into v_today, v_stage
    from public.couples c where c.id = v_couple;

  select * into v_row from public.couple_questions
   where couple_id = v_couple and source = 'daily' and assigned_for = v_today;
  if found then return v_row; end if;

  if not exists (select 1 from public.couple_questions where couple_id = v_couple and source = 'daily') then
    select q.id into v_question from public.questions q
     where q.active and q.special = 'first_day'
     order by q.sort_order, q.id limit 1;
  end if;

  if v_question is null then
    select q.id into v_question from public.questions q
     where q.active and q.daily_eligible and q.special is null
       and (cardinality(q.stages) = 0 or v_stage = any (q.stages))
       and (not q.is_premium or private.is_couple_premium(v_couple))
       and not exists (select 1 from public.couple_questions cq where cq.couple_id = v_couple and cq.question_id = q.id)
     order by q.sort_order, q.id
     limit 1;
  end if;
  if v_question is null then perform private.raise_error('LIBRARY_EXHAUSTED'); end if;

  insert into public.couple_questions (couple_id, question_id, source, assigned_for)
  values (v_couple, v_question, 'daily', v_today)
  on conflict do nothing;

  select * into v_row from public.couple_questions
   where couple_id = v_couple and source = 'daily' and assigned_for = v_today;
  return v_row;
end $$;
revoke all on function private.get_daily_question_at(timestamptz) from public, anon, authenticated, service_role;

create or replace function public.get_daily_question() returns public.couple_questions
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  return private.get_daily_question_at(now());
end $$;
revoke all on function public.get_daily_question() from public, anon;
grant execute on function public.get_daily_question() to authenticated;

-- ───────────────────────────── send_nudge ─────────────────────────────

create or replace function private.send_nudge_at(p_now timestamptz)
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_couple public.couples;
  v_partner uuid;
  v_today date;
  v_cq uuid;
  v_record uuid;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  -- Same parent lock as pairing/unpair: a nudge cannot target an ended/replaced couple.
  select * into v_couple from public.couples
    where id = private.my_couple_id() and status = 'active' for update;
  if not found then perform private.raise_error('NOT_PAIRED'); end if;
  if not exists (select 1 from public.couple_members
      where couple_id = v_couple.id and user_id = v_uid and left_at is null) then
    perform private.raise_error('NOT_PAIRED');
  end if;
  select user_id into v_partner from public.couple_members
    where couple_id = v_couple.id and user_id <> v_uid and left_at is null;
  if v_partner is null then perform private.raise_error('NOT_PAIRED'); end if;
  -- BE-55c: the couple today (never behind the newest daily row), also the one-per-day ledger key,
  -- so a westward zone switch cannot buy a second nudge.
  v_today := private.couple_today_at(v_couple.id, v_couple.timezone, p_now);

  -- Answers serialize on this question too. Recheck after acquiring its row lock;
  -- an answer committed before this check must prevent the nudge.
  select id into v_cq from public.couple_questions
    where couple_id = v_couple.id and source = 'daily' and assigned_for = v_today for update;
  if exists (select 1 from public.answers where couple_question_id = v_cq and user_id = v_partner) then
    perform private.raise_error('PARTNER_ALREADY_ANSWERED');
  end if;

  insert into private.nudge_log (couple_id, sender_id, recipient_id, local_date, created_at)
    values (v_couple.id, v_uid, v_partner, v_today, p_now)
    on conflict (sender_id, local_date) do nothing returning id into v_record;
  if v_record is null then perform private.raise_error('NUDGE_LIMIT'); end if;
  perform private.dispatch_notify('nudge', v_record, v_couple.id, null, v_uid);
end $$;
revoke all on function private.send_nudge_at(timestamptz) from public, anon, authenticated, service_role;

-- ───────────────────────────── due_reminders ─────────────────────────────
-- Unchanged except the couple question lookup: the couple today at p_now, or (ritual reminder whose
-- due time fell before the couple's midnight) the local date of the due time, as before.

create or replace function public.due_reminders(p_now timestamptz default now())
returns table (user_id uuid, type public.push_type, claim_id uuid, streak integer,
  partner_name text, partner_answered boolean)
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r record; v_id uuid; v_claim uuid;
begin
  if p_now is null then return; end if;
  for r in
    with members as (
      select c.id couple_id, c.timezone couple_tz, p.timezone user_tz,
        np.*, p_now at time zone p.timezone user_now, p_now at time zone c.timezone couple_now,
        private.couple_today_at(c.id, c.timezone, p_now) couple_today,
        s.current streak, s.last_completed_on,
        (select count(*) from public.couple_members cm where cm.couple_id=c.id and cm.left_at is null) members
      from public.couple_members m
      join public.couples c on c.id=m.couple_id and c.status='active'
      join public.profiles p on p.id=m.user_id
      join public.notification_prefs np on np.user_id=m.user_id
      left join public.couple_streaks s on s.couple_id=c.id
      where m.left_at is null
    ), candidates as (
      select m.*, t.kind, t.due_at from members m cross join lateral (
        values
          ('ritual_reminder'::public.push_type,
           m.user_now::date + m.ritual_time - case when m.user_now::time < m.ritual_time then interval '1 day' else interval '0' end),
          ('last_call'::public.push_type,
           m.couple_now::date + time '22:30' - case when m.couple_now::time < time '22:30' then interval '1 day' else interval '0' end)
      ) t(kind, due_at)
    )
    select c.user_id uid, c.kind, c.due_at::date scheduled_date, c.user_now::date push_date,
      coalesce(c.streak,0) run, cq.id cq_id,
      (select left(p.display_name,30) from public.couple_members pm join public.profiles p on p.id=pm.user_id
        where pm.couple_id=c.couple_id and pm.left_at is null and pm.user_id<>c.user_id limit 1) partner,
      exists(select 1 from public.answers a where a.couple_question_id=cq.id and a.user_id<>c.user_id) partner_done
    from candidates c
    left join public.couple_questions cq on cq.couple_id=c.couple_id
      and cq.source='daily' and cq.assigned_for=case
        when c.kind='ritual_reminder'
             and ((p_now - (c.user_now-c.due_at)) at time zone c.couple_tz)::date <> c.couple_now::date
        then ((p_now - (c.user_now-c.due_at)) at time zone c.couple_tz)::date
        else c.couple_today end
    where
      -- Quiet hours and cap dates belong to the recipient; daily progress to the couple.
      not (case when c.quiet_start<c.quiet_end
        then c.user_now::time>=c.quiet_start and c.user_now::time<c.quiet_end
        else c.user_now::time>=c.quiet_start or c.user_now::time<c.quiet_end end)
      and ((c.kind='ritual_reminder' and c.daily_reminder
        and c.user_now>=c.due_at and c.user_now<c.due_at+interval '15 minutes'
        -- A nonexistent spring-forward wall time is skipped rather than shifted.
        and ((c.due_at at time zone c.user_tz) at time zone c.user_tz)=c.due_at
        and not exists(select 1 from public.answers a where a.couple_question_id=cq.id and a.user_id=c.user_id))
      or (c.kind='last_call' and c.last_call and c.members=2 and c.streak>=3
        and c.last_completed_on=c.couple_now::date-1
        and c.couple_now>=c.due_at and c.couple_now<c.due_at+interval '15 minutes'
        and coalesce(cq.answer_count,0)<2))
    order by c.user_id, c.kind
  loop
    -- Same lock as event-driven pushes, so every type shares the four/day cap.
    perform pg_advisory_xact_lock(hashtext(r.uid::text));
    if exists(select 1 from public.push_log pl where pl.user_id=r.uid and pl.type=r.kind
      and pl.local_date=r.push_date and pl.status in ('claimed','sent')) then continue; end if;
    v_id := null;
    insert into public.reminder_log(user_id,local_date,type,created_at)
      values(r.uid,r.scheduled_date,r.kind,p_now)
      on conflict do nothing returning id into v_id;
    if v_id is null then continue; end if;
    select cp.claim_id into v_claim from private.claim_push(r.uid,r.kind,v_id,r.cq_id,r.push_date,p_now) cp;
    if v_claim is null then continue; end if;
    user_id:=r.uid; type:=r.kind; claim_id:=v_claim; streak:=r.run;
    partner_name:=coalesce(r.partner,''); partner_answered:=r.partner_done;
    return next;
  end loop;
end $$;
revoke all on function public.due_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.due_reminders(timestamptz) to service_role;

-- ───────────────────────────── Invite previews ─────────────────────────────
-- Unchanged except `inviter_answered_today`, which now looks at the couple today's row.

create or replace function private.invite_preview_at(p_code text, p_token text, p_now timestamptz)
returns json
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_actor  text := private.invite_actor();
  r        record;
  v_inv    pair_invites;
  v_couple couples;
  v_prof   profiles;
  v_error  jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_actor, 0));
  perform private.race_point('actor_locked');
  select * into r from private.resolve_invite(p_code, p_token, p_now);
  if not r.token_ok and private.invite_limited(v_actor, p_now) then
    perform private.raise_error('RATE_LIMITED');
  end if;
  if r.err is not null then return private.invite_fail(v_actor, r.err, p_now); end if;

  select * into v_inv from pair_invites where id = r.invite_id;
  select * into v_couple from couples where id = v_inv.couple_id;
  if not found or v_couple.status <> 'active'
     or (select count(*) from couple_members where couple_id = v_couple.id) >= 2 then
    return private.invite_fail(v_actor, 'COUPLE_FULL', p_now, not r.token_ok);
  end if;
  if v_inv.expires_at <= p_now then
    v_error := private.invite_fail(v_actor, 'INVITE_EXPIRED', p_now, not r.token_ok)::jsonb;
    -- D39: a matching link capability may disclose only the bounded first name.
    -- Resolution has already rejected wrong tokens, accepted and revoked invites.
    if r.token_ok then
      select left(split_part(btrim(display_name), ' ', 1), 30) into v_prof.display_name
        from profiles where id = v_inv.inviter_id;
      v_error := jsonb_set(v_error, '{details}', jsonb_build_object('inviter_name', v_prof.display_name));
    end if;
    return v_error::json;
  end if;

  select * into v_prof from profiles where id = v_inv.inviter_id;
  return json_build_object(
    'inviter_name', left(split_part(btrim(v_prof.display_name), ' ', 1), 30),
    'inviter_avatar_url', null,
    'inviter_answered_today', exists (
      select 1 from couple_questions cq join answers a on a.couple_question_id = cq.id
       where cq.couple_id = v_couple.id and cq.source = 'daily'
         and cq.assigned_for = private.couple_today_at(v_couple.id, v_couple.timezone, p_now)
         and a.user_id = v_inv.inviter_id),
    'expires_at', v_inv.expires_at);
end $$;
revoke all on function private.invite_preview_at(text, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.invite_preview_for_link_at(
  p_code text, p_token text, p_now timestamptz
) returns json
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  r record;
  v_inv public.pair_invites;
  v_couple public.couples;
  v_name text;
  v_path text;
begin
  -- Match only the 192-bit URL-safe capabilities we issue; all invalid states
  -- return null, without names, paths, error distinctions or failed-attempt resets.
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32}$'
     or p_code is null or char_length(p_code) > 32 then return null; end if;
  select * into r from private.resolve_invite(p_code, p_token, p_now);
  if not r.token_ok or r.err is not null then return null; end if;
  select * into v_inv from public.pair_invites where id = r.invite_id;
  if not found or v_inv.expires_at <= p_now or v_inv.accepted_at is not null
     or v_inv.revoked_at is not null then return null; end if;
  select * into v_couple from public.couples where id = v_inv.couple_id;
  if not found or v_couple.status <> 'active'
     or (select count(*) from public.couple_members
          where couple_id = v_couple.id and left_at is null) <> 1
     or not exists (select 1 from public.couple_members
          where couple_id = v_couple.id and user_id = v_inv.inviter_id and left_at is null)
  then return null; end if;

  select left(split_part(btrim(display_name), ' ', 1), 30) into v_name
    from public.profiles where id = v_inv.inviter_id;
  -- Never use profiles.avatar_url or a caller-supplied path/host.
  select name into v_path from storage.objects
   where bucket_id = 'avatars' and name = v_inv.inviter_id::text || '/avatar.jpg';
  return json_build_object(
    'preview', json_build_object(
      'inviter_name', v_name,
      'inviter_avatar_url', null,
      'inviter_answered_today', exists (
        select 1 from public.couple_questions cq join public.answers a on a.couple_question_id = cq.id
         where cq.couple_id = v_couple.id and cq.source = 'daily'
           and cq.assigned_for = private.couple_today_at(v_couple.id, v_couple.timezone, p_now)
           and a.user_id = v_inv.inviter_id),
      'expires_at', v_inv.expires_at),
    'avatar_path', v_path);
end $$;
revoke all on function private.invite_preview_for_link_at(text, text, timestamptz)
  from public, anon, authenticated, service_role;
