-- BE-47 / D52: the day-3 gift. One offer per couple ever, earned with the couple's first 3-day
-- streak badge (D19) on the free plan by a couple in which nobody has ever subscribed, trialled or
-- used an introductory offer. Its real 12-hour clock starts when either partner first opens it,
-- and is never extended. One `offer_ending` push 2 h before the end (D24 cap, quiet hours).
-- The server never grants premium from an offer: the purchase is the RevenueCat offering `day3`
-- and premium arrives only through the webhook (CONTRACTS §6).
-- Retires the D28 gift after pairing (`intro`) and the day-3 win-back (`winback`): no new rows;
-- clocks already started keep reading as before until they end.
-- No answer or message text is read or stored.

alter type public.push_type add value if not exists 'offer_ending';

-- ───────────────────────────── Durable purchase history ─────────────────────────────
-- BE-48's private.subscription_trials holds only a running trial (cleared on conversion/expiry),
-- so it can't answer "has this person ever subscribed or trialled". RevenueCat keeps an expired
-- entitlement with its product id in the canonical snapshot, so any entitlement row that was ever
-- active or carried a product id means a purchase (normal, trial, intro or prepaid) happened.
-- Private: a partner must not learn about the other's past purchases from it.
create table private.premium_history (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  first_seen_at timestamptz not null
);
alter table private.premium_history enable row level security;
revoke all on private.premium_history from public, anon, authenticated, service_role;

create function private.record_premium_history() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if new.is_active or new.product_id is not null then
    insert into private.premium_history(user_id, first_seen_at)
      values (new.user_id, coalesce(new.updated_at, now()))
      on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.record_premium_history() from public, anon, authenticated, service_role;
create trigger entitlements_premium_history after insert or update on public.entitlements
  for each row execute function private.record_premium_history();

-- A trial row always comes with an entitlement row; recorded too so the rule never depends on it.
create function private.record_trial_history() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  insert into private.premium_history(user_id, first_seen_at)
    values (new.user_id, new.started_at) on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function private.record_trial_history() from public, anon, authenticated, service_role;
create trigger subscription_trials_premium_history after insert or update on private.subscription_trials
  for each row execute function private.record_trial_history();

insert into private.premium_history(user_id, first_seen_at)
  select user_id, min(at) from (
    select user_id, updated_at at from public.entitlements where is_active or product_id is not null
    union all select user_id, started_at from private.subscription_trials
  ) h group by user_id
  on conflict (user_id) do nothing;

-- ───────────────────────────── couple_offers kind `day3` ─────────────────────────────
-- day3 rows: earned_at = when the couple earned its first 3-day badge; first_opened_at and
-- expires_at stay null until the first open, then expires_at = first_opened_at + 12 h, forever.
-- first_shown_at is the D28 clock start and stays null for day3. intro/winback rows unchanged.
alter table public.couple_offers
  alter column first_shown_at drop not null,
  alter column expires_at drop not null,
  add column earned_at timestamptz,
  add column first_opened_at timestamptz,
  drop constraint couple_offers_kind_check,
  drop constraint couple_offers_check;
alter table public.couple_offers
  add constraint couple_offers_kind_check check (kind in ('intro', 'winback', 'day3')),
  add constraint couple_offers_clock_check check (coalesce(case when kind = 'day3' then
      first_shown_at is null and earned_at is not null and isfinite(earned_at)
      and ((first_opened_at is null and expires_at is null)
        or (first_opened_at is not null and isfinite(first_opened_at)
          and first_opened_at >= earned_at
          and expires_at = first_opened_at + interval '12 hours'))
    else
      earned_at is null and first_opened_at is null and first_shown_at is not null
      and isfinite(first_shown_at) and expires_at = first_shown_at + interval '24 hours'
    end, false));

-- Anyone in the couple ever subscribed/trialled (current members only).
create function private.couple_ever_premium(p_couple uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select exists (select 1 from public.couple_members m join private.premium_history h
    on h.user_id = m.user_id where m.couple_id = p_couple and m.left_at is null)
$$;
revoke all on function private.couple_ever_premium(uuid) from public, anon, authenticated, service_role;

-- Premium at a pinned instant (current members), same rule as private.is_couple_premium.
create function private.couple_premium_at(p_couple uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select exists (select 1 from public.couple_members m join public.entitlements e
    on e.user_id = m.user_id where m.couple_id = p_couple and m.left_at is null
      and e.is_active and (e.expires_at is null or e.expires_at > p_now))
$$;
revoke all on function private.couple_premium_at(uuid, timestamptz) from public, anon, authenticated, service_role;

-- Earned with the couple's first `streak-3` award (unique per couple, so a broken streak gets it
-- the first time it reaches 3). Never raises: the answer that advanced the streak must not fail.
create function private.create_day3_offer() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_members uuid[];
begin
  select array_agg(m.user_id order by m.user_id) into v_members
    from public.couple_members m join public.couples c on c.id = m.couple_id
    where m.couple_id = new.couple_id and m.left_at is null and c.status = 'active';
  if coalesce(cardinality(v_members), 0) <> 2
    or private.couple_premium_at(new.couple_id, new.awarded_at)
    or private.couple_ever_premium(new.couple_id)
    -- Once per couple = once per pair of people: unpairing and re-pairing doesn't earn another.
    or exists (select 1 from public.couple_offers o
      join public.couple_members a on a.couple_id = o.couple_id and a.user_id = v_members[1]
      join public.couple_members b on b.couple_id = o.couple_id and b.user_id = v_members[2]
      where o.kind = 'day3') then
    return new;
  end if;
  insert into public.couple_offers(couple_id, kind, earned_at)
    values (new.couple_id, 'day3', new.awarded_at) on conflict do nothing;
  return new;
end $$;
revoke all on function private.create_day3_offer() from public, anon, authenticated, service_role;
create trigger badge_awards_day3_offer after insert on public.badge_awards
  for each row when (new.badge_slug = 'streak-3' and new.couple_id is not null)
  execute function private.create_day3_offer();

-- ───────────────────────────── Read and open ─────────────────────────────
-- One body for get (p_open = false, never writes) and open (starts the day3 clock once).
create function private.offer_at(p_kind text, p_now timestamptz, p_open boolean) returns jsonb
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid := private.my_couple_id();
  v_members int;
  v_offer couple_offers;
  v_live boolean;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  -- Serializes partners' first opens and unpair/accept; recheck membership after waiting.
  perform 1 from couples where id = v_couple and status = 'active' for update;
  if not found or not exists (select 1 from couple_members where couple_id = v_couple
    and user_id = auth.uid() and left_at is null) then
    perform private.raise_error('NOT_PAIRED');
  end if;
  if p_kind is null or p_kind not in ('intro', 'winback', 'day3') then
    return jsonb_build_object('eligible', false, 'expires_at', null);
  end if;
  select count(*) into v_members from couple_members where couple_id = v_couple and left_at is null;
  select * into v_offer from couple_offers where couple_id = v_couple and kind = p_kind;
  if p_kind <> 'day3' then
    -- Retired (D52): an existing clock reads as before; nothing new starts.
    return jsonb_build_object('eligible', found and v_members = 2
      and not private.couple_premium_at(v_couple, p_now) and p_now < v_offer.expires_at,
      'expires_at', v_offer.expires_at);
  end if;
  if not found then
    return jsonb_build_object('eligible', false, 'expires_at', null, 'first_opened_at', null);
  end if;
  v_live := v_members = 2 and p_now >= v_offer.earned_at
    and not private.couple_premium_at(v_couple, p_now) and not private.couple_ever_premium(v_couple)
    and (v_offer.expires_at is null or p_now < v_offer.expires_at);
  if p_open and v_live and v_offer.first_opened_at is null then
    update couple_offers set first_opened_at = p_now, expires_at = p_now + interval '12 hours'
      where couple_id = v_couple and kind = 'day3' returning * into v_offer;
  end if;
  return jsonb_build_object('eligible', v_live, 'expires_at', v_offer.expires_at,
    'first_opened_at', v_offer.first_opened_at);
end $$;
revoke all on function private.offer_at(text, timestamptz, boolean) from public, anon, authenticated, service_role;

-- Same signature as BE-17 (tests pin the clock here); no longer starts intro/winback clocks.
create or replace function private.get_offer_at(p_kind text, p_now timestamptz) returns jsonb
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  return private.offer_at(p_kind, p_now, false);
end $$;
revoke all on function private.get_offer_at(text, timestamptz) from public, anon, authenticated, service_role;

create function private.open_offer_at(p_kind text, p_now timestamptz) returns jsonb
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  return private.offer_at(p_kind, p_now, true);
end $$;
revoke all on function private.open_offer_at(text, timestamptz) from public, anon, authenticated, service_role;

create function public.open_offer(p_kind text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  return private.open_offer_at(p_kind, now()) || jsonb_build_object('server_now', now());
end $$;
revoke all on function public.open_offer(text) from public, anon;
grant execute on function public.open_offer(text) to authenticated;

-- ───────────────────────────── One full-screen offer per person per day ─────────────────────────────
-- The app claims before presenting an unsolicited full-screen offer (gift 14, paywall 16, ...).
-- Local day = the caller's profile timezone. Retrying the same screen the same day returns true.
create table private.offer_screens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  screen text not null check (screen ~ '^[a-z0-9_]{1,32}$'),
  shown_at timestamptz not null,
  primary key (user_id, local_date)
);
alter table private.offer_screens enable row level security;
revoke all on private.offer_screens from public, anon, authenticated, service_role;

create function private.claim_offer_screen_at(p_screen text, p_now timestamptz) returns boolean
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_date date; v_screen text;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if p_screen is null or p_screen !~ '^[a-z0-9_]{1,32}$' or p_now is null or not isfinite(p_now) then
    return false;
  end if;
  select (p_now at time zone timezone)::date into v_date from profiles where id = v_uid;
  if v_date is null then return false; end if;
  delete from private.offer_screens where user_id = v_uid and local_date < v_date - 1;
  insert into private.offer_screens(user_id, local_date, screen, shown_at)
    values (v_uid, v_date, p_screen, p_now) on conflict do nothing returning screen into v_screen;
  if v_screen is not null then return true; end if;
  return exists (select 1 from private.offer_screens
    where user_id = v_uid and local_date = v_date and screen = p_screen);
end $$;
revoke all on function private.claim_offer_screen_at(text, timestamptz) from public, anon, authenticated, service_role;

create function public.claim_offer_screen(p_screen text) returns boolean
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  return private.claim_offer_screen_at(p_screen, now());
end $$;
revoke all on function public.claim_offer_screen(text) from public, anon;
grant execute on function public.claim_offer_screen(text) to authenticated;

-- ───────────────────────────── `offer_ending` push ─────────────────────────────
-- One per partner and offer, whatever happens to devices or caps.
create table private.offer_reminders (
  couple_id uuid not null references public.couples(id) on delete cascade,
  kind text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  primary key (couple_id, kind, user_id)
);
alter table private.offer_reminders enable row level security;
revoke all on private.offer_reminders from public, anon, authenticated, service_role;

-- Due 2 h before the end; window until 30 min before the end, at the first 15-minute tick outside
-- the recipient's quiet hours. D24 four/day cap via private.claim_push; a cap-blocked claim is
-- released and retried inside the window. Skipped once the couple is Premium (or anyone in it ever
-- subscribed), solo or ended. No preference toggle (D52 decision; see CONTRACTS §3).
create function public.due_offer_endings(p_now timestamptz default now())
returns table (user_id uuid, claim_id uuid, minutes_left integer)
language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r record; v_id uuid; v_claim uuid;
begin
  if p_now is null or not isfinite(p_now) then return; end if;
  for r in
    select o.couple_id, o.expires_at, m.user_id uid, (p_now at time zone p.timezone)::date push_date
    from public.couple_offers o
    join public.couples c on c.id = o.couple_id and c.status = 'active'
    join public.couple_members m on m.couple_id = o.couple_id and m.left_at is null
    join public.profiles p on p.id = m.user_id
    join public.notification_prefs np on np.user_id = m.user_id
    where o.kind = 'day3' and o.expires_at is not null
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
    return next;
  end loop;
end $$;
revoke all on function public.due_offer_endings(timestamptz) from public, anon, authenticated;
grant execute on function public.due_offer_endings(timestamptz) to service_role;
