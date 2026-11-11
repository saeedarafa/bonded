-- BE-54 (D46 amended, PO 2026-11-11): the daily voice upload cap is 35 per couple per local day
-- (answers + thread messages, both partners together), replacing BE-43's 20.
-- `start_voice_upload` is unchanged otherwise; VOICE_LIMIT details are {"max":35}.

create or replace function private.start_voice_upload_at(p_ext text, p_now timestamptz) returns text
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_couple public.couples;
  v_today  date;
  v_name   text;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  -- Parent lock: two partners taking the 35th slot at once are serialised here.
  select * into v_couple from public.couples
   where id = private.my_couple_id() and status = 'active' for update;
  if not found then perform private.raise_error('NOT_PAIRED'); end if;
  if not private.is_couple_premium(v_couple.id) then perform private.raise_error('PREMIUM_REQUIRED'); end if;
  if p_ext is null or p_ext not in ('m4a', 'aac', 'ogg', 'opus') then
    perform private.raise_error('INVALID_VOICE');
  end if;
  v_today := (p_now at time zone v_couple.timezone)::date;
  if (select count(*) from private.voice_uploads u
       where u.couple_id = v_couple.id and u.local_date = v_today) >= 35 then
    raise exception using message = 'VOICE_LIMIT', errcode = 'P0001', detail = '{"max":35}';
  end if;
  v_name := v_couple.id::text || '/' || v_uid::text || '/' || gen_random_uuid()::text || '.' || p_ext;
  insert into private.voice_uploads (name, couple_id, user_id, local_date, created_at)
    values (v_name, v_couple.id, v_uid, v_today, p_now);
  return v_name;
end $$;
revoke all on function private.start_voice_upload_at(text, timestamptz) from public, anon, authenticated, service_role;
