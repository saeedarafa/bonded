-- BE-18: a transaction owns event dedupe, timestamp ordering, entitlement writes and dispatch.
-- Event metadata only: no webhook payload, subscriber attributes or purchase receipts.
revoke insert, update, delete on public.entitlements from anon, authenticated;

create table private.revenuecat_events (
  event_id text primary key check (char_length(event_id) between 1 and 200),
  record_id uuid not null default gen_random_uuid(),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
alter table private.revenuecat_events enable row level security;
revoke all on private.revenuecat_events from public, anon, authenticated, service_role;

create function private.apply_revenuecat_event(
  p_event_id text, p_occurred_at timestamptz, p_changes jsonb
) returns void language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_record uuid; v_change record; v_before jsonb; v_couple uuid; v_actor uuid;
begin
  -- Service-only grant below: a user JWT must never set its own subscription state.
  if p_event_id is null or char_length(p_event_id) not between 1 and 200
    or p_occurred_at is null or not isfinite(p_occurred_at)
    or jsonb_typeof(p_changes) is distinct from 'array'
    or jsonb_array_length(p_changes) not between 1 and 100 then
    raise exception 'INVALID_WEBHOOK' using errcode='22023';
  end if;
  -- Webhooks are low-volume; one lock also serializes transfers spanning several couples.
  -- Two-int advisory locks occupy a separate keyspace from recipient cap locks.
  perform pg_advisory_xact_lock(18018, 1);
  insert into private.revenuecat_events(event_id,occurred_at)
    values(p_event_id,p_occurred_at) on conflict do nothing returning record_id into v_record;
  if v_record is null then return; end if;

  select coalesce(jsonb_object_agg(c.id::text,private.is_couple_premium(c.id)), '{}'::jsonb)
    into v_before from public.couples c where c.status='active' and exists (
      select 1 from public.couple_members m
      join jsonb_to_recordset(p_changes) as x(user_id uuid) on x.user_id=m.user_id
      where m.couple_id=c.id and m.left_at is null
    );
  for v_change in select * from jsonb_to_recordset(p_changes) as x(
    user_id uuid,is_active boolean,product_id text,store text,expires_at timestamptz
  ) loop
    if v_change.user_id is null or v_change.is_active is null
      or char_length(v_change.product_id)>200 or char_length(v_change.store)>50
      or (v_change.expires_at is not null and not isfinite(v_change.expires_at)) then
      raise exception 'INVALID_WEBHOOK' using errcode='22023';
    end if;
    -- Deleted/unknown Auth users cannot be resurrected by delayed webhooks.
    insert into public.entitlements(user_id,is_active,product_id,store,expires_at,updated_at)
      select v_change.user_id,v_change.is_active,v_change.product_id,v_change.store,
        v_change.expires_at,p_occurred_at
      where exists(select 1 from public.profiles where id=v_change.user_id)
      on conflict(user_id) do update set is_active=excluded.is_active,
        product_id=excluded.product_id,store=excluded.store,expires_at=excluded.expires_at,
        updated_at=excluded.updated_at
      where public.entitlements.updated_at < excluded.updated_at;
  end loop;
  -- Compare the whole couple before/after the transfer, avoiding a transient off/on push.
  for v_couple in select key::uuid from jsonb_each(v_before) where value='false'::jsonb loop
    if not private.is_couple_premium(v_couple) then continue; end if;
    select m.user_id into v_actor from public.couple_members m
      join public.entitlements e on e.user_id=m.user_id
      where m.couple_id=v_couple and m.left_at is null and e.is_active
        and (e.expires_at is null or e.expires_at>now())
        and e.updated_at=p_occurred_at order by m.user_id limit 1;
    if v_actor is not null then
      perform private.dispatch_notify('partner_premium',v_record,v_couple,null,v_actor);
    end if;
  end loop;
end $$;
revoke all on function private.apply_revenuecat_event(text,timestamptz,jsonb) from public,anon,authenticated,service_role;
create function public.apply_revenuecat_event(p_event_id text,p_occurred_at timestamptz,p_changes jsonb)
returns void language sql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.apply_revenuecat_event(p_event_id,p_occurred_at,p_changes)
$$;
revoke all on function public.apply_revenuecat_event(text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_revenuecat_event(text,timestamptz,jsonb) to service_role;
