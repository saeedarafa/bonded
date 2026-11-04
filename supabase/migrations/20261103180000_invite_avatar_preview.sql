-- BE-20b / D06: the Edge Function exchanges a valid invite-link capability for a
-- minimal preview and a canonical private avatar path. No typed-code bypass.
create or replace function private.invite_preview_for_link_at(
  p_code text, p_token text, p_now timestamptz
) returns json
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  r record;
  v_inv public.pair_invites;
  v_couple public.couples;
  v_name text;
  v_path text;
begin
  -- Match only the 192-bit URL-safe capabilities we issue; all invalid states
  -- return null, without names, paths, error distinctions or failed-attempt resets.
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32}$'
     or p_code is null or char_length(p_code) > 32 then return null; end if;
  select * into r from private.resolve_invite(p_code, p_token, p_now);
  if not r.token_ok or r.err is not null then return null; end if;
  select * into v_inv from public.pair_invites where id = r.invite_id;
  if not found or v_inv.expires_at <= p_now or v_inv.accepted_at is not null
     or v_inv.revoked_at is not null then return null; end if;
  select * into v_couple from public.couples where id = v_inv.couple_id;
  if not found or v_couple.status <> 'active'
     or (select count(*) from public.couple_members
          where couple_id = v_couple.id and left_at is null) <> 1
     or not exists (select 1 from public.couple_members
          where couple_id = v_couple.id and user_id = v_inv.inviter_id and left_at is null)
  then return null; end if;

  select left(split_part(btrim(display_name), ' ', 1), 30) into v_name
    from public.profiles where id = v_inv.inviter_id;
  -- Never use profiles.avatar_url or a caller-supplied path/host.
  select name into v_path from storage.objects
   where bucket_id = 'avatars' and name = v_inv.inviter_id::text || '/avatar.jpg';
  return json_build_object(
    'preview', json_build_object(
      'inviter_name', v_name,
      'inviter_avatar_url', null,
      'inviter_answered_today', exists (
        select 1 from public.couple_questions cq join public.answers a on a.couple_question_id = cq.id
         where cq.couple_id = v_couple.id and cq.source = 'daily'
           and cq.assigned_for = (p_now at time zone v_couple.timezone)::date
           and a.user_id = v_inv.inviter_id),
      'expires_at', v_inv.expires_at),
    'avatar_path', v_path);
end $$;
revoke all on function private.invite_preview_for_link_at(text, text, timestamptz)
  from public, anon, authenticated, service_role;

-- No caller clock or user-id argument; only the Edge service role can exchange a link.
create or replace function public.invite_preview_for_link(p_code text, p_token text)
returns json language sql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.invite_preview_for_link_at(p_code, p_token, now())
$$;
revoke all on function public.invite_preview_for_link(text, text) from public, anon, authenticated;
grant execute on function public.invite_preview_for_link(text, text) to service_role;
