-- BE-59 / D57: exit offers. Two one-time offer screens per person, ever:
--   `paywall_close`: the person's first × on P3/16 opens the 30% exit offer sheet (offering `exit30`)
--                    instead of 17;
--   `cancel`:        Settings → Manage subscription first shows one 30% offer screen (iOS promotional
--                    offer `cancel30`) with "Continue to cancel".
-- The server is the first gate (this RPC), the store/RevenueCat eligibility on the phone the second.
-- Nothing here grants premium: purchases arrive only through the RevenueCat webhook (CONTRACTS §6).
-- No answer or message text is read or stored.

-- ───────────────────────────── State ─────────────────────────────
-- One row per person and trigger once the offer was shown. No client access at all (the RPC
-- returns everything the app needs); removed with the account (profiles cascade from auth.users).
create table private.exit_offers (
  user_id uuid not null references public.profiles(id) on delete cascade,
  trigger text not null check (trigger in ('paywall_close', 'cancel')),
  first_shown_at timestamptz not null check (isfinite(first_shown_at)),
  -- The app's idempotency key for the call that showed it: a retry with the same key gets the
  -- same `eligible: true` answer (lost response); any other call gets `shown_before`.
  client_id uuid,
  primary key (user_id, trigger)
);
alter table private.exit_offers enable row level security;
revoke all on private.exit_offers from public, anon, authenticated, service_role;

-- ───────────────────────────── Helpers ─────────────────────────────
-- The couple's day-3 gift is live: same rule as `get_offer('day3').eligible` (private.offer_at),
-- i.e. earned, not ended, two current members, nobody Premium and nobody ever subscribed.
-- An earned gift that was never opened has no clock yet and counts as live.
create function private.day3_live_at(p_couple uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select exists (select 1 from public.couple_offers o
      where o.couple_id = p_couple and o.kind = 'day3' and p_now >= o.earned_at
        and (o.expires_at is null or p_now < o.expires_at))
    and (select count(*) from public.couple_members m
      where m.couple_id = p_couple and m.left_at is null) = 2
    and not private.couple_premium_at(p_couple, p_now)
    and not private.couple_ever_premium(p_couple)
$$;
revoke all on function private.day3_live_at(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ───────────────────────────── open_exit_offer ─────────────────────────────
-- Returns {eligible, first_shown_at, reason}. On `eligible: true` the offer counts as shown
-- (row written, and the D52 one-full-screen-offer-per-day slot claimed as `exit_<trigger>`).
-- A refusal writes nothing, so the person can still get the offer on a later close/cancel.
-- reason (null when eligible): `shown_before`, `premium`, `not_intro_eligible`, `gift_live`,
-- `no_subscription`, `daily_limit`, `unknown_trigger`.
create function private.open_exit_offer_at(p_trigger text, p_client_id uuid, p_now timestamptz)
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
  if found then
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

  insert into private.exit_offers(user_id, trigger, first_shown_at, client_id)
    values (v_uid, p_trigger, p_now, p_client_id);
  return jsonb_build_object('eligible', true, 'first_shown_at', p_now, 'reason', null);
end $$;
revoke all on function private.open_exit_offer_at(text, uuid, timestamptz) from public, anon, authenticated, service_role;

create function public.open_exit_offer(p_trigger text, p_client_id uuid default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  return private.open_exit_offer_at(p_trigger, p_client_id, now()) || jsonb_build_object('server_now', now());
end $$;
revoke all on function public.open_exit_offer(text, uuid) from public, anon;
grant execute on function public.open_exit_offer(text, uuid) to authenticated;
