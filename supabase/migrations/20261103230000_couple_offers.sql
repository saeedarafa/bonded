-- BE-17 / D28: a shared, server-owned offer clock; never grants an entitlement.
create table public.couple_offers (
  couple_id uuid not null references public.couples(id) on delete cascade,
  kind text not null check (kind in ('intro', 'winback')),
  first_shown_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (couple_id, kind),
  check (isfinite(first_shown_at) and expires_at = first_shown_at + interval '24 hours')
);
alter table public.couple_offers enable row level security;
revoke all on public.couple_offers from public, anon, authenticated;
grant select on public.couple_offers to authenticated;
create policy "members read own offer clock" on public.couple_offers for select to authenticated
  using (couple_id = private.my_couple_id());

-- Tests pin the clock here; clients can only call the parameterless-clock wrapper.
create function private.get_offer_at(p_kind text, p_now timestamptz) returns jsonb
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid := private.my_couple_id();
  v_timezone text;
  v_paired_at timestamptz;
  v_members int;
  v_offer couple_offers;
  v_premium boolean;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  -- Serializes partners' first calls and unpair/accept; recheck membership after waiting.
  select timezone into v_timezone from couples where id = v_couple and status = 'active' for update;
  if not found or not exists (select 1 from couple_members where couple_id = v_couple
    and user_id = auth.uid() and left_at is null) then
    perform private.raise_error('NOT_PAIRED');
  end if;
  if p_kind is null or p_kind not in ('intro', 'winback') then
    return jsonb_build_object('eligible', false, 'expires_at', null);
  end if;
  select count(*), max(joined_at) into v_members, v_paired_at
    from couple_members where couple_id = v_couple and left_at is null;
  select exists (select 1 from couple_members m join entitlements e on e.user_id = m.user_id
    where m.couple_id = v_couple and m.left_at is null and e.is_active
      and (e.expires_at is null or e.expires_at > p_now)) into v_premium;
  select * into v_offer from couple_offers where couple_id = v_couple and kind = p_kind;
  if found then
    return jsonb_build_object('eligible', v_members = 2 and not v_premium and p_now < v_offer.expires_at,
      'expires_at', v_offer.expires_at);
  end if;
  -- Intro is available after pairing. Win-back is first shown on pairing's third
  -- local calendar day (pairing day = day 1); an existing clock may cross midnight.
  if v_members <> 2 or v_premium or p_now < v_paired_at
    or (p_kind = 'winback' and (p_now at time zone v_timezone)::date
      <> (v_paired_at at time zone v_timezone)::date + 2) then
    return jsonb_build_object('eligible', false, 'expires_at', null);
  end if;
  insert into couple_offers (couple_id, kind, first_shown_at, expires_at)
    values (v_couple, p_kind, p_now, p_now + interval '24 hours') returning * into v_offer;
  return jsonb_build_object('eligible', true, 'expires_at', v_offer.expires_at);
end $$;
revoke all on function private.get_offer_at(text, timestamptz) from public, anon, authenticated, service_role;

create function public.get_offer(p_kind text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  return private.get_offer_at(p_kind, now());
end $$;
revoke all on function public.get_offer(text) from public, anon;
grant execute on function public.get_offer(text) to authenticated;
