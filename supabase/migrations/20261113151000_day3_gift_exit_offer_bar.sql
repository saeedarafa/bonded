-- BE-62 (b) / D61 (4): one discount per person, ever. Whoever was offered the 30% (any exit-offer
-- row: `cancel`, a later cancellation push, or a historical `paywall_close`) never gets the 50%
-- day-3 gift; lead default for couples: if either current partner was offered it, the couple gets
-- no gift. `couple_ever_premium` is only used by the day-3 gift rules (earning trigger,
-- `get_offer`/`open_offer`, the `offer_ending` push, `day3_live_at`), so the bar goes there and
-- every one of those paths follows it. The name is kept to avoid redefining four functions.
-- No answer or message text is read or stored.

create or replace function private.couple_ever_premium(p_couple uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  -- Day-3 gift bar: anyone in the couple ever subscribed/trialled, or was ever offered the 30%
  -- (current members only).
  select exists (select 1 from public.couple_members m join private.premium_history h
      on h.user_id = m.user_id where m.couple_id = p_couple and m.left_at is null)
    or exists (select 1 from public.couple_members m join private.exit_offers x
      on x.user_id = m.user_id where m.couple_id = p_couple and m.left_at is null)
$$;
revoke all on function private.couple_ever_premium(uuid) from public, anon, authenticated, service_role;
