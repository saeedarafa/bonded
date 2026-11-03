-- BE-08: PostgREST exposes only public functions. Keep the locked implementation private,
-- but give the service-role Edge Function a narrow public RPC entry point.
create or replace function public.claim_push(
  p_user uuid, p_type public.push_type, p_record uuid, p_cq uuid, p_local_date date, p_now timestamptz
) returns table (claim_id uuid, suppressed_reason text)
language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select * from private.claim_push(p_user, p_type, p_record, p_cq, p_local_date, p_now)
$$;
revoke all on function public.claim_push(uuid, public.push_type, uuid, uuid, date, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_push(uuid, public.push_type, uuid, uuid, date, timestamptz)
  to service_role;
