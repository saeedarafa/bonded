-- BE-28 (D36): invite_link() mints a fresh link token for the caller's current invite without
-- replacing the code or earlier links (CONTRACTS §2).
--   * private.invite_tokens held one hash per invite (invite_id was the primary key). It now holds
--     several: one from create_invite plus up to 10 from invite_link. Existing rows are kept as they
--     are, so links already shared keep working.
--   * private.resolve_invite already accepts a token when ANY hash of that invite matches (exists),
--     so accept_invite / invite_preview need no change and keep the D02 rules: a valid token skips
--     the limiter, a wrong token is INVALID_CODE.
--   * create_invite still revokes the previous invite; resolve_invite only looks at unrevoked
--     invites, so every token of the old invite stops working with it. purge_pairing_data deletes
--     the hashes by cascade a week later.

-- ───────────────────────────── private.invite_tokens: many per invite ─────────────────────────────
alter table private.invite_tokens drop constraint invite_tokens_pkey;
alter table private.invite_tokens
  add column id         bigint generated always as identity primary key,
  add column created_at timestamptz not null default now();
create index invite_tokens_by_invite on private.invite_tokens (invite_id);
create unique index invite_tokens_hash on private.invite_tokens (token_hash);
-- Still no client access: private schema, RLS on, no policy (unchanged from BE-04).
alter table private.invite_tokens enable row level security;
revoke all on private.invite_tokens from public, anon, authenticated;

-- ───────────────────────────── invite_link ─────────────────────────────
-- The caller's open invite = inviter is the caller, not revoked, not accepted, not expired, and it
-- belongs to the caller's current couple. None → SQL null (the app then calls create_invite).
-- At most 10 invite_link tokens per invite (11 with create_invite's) → RATE_LIMITED.
create or replace function private.invite_link_at(p_now timestamptz) returns public.invite_created
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_inv   pair_invites;
  v_token text;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  select * into v_inv from pair_invites
   where inviter_id = auth.uid() and accepted_at is null and revoked_at is null
     and expires_at > p_now and couple_id is not null and couple_id = private.my_couple_id()
   for update;  -- serialises concurrent calls so the cap holds
  if not found then return null; end if;
  if (select count(*) from private.invite_tokens where invite_id = v_inv.id) >= 11 then
    perform private.raise_error('RATE_LIMITED');
  end if;
  v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');  -- 192 bits
  insert into private.invite_tokens (invite_id, token_hash, created_at)
    values (v_inv.id, digest(v_token, 'sha256'), p_now);
  return row(v_inv.code, v_inv.expires_at, v_token)::public.invite_created;
end $$;
revoke all on function private.invite_link_at(timestamptz) from public, anon, authenticated;

create function public.invite_link() returns public.invite_created
language plpgsql security definer set search_path = public as $$
begin
  return private.invite_link_at(now());
end $$;
revoke all on function public.invite_link() from public, anon;
grant execute on function public.invite_link() to authenticated;

