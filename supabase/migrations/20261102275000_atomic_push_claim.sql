-- BE-08 follow-up: serialize every recipient's cap/group decision before claiming a push.
create or replace function private.claim_push(
  p_user uuid, p_type public.push_type, p_record uuid, p_cq uuid, p_local_date date, p_now timestamptz
) returns table (claim_id uuid, suppressed_reason text)
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_daily int; v_type int; v_group int; v_cap int;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  select count(*) into v_daily from public.push_log where user_id=p_user and local_date=p_local_date and status in ('claimed','sent');
  if v_daily >= 4 then return query select null::uuid, 'daily_cap'::text; return; end if;
  v_cap := case p_type when 'partner_answered' then 1 when 'both_answered' then 1 when 'nudge' then 1 when 'partner_joined' then 1 when 'partner_premium' then 1 else null end;
  select count(*) into v_type from public.push_log where user_id=p_user and local_date=p_local_date and type=p_type and status in ('claimed','sent');
  if v_cap is not null and v_type >= v_cap then return query select null::uuid, 'type_cap'::text; return; end if;
  if p_type = 'thread_activity' then
    select count(*) into v_group from public.push_log where user_id=p_user and type=p_type and couple_question_id is not distinct from p_cq and created_at >= p_now - interval '5 minutes' and status in ('claimed','sent');
    if v_group > 0 then return query select null::uuid, 'grouped'::text; return; end if;
  end if;
  insert into public.push_log (user_id,type,record_id,couple_question_id,local_date,created_at) values (p_user,p_type,p_record,p_cq,p_local_date,p_now)
    on conflict (user_id,type,record_id) do nothing returning id into claim_id;
  if claim_id is null then return query select null::uuid, 'duplicate'::text; else return query select claim_id, null::text; end if;
end $$;
revoke all on function private.claim_push(uuid,public.push_type,uuid,uuid,date,timestamptz) from public, anon, authenticated;
grant execute on function private.claim_push(uuid,public.push_type,uuid,uuid,date,timestamptz) to service_role;
