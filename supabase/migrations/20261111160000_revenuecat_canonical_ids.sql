-- BE-48c (#167, SEC-10 Medium): RevenueCat app user ids are case-sensitive, but a uuid cast
-- case-folds. The webhook used to look up an upper-case spelling of a uid as its own (empty)
-- RevenueCat subscriber and the write then landed on the real lower-case account, wiping its
-- premium. The webhook now ignores every non-canonical spelling; as defence in depth the
-- service-only RPC rejects any change whose user_id text is not the canonical lower-case uuid
-- (exactly what `uuid::text` prints), so no caller can write through another spelling.
create function private.assert_canonical_revenuecat_ids(p_changes jsonb)
returns void language plpgsql
set search_path = pg_catalog, pg_temp as $$
begin
  if jsonb_typeof(p_changes) = 'array' and exists (
    select 1 from jsonb_array_elements(p_changes) c
    where jsonb_typeof(c) is distinct from 'object'
      or jsonb_typeof(c->'user_id') is distinct from 'string'
      or (c->>'user_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  ) then
    raise exception 'INVALID_WEBHOOK' using errcode='22023';
  end if;
end $$;
revoke all on function private.assert_canonical_revenuecat_ids(jsonb) from public,anon,authenticated,service_role;

-- Same signature and grants; the check runs before the ledger claim, so a rejected event id is
-- not consumed. Other malformed input is still rejected by private.apply_revenuecat_event.
create or replace function public.apply_revenuecat_event(
  p_event_id text, p_occurred_at timestamptz, p_changes jsonb
) returns void language sql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.assert_canonical_revenuecat_ids(p_changes);
  select private.apply_revenuecat_event(p_event_id, p_occurred_at, p_changes);
$$;
revoke all on function public.apply_revenuecat_event(text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_revenuecat_event(text,timestamptz,jsonb) to service_role;
