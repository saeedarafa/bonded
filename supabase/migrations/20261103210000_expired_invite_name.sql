-- BE-34 / D39: token-gated first name on expired invite previews.
-- Preserve actor locking, D02 accounting, public API grants and live-preview fields.
create or replace function private.invite_preview_at(p_code text, p_token text, p_now timestamptz)
returns json
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_actor  text := private.invite_actor();
  r        record;
  v_inv    pair_invites;
  v_couple couples;
  v_prof   profiles;
  v_error  jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_actor, 0));
  perform private.race_point('actor_locked');
  select * into r from private.resolve_invite(p_code, p_token, p_now);
  if not r.token_ok and private.invite_limited(v_actor, p_now) then
    perform private.raise_error('RATE_LIMITED');
  end if;
  if r.err is not null then return private.invite_fail(v_actor, r.err, p_now); end if;

  select * into v_inv from pair_invites where id = r.invite_id;
  select * into v_couple from couples where id = v_inv.couple_id;
  if not found or v_couple.status <> 'active'
     or (select count(*) from couple_members where couple_id = v_couple.id) >= 2 then
    return private.invite_fail(v_actor, 'COUPLE_FULL', p_now, not r.token_ok);
  end if;
  if v_inv.expires_at <= p_now then
    v_error := private.invite_fail(v_actor, 'INVITE_EXPIRED', p_now, not r.token_ok)::jsonb;
    -- D39: a matching link capability may disclose only the bounded first name.
    -- Resolution has already rejected wrong tokens, accepted and revoked invites.
    if r.token_ok then
      select left(split_part(btrim(display_name), ' ', 1), 30) into v_prof.display_name
        from profiles where id = v_inv.inviter_id;
      v_error := jsonb_set(v_error, '{details}', jsonb_build_object('inviter_name', v_prof.display_name));
    end if;
    return v_error::json;
  end if;

  select * into v_prof from profiles where id = v_inv.inviter_id;
  return json_build_object(
    'inviter_name', left(split_part(btrim(v_prof.display_name), ' ', 1), 30),
    'inviter_avatar_url', null,
    'inviter_answered_today', exists (
      select 1 from couple_questions cq join answers a on a.couple_question_id = cq.id
       where cq.couple_id = v_couple.id and cq.source = 'daily'
         and cq.assigned_for = (p_now at time zone v_couple.timezone)::date
         and a.user_id = v_inv.inviter_id),
    'expires_at', v_inv.expires_at);
end $$;

revoke all on function private.invite_preview_at(text, text, timestamptz)
  from public, anon, authenticated, service_role;
