-- BE-63 (SEC-22 Low on #420, lead decision): enforce D61 "one discount per person".
-- A person who already paid a discounted first year (`yearly_day3` 50% or `yearly_exit30` 30%)
-- must not get the 30% cancel offer later (for example when cancelling in their second, full-price
-- year). The server never reads product ids (CONTRACTS §6): the fact comes from the canonical
-- RevenueCat snapshot. In this subscription group the only intro prices are the discounted first
-- years (the `yearly` free trial is period_type `trial`), so any change with period_type `intro`
-- means "this person used a discount". It is recorded on the person in
-- `private.premium_history.discount_seen_at` (never cleared; removed with the account).
-- `queue_cancel_offer`, `due_cancel_offers` and `open_exit_offer_at('cancel')` refuse such a
-- person (open_exit_offer reason `discount_used`).
-- Residual gap (accepted): a discounted first year bought anonymously whose intro snapshot never
-- reached a uid (`revenuecat-sync` after sign-in normally closes it). No backfill: period_type was
-- never stored, and there are no real users before launch.

alter table private.premium_history
  add column discount_seen_at timestamptz
    check (discount_seen_at is null or isfinite(discount_seen_at));

-- ───────────────────────────── recording ─────────────────────────────
-- Called by apply_revenuecat_event after the entitlement write (same transaction). Records every
-- user of p_changes whose snapshot shows an intro period, active or not, stale or not (an old
-- snapshot that shows an intro period is still proof of the discount). Idempotent: the first
-- time seen is kept. Unknown users are skipped (premium_history references profiles).
create function private.record_discount_seen(p_occurred_at timestamptz, p_changes jsonb)
returns void language sql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
  insert into private.premium_history(user_id, first_seen_at, discount_seen_at)
    select distinct x.user_id, p_occurred_at, p_occurred_at
    from jsonb_to_recordset(p_changes) as x(user_id uuid, period_type text)
    join public.profiles p on p.id = x.user_id
    where x.period_type = 'intro'
  on conflict (user_id) do update
    set discount_seen_at = coalesce(private.premium_history.discount_seen_at, excluded.discount_seen_at)
    where private.premium_history.discount_seen_at is null;
$$;
revoke all on function private.record_discount_seen(timestamptz, jsonb) from public, anon, authenticated, service_role;

-- Same signature and grants as BE-48c (20261111160000); records the discount after the write.
-- The private function validates the input (INVALID_WEBHOOK rolls the whole call back) and returns
-- early on a replayed event id; recording again on a replay is a no-op.
create or replace function public.apply_revenuecat_event(
  p_event_id text, p_occurred_at timestamptz, p_changes jsonb
) returns void language sql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.assert_canonical_revenuecat_ids(p_changes);
  select private.apply_revenuecat_event(p_event_id, p_occurred_at, p_changes);
  select private.record_discount_seen(p_occurred_at, p_changes);
$$;
revoke all on function public.apply_revenuecat_event(text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_revenuecat_event(text,timestamptz,jsonb) to service_role;

create function private.discount_used(p_user uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select exists (select 1 from private.premium_history h
    where h.user_id = p_user and h.discount_seen_at is not null)
$$;
revoke all on function private.discount_used(uuid) from public, anon, authenticated, service_role;

-- ───────────────────────────── queue_cancel_offer ─────────────────────────────
-- Body of BE-62 (20261113190000_cancel_offer_push.sql) plus: refused (nothing queued) when the
-- person already used a discount.
create or replace function public.queue_cancel_offer(p_user uuid, p_cancelled boolean, p_now timestamptz default now())
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
    or private.discount_used(p_user)
    or not private.cancel_offer_running(p_user, p_now) then
    return false;
  end if;
  insert into private.cancel_offer_queue(user_id, queued_at) values (p_user, p_now)
    on conflict (user_id) do nothing returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.queue_cancel_offer(uuid, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.queue_cancel_offer(uuid, boolean, timestamptz) to service_role;

-- ───────────────────────────── due_cancel_offers ─────────────────────────────
-- Body of BE-62 plus: a queued person who has since used a discount is dropped, never sent.
create or replace function public.due_cancel_offers(p_now timestamptz default now())
returns table (user_id uuid, claim_id uuid, partner_name text)
language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r record; v_claim uuid; v_row text;
begin
  if p_now is null or not isfinite(p_now) then return; end if;
  delete from private.cancel_offer_queue q
    where not private.cancel_offer_running(q.user_id, p_now)
      or private.discount_used(q.user_id)
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
    -- Re-checked under the lock: a webhook recording the discount may have run meanwhile.
    if private.discount_used(r.uid) then
      delete from private.cancel_offer_queue q where q.id = r.qid;
      continue;
    end if;
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

-- ───────────────────────────── open_exit_offer('cancel') ─────────────────────────────
-- Body of BE-62 plus: `cancel` is refused with reason `discount_used` (after `no_subscription`)
-- when the person already used a discount. A refusal writes nothing (an unopened push row stays
-- unopened). Rows already shown keep answering as before (shown_before / same client_id retry).
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
    -- D61: one discount per person (a discounted first year was already paid).
    elsif private.discount_used(v_uid) then
      v_reason := 'discount_used';
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
