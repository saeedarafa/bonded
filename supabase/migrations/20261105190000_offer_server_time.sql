-- BE-17 / #124: return the same server clock used for offer eligibility.
-- Existing shared clocks, permissions and private eligibility logic are unchanged.
create or replace function public.get_offer(p_kind text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  return private.get_offer_at(p_kind, now())
    || jsonb_build_object('server_now', now());
end $$;
