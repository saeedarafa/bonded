-- BE-48 / D50: backend for the new onboarding with a soft trial paywall (CONTRACTS §2, §3, §5, §6).
--   (a) Purchases made before sign-in: the webhook resolves the Supabase user id from the event's
--       app_user_id / original_app_user_id / aliases (Edge code); `revenuecat-sync` lets the
--       signed-in app ask for a refresh of its OWN entitlement from RevenueCat's REST API (the
--       anonymous → identified alias made by `Purchases.logIn` sends no webhook). Both write only
--       through apply_revenuecat_event, rate-limited here. Never a client-supplied flag.
--   (b) `trial_ending` push on day 5 of a store trial: trial metadata from the canonical snapshot
--       (private, never client-readable), one reminder per user and trial, quiet hours and the
--       D24 four/day cap through private.claim_push, sent by the existing daily-reminder cron.
--   (c) Onboarding answers questionnaire version 2: fixed question ids and choice keys, validated.
-- No answer text, receipts or webhook payloads are read or stored.

alter type public.push_type add value if not exists 'trial_ending';
-- Raised as a literal below: a value added by ALTER TYPE can't be used in the same transaction.
alter type public.error_code add value if not exists 'INVALID_ONBOARDING_ANSWER';

-- ───────────────────────────── (c) Questionnaire version 2 ─────────────────────────────
-- Version 2 = the D50 order (05 → 07 → 02 → 03 → 04 → 06). Keys match design-handoff S01:
--   last_learned (03): "this_week" | "this_month" | "cant_remember"          (JSON string)
--   stage        (05): "dating" | "living_together" | "engaged_married" | "long_distance" (string)
--   goals        (06): array of distinct "deep_talks" | "laughing" | "romance" | "future" |
--                      "hard_conversations" | "learning" (0–6 items; none picked = [])
-- Version 1 rows keep the BE-33 format checks only (already shipped; still readable).
create function private.onboarding_answer_v2_valid(p_question text, p_answer jsonb)
returns boolean language sql immutable parallel safe set search_path = pg_catalog as $$
  select coalesce(case p_question
    when 'last_learned' then jsonb_typeof(p_answer) = 'string'
      and p_answer #>> '{}' in ('this_week', 'this_month', 'cant_remember')
    when 'stage' then jsonb_typeof(p_answer) = 'string'
      and p_answer #>> '{}' in ('dating', 'living_together', 'engaged_married', 'long_distance')
    when 'goals' then jsonb_typeof(p_answer) = 'array' and jsonb_array_length(p_answer) <= 6
      and not exists (select 1 from jsonb_array_elements(p_answer) e
        where jsonb_typeof(e) <> 'string' or e #>> '{}' not in
          ('deep_talks', 'laughing', 'romance', 'future', 'hard_conversations', 'learning'))
      and (select count(distinct e) from jsonb_array_elements(p_answer) e)
        = jsonb_array_length(p_answer)
    else false end, false)
$$;
-- The check constraint calls it by OID as the writing role (no schema USAGE needed).
revoke all on function private.onboarding_answer_v2_valid(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.onboarding_answer_v2_valid(text, jsonb) to authenticated, service_role;

-- Friendly code first (BEFORE trigger); the constraint is the backstop with triggers disabled.
create function private.onboarding_answers_validate() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if new.questionnaire_version = 2
    and not private.onboarding_answer_v2_valid(new.question_id, new.answer) then
    raise exception 'INVALID_ONBOARDING_ANSWER';
  end if;
  return new;
end $$;
revoke all on function private.onboarding_answers_validate() from public, anon, authenticated, service_role;
create trigger onboarding_answers_validate before insert or update on public.onboarding_answers
  for each row execute function private.onboarding_answers_validate();

-- NOT VALID: hosted dev may hold free-form test rows tagged version 2 from before this contract.
alter table public.onboarding_answers add constraint onboarding_answers_v2_keys check (
  questionnaire_version <> 2 or private.onboarding_answer_v2_valid(question_id, answer)) not valid;

-- ───────────────────────────── (b) Trial state and ledger ─────────────────────────────
-- Canonical store-trial metadata per user, written only by apply_revenuecat_event. Private: the
-- partner can read `entitlements` but must not learn that a trial was cancelled.
create table private.subscription_trials (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  product_id text check (char_length(product_id) <= 200),
  started_at timestamptz not null check (isfinite(started_at)),
  ends_at timestamptz not null check (isfinite(ends_at) and ends_at > started_at),
  will_renew boolean not null,
  updated_at timestamptz not null
);
alter table private.subscription_trials enable row level security;
revoke all on private.subscription_trials from public, anon, authenticated, service_role;

-- One reminder per user and trial (its start), whatever happens to devices, couples or caps.
create table private.trial_reminders (
  user_id uuid not null references public.profiles(id) on delete cascade,
  trial_started_at timestamptz not null,
  id uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  primary key (user_id, trial_started_at)
);
alter table private.trial_reminders enable row level security;
revoke all on private.trial_reminders from public, anon, authenticated, service_role;

-- (a) Rate limit for app-triggered refreshes: one RevenueCat REST lookup per user per 30 s.
create table private.revenuecat_syncs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_at timestamptz not null
);
alter table private.revenuecat_syncs enable row level security;
revoke all on private.revenuecat_syncs from public, anon, authenticated, service_role;

create function public.claim_revenuecat_sync(p_user uuid, p_now timestamptz default now())
returns boolean language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_user uuid;
begin
  if p_user is null or p_now is null or not isfinite(p_now) then return false; end if;
  insert into private.revenuecat_syncs(user_id, last_at)
    select p_user, p_now where exists (select 1 from public.profiles where id = p_user)
    on conflict (user_id) do update set last_at = excluded.last_at
    where private.revenuecat_syncs.last_at <= excluded.last_at - interval '30 seconds'
    returning user_id into v_user;
  return v_user is not null;
end $$;
revoke all on function public.claim_revenuecat_sync(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_revenuecat_sync(uuid, timestamptz) to service_role;

-- BE-18 body unchanged except the trial upkeep after a fresh (not stale) entitlement write.
-- p_changes items may carry optional period_type ('normal'|'trial'|'intro'|'prepaid'),
-- period_started_at and will_renew from the canonical RevenueCat subscription.
create or replace function private.apply_revenuecat_event(
  p_event_id text, p_occurred_at timestamptz, p_changes jsonb
) returns void language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_record uuid; v_change record; v_before jsonb; v_couple uuid; v_actor uuid; v_rows int;
begin
  if p_event_id is null or char_length(p_event_id) not between 1 and 200
    or p_occurred_at is null or not isfinite(p_occurred_at)
    or jsonb_typeof(p_changes) is distinct from 'array'
    or jsonb_array_length(p_changes) not between 1 and 100 then
    raise exception 'INVALID_WEBHOOK' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(18018, 1);
  insert into private.revenuecat_events(event_id,occurred_at)
    values(p_event_id,p_occurred_at) on conflict do nothing returning record_id into v_record;
  if v_record is null then return; end if;

  select coalesce(jsonb_object_agg(c.id::text,private.is_couple_premium(c.id)), '{}'::jsonb)
    into v_before from public.couples c where c.status='active' and exists (
      select 1 from public.couple_members m
      join jsonb_to_recordset(p_changes) as x(user_id uuid) on x.user_id=m.user_id
      where m.couple_id=c.id and m.left_at is null
    );
  for v_change in select * from jsonb_to_recordset(p_changes) as x(
    user_id uuid,is_active boolean,product_id text,store text,expires_at timestamptz,
    period_type text,period_started_at timestamptz,will_renew boolean
  ) loop
    if v_change.user_id is null or v_change.is_active is null
      or char_length(v_change.product_id)>200 or char_length(v_change.store)>50
      or (v_change.expires_at is not null and not isfinite(v_change.expires_at))
      or (v_change.period_type is not null
        and v_change.period_type not in ('normal','trial','intro','prepaid'))
      or (v_change.period_started_at is not null and not isfinite(v_change.period_started_at)) then
      raise exception 'INVALID_WEBHOOK' using errcode='22023';
    end if;
    insert into public.entitlements(user_id,is_active,product_id,store,expires_at,updated_at)
      select v_change.user_id,v_change.is_active,v_change.product_id,v_change.store,
        v_change.expires_at,p_occurred_at
      where exists(select 1 from public.profiles where id=v_change.user_id)
      on conflict(user_id) do update set is_active=excluded.is_active,
        product_id=excluded.product_id,store=excluded.store,expires_at=excluded.expires_at,
        updated_at=excluded.updated_at
      where public.entitlements.updated_at < excluded.updated_at;
    get diagnostics v_rows = row_count;
    -- Same ordering as the entitlement: a stale or unknown-user change leaves the trial alone.
    if v_rows > 0 then
      if v_change.is_active and v_change.period_type = 'trial'
        and v_change.period_started_at is not null and v_change.expires_at is not null
        and v_change.expires_at > v_change.period_started_at then
        insert into private.subscription_trials(user_id,product_id,started_at,ends_at,will_renew,updated_at)
          values(v_change.user_id,v_change.product_id,v_change.period_started_at,
            v_change.expires_at,coalesce(v_change.will_renew,false),p_occurred_at)
          on conflict(user_id) do update set product_id=excluded.product_id,
            started_at=excluded.started_at,ends_at=excluded.ends_at,
            will_renew=excluded.will_renew,updated_at=excluded.updated_at;
      else
        delete from private.subscription_trials where user_id=v_change.user_id;
      end if;
    end if;
  end loop;
  for v_couple in select key::uuid from jsonb_each(v_before) where value='false'::jsonb loop
    if not private.is_couple_premium(v_couple) then continue; end if;
    select m.user_id into v_actor from public.couple_members m
      join public.entitlements e on e.user_id=m.user_id
      where m.couple_id=v_couple and m.left_at is null and e.is_active
        and (e.expires_at is null or e.expires_at>now())
        and e.updated_at=p_occurred_at order by m.user_id limit 1;
    if v_actor is not null then
      perform private.dispatch_notify('partner_premium',v_record,v_couple,null,v_actor);
    end if;
  end loop;
end $$;
revoke all on function private.apply_revenuecat_event(text,timestamptz,jsonb) from public,anon,authenticated,service_role;

-- Day 5 of the trial = trial start + 4 days (the start day is day 1), never later than 2 days
-- before the trial ends (shorter trials). Window: 24 h from that instant, and before the trial
-- ends. Outside the recipient's quiet hours; a cap-blocked claim is released and retried on the
-- next 15-minute tick inside the window. Only while the trial will convert (not cancelled, no
-- billing issue) and the entitlement is still active. No preference toggle: it is the reminder
-- promised on the paywall (P3 timeline), not marketing.
create function public.due_trial_endings(p_now timestamptz default now())
returns table (user_id uuid, claim_id uuid, days_left integer)
language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r record; v_id uuid; v_claim uuid;
begin
  if p_now is null or not isfinite(p_now) then return; end if;
  for r in
    select t.user_id uid, t.started_at, t.ends_at,
      (p_now at time zone p.timezone)::date push_date
    from private.subscription_trials t
    cross join lateral (select least(t.started_at + interval '4 days',
      t.ends_at - interval '2 days') due_at) d
    join public.entitlements e on e.user_id=t.user_id and e.is_active
      and e.expires_at is not null and e.expires_at > p_now
    join public.profiles p on p.id=t.user_id
    join public.notification_prefs np on np.user_id=t.user_id
    where t.will_renew and d.due_at > t.started_at
      and p_now >= d.due_at and p_now < least(d.due_at + interval '24 hours', t.ends_at)
      and not (case when np.quiet_start<np.quiet_end
        then (p_now at time zone p.timezone)::time>=np.quiet_start
          and (p_now at time zone p.timezone)::time<np.quiet_end
        else (p_now at time zone p.timezone)::time>=np.quiet_start
          or (p_now at time zone p.timezone)::time<np.quiet_end end)
    order by t.user_id
  loop
    -- Same per-user lock as every other push claim (shared four/day cap).
    perform pg_advisory_xact_lock(hashtext(r.uid::text));
    v_id := null;
    insert into private.trial_reminders(user_id,trial_started_at,created_at)
      values(r.uid,r.started_at,p_now) on conflict do nothing returning id into v_id;
    if v_id is null then continue; end if;
    select cp.claim_id into v_claim
      from private.claim_push(r.uid,'trial_ending',v_id,null,r.push_date,p_now) cp;
    if v_claim is null then
      delete from private.trial_reminders where id=v_id;
      continue;
    end if;
    user_id := r.uid; claim_id := v_claim;
    days_left := greatest(1, ceil(extract(epoch from (r.ends_at - p_now)) / 86400))::integer;
    return next;
  end loop;
end $$;
revoke all on function public.due_trial_endings(timestamptz) from public, anon, authenticated;
grant execute on function public.due_trial_endings(timestamptz) to service_role;
