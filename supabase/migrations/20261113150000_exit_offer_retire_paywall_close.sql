-- BE-62 (a) / D61: the 30% offer is only for people cancelling. The `paywall_close` trigger of
-- `open_exit_offer` is retired: × on P3/16 behaves as before D57 (P3 closes; 16 opens 17).
-- The public RPC now refuses `paywall_close` with `{eligible: false, reason: 'trigger_retired'}`
-- (writes nothing, takes no day slot). A reason, not a new `error_code` value: an old app build
-- already treats an unknown reason as "not eligible" (shows 17), and the exhaustive error maps of
-- the app stay valid. `cancel` is unchanged.
-- Existing `private.exit_offers` rows with trigger `paywall_close` stay (history; BE-62 (b) uses
-- them to bar the day-3 gift), so the table's check constraint keeps the value.
-- No answer or message text is read or stored.

create or replace function public.open_exit_offer(p_trigger text, p_client_id uuid default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if p_trigger = 'paywall_close' then
    return jsonb_build_object('eligible', false, 'first_shown_at', null, 'reason', 'trigger_retired',
      'server_now', now());
  end if;
  return private.open_exit_offer_at(p_trigger, p_client_id, now()) || jsonb_build_object('server_now', now());
end $$;
revoke all on function public.open_exit_offer(text, uuid) from public, anon;
grant execute on function public.open_exit_offer(text, uuid) to authenticated;
