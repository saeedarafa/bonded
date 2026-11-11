-- BE-47b (lead decision on #160, SEC-10 item 2): `offer_ending` is a promotional push (a
-- countdown for a discount), so it now needs the recipient's in-app opt-in `notification_prefs.tips`
-- (default false; App Store guideline 4.5.4 asks for explicit opt-in and an in-app opt-out).
-- `trial_ending` stays transactional (no toggle). Body otherwise unchanged from BE-47
-- (20261111130000_day3_offer.sql): 2 h before the end, 30 min window close, quiet hours, D24 cap
-- via private.claim_push with release/retry, once per partner and offer.
-- A partner with tips off is skipped without a ledger row, so turning tips on inside the window
-- still sends it at the next tick.

create or replace function public.due_offer_endings(p_now timestamptz default now())
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
    return next;
  end loop;
end $$;
revoke all on function public.due_offer_endings(timestamptz) from public, anon, authenticated;
grant execute on function public.due_offer_endings(timestamptz) to service_role;
