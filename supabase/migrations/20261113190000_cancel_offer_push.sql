-- BE-62 (c) / D61 (3): the `cancel_offer` push. When RevenueCat reports a store-side cancellation
-- (webhook `CANCELLATION`, auto-renew turned off) of an App Store trial or Yearly subscription
-- whose period is still running, for a person who was never offered the 30%, the server sends ONE
-- `cancel_offer` push that opens the in-app cancel offer screen. Never after the period ended,
-- once per person ever, D24 four/day cap, quiet hours, only with the tips opt-in (promotional, like
-- `offer_ending`, App Store 4.5.4).
-- BE-59 (c): `due_offer_endings` also returns the partner's first name for the approved
-- `offer_ending` copy ("You and {partner} earned half off Premium for a year.").
--
-- Flow:
--   1. `revenuecat` webhook writes the canonical snapshot (apply_revenuecat_event), then, for a
--      CANCELLATION with cancel_reason UNSUBSCRIBE whose *canonical* snapshot (RevenueCat REST, not
--      webhook fields) says active, will not renew, App Store, trial or yearly period, calls the
--      service-only `queue_cancel_offer(user, true)`. Any event whose snapshot says the
--      subscription renews again (UNCANCELLATION, RENEWAL, ...) calls it with false (unqueue).
--   2. `daily-reminder` (every 15 min) calls service-only `due_cancel_offers(p_now)`, which claims
--      the push and records the offer in `private.exit_offers(user, 'cancel', source 'push')` in
--      the same transaction. That row also bars the day-3 gift (BE-62 (b)).
--   3. The app opens the offer screen and calls `open_exit_offer('cancel')`: a push row not opened
--      yet answers `eligible: true` once (then it is an ordinary shown row: same client_id retry
--      → eligible, anything else → shown_before).
-- Nothing here grants premium. No answer or message text is read or stored.

alter type public.push_type add value if not exists 'cancel_offer';

-- ───────────────────────────── exit_offers: push-offered rows ─────────────────────────────
-- source 'app': shown on screen by open_exit_offer (opened_at = first_shown_at).
-- source 'push': offered by the cancel_offer push (first_shown_at = push claim); opened_at set
-- when the app first opens the offer screen through open_exit_offer('cancel').
alter table private.exit_offers
  add column source text not null default 'app' check (source in ('app', 'push')),
  add column opened_at timestamptz check (opened_at is null or isfinite(opened_at));
update private.exit_offers set opened_at = first_shown_at where opened_at is null;
alter table private.exit_offers
  add constraint exit_offers_opened check (source = 'push' or opened_at is not null),
  add constraint exit_offers_push_cancel check (source = 'app' or trigger = 'cancel');

-- ───────────────────────────── Queue ─────────────────────────────
-- One pending store-side cancellation per person. Private, no client or service_role table access
-- (only the two RPCs below); removed with the account.
create table private.cancel_offer_queue (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  queued_at timestamptz not null check (isfinite(queued_at))
);
alter table private.cancel_offer_queue enable row level security;
revoke all on private.cancel_offer_queue from public, anon, authenticated, service_role;

-- The person's own App Store subscription is still running for at least another hour (so the
-- offer can still be taken; the promotional offer applies from the next renewal date).
create function private.cancel_offer_running(p_user uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select exists (select 1 from public.entitlements e
    where e.user_id = p_user and e.is_active and e.store = 'app_store'
      and e.expires_at is not null and e.expires_at > p_now + interval '1 hour')
$$;
revoke all on function private.cancel_offer_running(uuid, timestamptz) from public, anon, authenticated, service_role;

-- Service-only, called by the `revenuecat` webhook after the canonical entitlement write.
-- p_cancelled true: queue (returns true only when a new row was queued); refused without a write
-- when the person already has a `cancel` exit-offer row (in-app or push: once per person ever) or
-- no running App Store subscription. p_cancelled false: drop a pending row (auto-renew back on).
-- Replays are harmless (primary key; nothing is sent from here).
create function public.queue_cancel_offer(p_user uuid, p_cancelled boolean, p_now timestamptz default now())
returns boolean language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_id uuid;
begin
  if p_user is null or p_cancelled is null or p_now is null or not isfinite(p_now) then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('exit_offer:' || p_user::text));
  if not p_cancelled then
    delete from private.cancel_offer_queue where user_id = p_user;
    return false;
  end if;
  if exists (select 1 from private.exit_offers x where x.user_id = p_user and x.trigger = 'cancel')
    or not private.cancel_offer_running(p_user, p_now) then
    return false;
  end if;
  insert into private.cancel_offer_queue(user_id, queued_at) values (p_user, p_now)
    on conflict (user_id) do nothing returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.queue_cancel_offer(uuid, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.queue_cancel_offer(uuid, boolean, timestamptz) to service_role;

-- Service-only, called by `daily-reminder` every 15 minutes. For each queued person with the tips
-- opt-in, outside their quiet hours, whose App Store subscription still runs for at least an hour
-- and who was never offered the 30%: claims one `cancel_offer` push (D24 cap through
-- private.claim_push; a cap-blocked claim is released and retried at the next tick) and records
-- the offer (exit_offers source 'push') in the same transaction. Rows that can no longer be sent
-- (period ended or about to, already offered, account gone) are dropped first.
-- partner_name: the current partner's first name ('' when solo or blank; the function fills a
-- fallback).
create function public.due_cancel_offers(p_now timestamptz default now())
returns table (user_id uuid, claim_id uuid, partner_name text)
language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r record; v_claim uuid; v_row text;
begin
  if p_now is null or not isfinite(p_now) then return; end if;
  delete from private.cancel_offer_queue q
    where not private.cancel_offer_running(q.user_id, p_now)
      or exists (select 1 from private.exit_offers x where x.user_id = q.user_id and x.trigger = 'cancel');
  for r in
    select q.user_id uid, q.id qid, (p_now at time zone p.timezone)::date push_date,
      coalesce((select private.first_name(pp.display_name)
        from public.couple_members me
        join public.couples c on c.id = me.couple_id and c.status = 'active'
        join public.couple_members pm on pm.couple_id = me.couple_id and pm.left_at is null
          and pm.user_id <> me.user_id
        join public.profiles pp on pp.id = pm.user_id
        where me.user_id = q.user_id and me.left_at is null limit 1), '') partner
    from private.cancel_offer_queue q
    join public.profiles p on p.id = q.user_id
    join public.notification_prefs np on np.user_id = q.user_id
    where np.tips -- promotional: only with the in-app opt-in (App Store 4.5.4)
      and not (case when np.quiet_start < np.quiet_end
        then (p_now at time zone p.timezone)::time >= np.quiet_start
          and (p_now at time zone p.timezone)::time < np.quiet_end
        else (p_now at time zone p.timezone)::time >= np.quiet_start
          or (p_now at time zone p.timezone)::time < np.quiet_end end)
    order by q.queued_at, q.user_id
  loop
    -- Same lock as open_exit_offer / queue_cancel_offer: an in-app offer at the same moment
    -- either wins (row exists, nothing sent) or sees the push row.
    perform pg_advisory_xact_lock(hashtext('exit_offer:' || r.uid::text));
    v_row := null;
    insert into private.exit_offers(user_id, trigger, first_shown_at, client_id, source, opened_at)
      values (r.uid, 'cancel', p_now, null, 'push', null)
      on conflict do nothing returning trigger into v_row;
    if v_row is null then
      delete from private.cancel_offer_queue q where q.id = r.qid;
      continue;
    end if;
    select cp.claim_id into v_claim
      from private.claim_push(r.uid, 'cancel_offer', r.qid, null, r.push_date, p_now) cp;
    if v_claim is null then
      -- Cap reached (or duplicate): not offered yet; retry at the next tick.
      delete from private.exit_offers x
        where x.user_id = r.uid and x.trigger = 'cancel' and x.source = 'push';
      continue;
    end if;
    delete from private.cancel_offer_queue q where q.id = r.qid;
    user_id := r.uid; claim_id := v_claim; partner_name := r.partner;
    return next;
  end loop;
end $$;
revoke all on function public.due_cancel_offers(timestamptz) from public, anon, authenticated;
grant execute on function public.due_cancel_offers(timestamptz) to service_role;

-- ───────────────────────────── open_exit_offer: push-offered rows ─────────────────────────────
-- Same body as BE-59 (20261112120000_exit_offers.sql) plus: a `cancel` row offered by push and not
-- opened yet answers `eligible: true` once (still needs the running App Store subscription and the
-- D52 day slot; a refusal leaves it unopened), recording opened_at and the client_id.
create or replace function private.open_exit_offer_at(p_trigger text, p_client_id uuid, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row private.exit_offers;
  v_couple uuid;
  v_reason text;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if p_trigger is null or p_trigger not in ('paywall_close', 'cancel')
    or p_now is null or not isfinite(p_now) then
    return jsonb_build_object('eligible', false, 'first_shown_at', null, 'reason', 'unknown_trigger');
  end if;
  -- Two devices of the same person closing at once: one wins, the other reads its row.
  perform pg_advisory_xact_lock(hashtext('exit_offer:' || v_uid::text));

  select * into v_row from private.exit_offers where user_id = v_uid and trigger = p_trigger;
  if found and not (v_row.source = 'push' and v_row.opened_at is null) then
    if p_client_id is not null and v_row.client_id = p_client_id then
      return jsonb_build_object('eligible', true, 'first_shown_at', v_row.first_shown_at, 'reason', null);
    end if;
    return jsonb_build_object('eligible', false, 'first_shown_at', v_row.first_shown_at,
      'reason', 'shown_before');
  end if;

  select m.couple_id into v_couple from public.couple_members m
    join public.couples c on c.id = m.couple_id and c.status = 'active'
    where m.user_id = v_uid and m.left_at is null;

  if p_trigger = 'paywall_close' then
    if exists (select 1 from public.entitlements e where e.user_id = v_uid and e.is_active
        and (e.expires_at is null or e.expires_at > p_now))
      or (v_couple is not null and private.couple_premium_at(v_couple, p_now)) then
      v_reason := 'premium';
    -- Store intro eligibility, server side: never subscribed, trialled or used an intro price.
    elsif exists (select 1 from private.premium_history h where h.user_id = v_uid) then
      v_reason := 'not_intro_eligible';
    elsif v_couple is not null and private.day3_live_at(v_couple, p_now) then
      v_reason := 'gift_live';
    end if;
  else
    -- A promotional offer needs the person's own active App Store subscription.
    if not exists (select 1 from public.entitlements e where e.user_id = v_uid and e.is_active
        and (e.expires_at is null or e.expires_at > p_now) and e.store = 'app_store') then
      v_reason := 'no_subscription';
    end if;
  end if;

  if v_reason is null and not private.claim_offer_screen_at('exit_' || p_trigger, p_now) then
    v_reason := 'daily_limit';
  end if;
  if v_reason is not null then
    return jsonb_build_object('eligible', false, 'first_shown_at', null, 'reason', v_reason);
  end if;

  if v_row.user_id is not null then
    -- First open of the push-offered screen.
    update private.exit_offers set opened_at = p_now, client_id = p_client_id
      where user_id = v_uid and trigger = p_trigger;
    return jsonb_build_object('eligible', true, 'first_shown_at', v_row.first_shown_at, 'reason', null);
  end if;
  insert into private.exit_offers(user_id, trigger, first_shown_at, client_id, source, opened_at)
    values (v_uid, p_trigger, p_now, p_client_id, 'app', p_now);
  -- An in-app offer settles a pending store-side cancellation: no push afterwards.
  delete from private.cancel_offer_queue where user_id = v_uid;
  return jsonb_build_object('eligible', true, 'first_shown_at', p_now, 'reason', null);
end $$;
revoke all on function private.open_exit_offer_at(text, uuid, timestamptz) from public, anon, authenticated, service_role;

-- ───────────────────────────── BE-59 (c): offer_ending names the partner ─────────────────────
-- Body unchanged from BE-47b (20261111140000_offer_ending_tips.sql); new column partner_name =
-- the other current member's first name ('' if blank; the function fills a fallback). The return
-- type changes, so the function is dropped and re-created with the same grants.
drop function public.due_offer_endings(timestamptz);
create function public.due_offer_endings(p_now timestamptz default now())
returns table (user_id uuid, claim_id uuid, minutes_left integer, partner_name text)
language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r record; v_id uuid; v_claim uuid;
begin
  if p_now is null or not isfinite(p_now) then return; end if;
  for r in
    select o.couple_id, o.expires_at, m.user_id uid, (p_now at time zone p.timezone)::date push_date,
      coalesce((select private.first_name(pp.display_name) from public.couple_members pm
        join public.profiles pp on pp.id = pm.user_id
        where pm.couple_id = o.couple_id and pm.left_at is null and pm.user_id <> m.user_id
        limit 1), '') partner
    from public.couple_offers o
    join public.couples c on c.id = o.couple_id and c.status = 'active'
    join public.couple_members m on m.couple_id = o.couple_id and m.left_at is null
    join public.profiles p on p.id = m.user_id
    join public.notification_prefs np on np.user_id = m.user_id
    where o.kind = 'day3' and o.expires_at is not null
      and np.tips -- promotional: only with the in-app opt-in (App Store 4.5.4)
      and p_now >= o.expires_at - interval '2 hours' and p_now < o.expires_at - interval '30 minutes'
      and (select count(*) from public.couple_members x
        where x.couple_id = o.couple_id and x.left_at is null) = 2
      and not private.couple_premium_at(o.couple_id, p_now)
      and not private.couple_ever_premium(o.couple_id)
      and not (case when np.quiet_start < np.quiet_end
        then (p_now at time zone p.timezone)::time >= np.quiet_start
          and (p_now at time zone p.timezone)::time < np.quiet_end
        else (p_now at time zone p.timezone)::time >= np.quiet_start
          or (p_now at time zone p.timezone)::time < np.quiet_end end)
    order by o.couple_id, m.user_id
  loop
    -- Same per-user lock as every other push claim (shared four/day cap).
    perform pg_advisory_xact_lock(hashtext(r.uid::text));
    v_id := null;
    insert into private.offer_reminders(couple_id, kind, user_id, created_at)
      values (r.couple_id, 'day3', r.uid, p_now) on conflict do nothing returning id into v_id;
    if v_id is null then continue; end if;
    select cp.claim_id into v_claim
      from private.claim_push(r.uid, 'offer_ending', v_id, null, r.push_date, p_now) cp;
    if v_claim is null then
      delete from private.offer_reminders where id = v_id;
      continue;
    end if;
    user_id := r.uid; claim_id := v_claim;
    minutes_left := ceil(extract(epoch from (r.expires_at - p_now)) / 60)::integer;
    partner_name := r.partner;
    return next;
  end loop;
end $$;
revoke all on function public.due_offer_endings(timestamptz) from public, anon, authenticated;
grant execute on function public.due_offer_endings(timestamptz) to service_role;
