-- BE-62 (a) / D61: the 30% offer is only for people cancelling. The `paywall_close` trigger of
-- `open_exit_offer` is retired: × on P3/16 behaves as before D57 (P3 closes; 16 opens 17).
-- The public RPC now raises `OFFER_RETIRED` for `paywall_close`; `cancel` is unchanged.
-- Existing `private.exit_offers` rows with trigger `paywall_close` stay (history; BE-62 (b) uses
-- them to bar the day-3 gift), so the table's check constraint keeps the value.
-- No answer or message text is read or stored.

alter type public.error_code add value if not exists 'OFFER_RETIRED';

create or replace function public.open_exit_offer(p_trigger text, p_client_id uuid default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  -- D61: retired trigger. Raised (not a `reason`) so an old app build learns it at once and
  -- writes nothing; the app shows 17 (16) or closes (P3) as before D57.
  if p_trigger = 'paywall_close' then perform private.raise_error('OFFER_RETIRED'); end if;
  return private.open_exit_offer_at(p_trigger, p_client_id, now()) || jsonb_build_object('server_now', now());
end $$;
revoke all on function public.open_exit_offer(text, uuid) from public, anon;
grant execute on function public.open_exit_offer(text, uuid) to authenticated;
