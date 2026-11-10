-- BE-40: reactions are real system emoji (D45, supersedes D14; CONTRACTS §2).
--   `reactions.kind` holds exactly ONE emoji (one grapheme cluster, emoji only, ≤ 16 code points,
--   ≤ 64 bytes), validated here and never only in the app. Still one reaction per user per target
--   (the unique constraints from BE-05 are unchanged): another emoji = upsert, same emoji = delete.
--   A bare U+2764 is stored as ❤️ (U+2764 U+FE0F); both count as "love" (Hearts-given badge).
--   Old rows migrate love→❤️ laugh→😂 wow→😮 spark→🔥 (lead default).
--   Invalid input raises exactly INVALID_REACTION (new code, CONTRACTS §2).

-- New code in the catalogue (CONTRACTS §2). The trigger raises the literal (not via
-- private.raise_error) because a value added by ALTER TYPE can't be used in the same transaction.
alter type public.error_code add value if not exists 'INVALID_REACTION';

-- ───────────────────────────── Validator ─────────────────────────────
-- Code points that may start an emoji element. BMP: the Unicode `Emoji` property (Emoji 15.1)
-- without ASCII digits/#/* (keycaps only) — stable, new emoji are almost all in the SMP. SMP: the
-- `Extended_Pictographic` ranges (they include code points reserved for future emoji, so a newer
-- phone's picker keeps working) minus skin-tone modifiers, regional indicators and tags, which are
-- only valid inside a sequence.
create or replace function private.is_emoji_base(cp integer) returns boolean
language sql immutable strict parallel safe set search_path = pg_catalog as $$
  select case
    when cp < 169 then false
    when cp < 65536 then
      cp in (169, 174, 8252, 8265, 8482, 8505, 9000, 9167, 9410, 9654, 9664, 9742, 9745, 9752,
             9757, 9760, 9766, 9770, 9792, 9794, 9851, 9881, 9895, 9928, 9937, 9981, 9986, 9989,
             9999, 10002, 10004, 10006, 10013, 10017, 10024, 10052, 10055, 10060, 10062, 10071,
             10145, 10160, 10175, 11088, 11093, 12336, 12349, 12951, 12953)
      or cp between 8596 and 8601     -- ↔ … ↙
      or cp between 8617 and 8618     -- ↩ ↪
      or cp between 8986 and 8987     -- ⌚ ⌛
      or cp between 9193 and 9203     -- ⏩ … ⏳
      or cp between 9208 and 9210     -- ⏸ ⏹ ⏺
      or cp between 9642 and 9643     -- ▪ ▫
      or cp between 9723 and 9726     -- ◻ … ◾
      or cp between 9728 and 9732     -- ☀ … ☄
      or cp between 9748 and 9749     -- ☔ ☕
      or cp between 9762 and 9763     -- ☢ ☣
      or cp between 9774 and 9775     -- ☮ ☯
      or cp between 9784 and 9786     -- ☸ ☹ ☺
      or cp between 9800 and 9811     -- ♈ … ♓
      or cp between 9823 and 9824     -- ♟ ♠
      or cp in (9827, 9832)           -- ♣ ♨
      or cp between 9829 and 9830     -- ♥ ♦
      or cp between 9854 and 9855     -- ♾ ♿
      or cp between 9874 and 9879     -- ⚒ … ⚗
      or cp between 9883 and 9884     -- ⚛ ⚜
      or cp between 9888 and 9889     -- ⚠ ⚡
      or cp between 9898 and 9899     -- ⚪ ⚫
      or cp between 9904 and 9905     -- ⚰ ⚱
      or cp between 9917 and 9918     -- ⚽ ⚾
      or cp between 9924 and 9925     -- ⛄ ⛅
      or cp between 9934 and 9935     -- ⛎ ⛏
      or cp between 9939 and 9940     -- ⛓ ⛔
      or cp between 9961 and 9962     -- ⛩ ⛪
      or cp between 9968 and 9973     -- ⛰ … ⛵
      or cp between 9975 and 9978     -- ⛷ … ⛺
      or cp between 9992 and 9997     -- ✈ … ✍
      or cp between 10035 and 10036   -- ✳ ✴
      or cp between 10067 and 10069   -- ❓ ❔ ❕
      or cp between 10083 and 10084   -- ❣ ❤
      or cp between 10133 and 10135   -- ➕ ➖ ➗
      or cp between 10548 and 10549   -- ⤴ ⤵
      or cp between 11013 and 11015   -- ⬅ ⬆ ⬇
      or cp between 11035 and 11036   -- ⬛ ⬜
    when cp between 127995 and 127999 then false   -- U+1F3FB–1F3FF skin tones: modifiers only
    when cp between 127462 and 127487 then false   -- U+1F1E6–1F1FF regional indicators: flags only
    else
      cp between 126976 and 127231                 -- U+1F000–1F0FF
      or cp between 127245 and 127247 or cp = 127279
      or cp between 127340 and 127345 or cp between 127358 and 127359 or cp = 127374
      or cp between 127377 and 127386 or cp between 127405 and 127461
      or cp between 127489 and 127503 or cp = 127514 or cp = 127535
      or cp between 127538 and 127546 or cp between 127548 and 127551
      or cp between 127561 and 128317             -- U+1F249–1F53D (minus 1F3FB–1F3FF above)
      or cp between 128326 and 128591             -- U+1F546–1F64F
      or cp between 128640 and 128767             -- U+1F680–1F6FF
      or cp between 128884 and 128895             -- U+1F774–1F77F
      or cp between 128981 and 129023             -- U+1F7D5–1F7FF
      or cp between 129036 and 129039 or cp between 129096 and 129103
      or cp between 129114 and 129119 or cp between 129160 and 129167
      or cp between 129198 and 129279             -- U+1F8AE–1F8FF
      or cp between 129292 and 129338             -- U+1F90C–1F93A
      or cp between 129340 and 129349             -- U+1F93C–1F945
      or cp between 129351 and 129791             -- U+1F947–1FAFF
      or cp between 130048 and 131069             -- U+1FC00–1FFFD
  end
$$;

-- One RGI-shaped emoji: element (U+200D element){0,4}, where element is
--   * a flag: exactly two regional indicators;
--   * a keycap: [0-9#*] U+FE0F? U+20E3;
--   * a base emoji, then optionally U+FE0F or one skin-tone modifier; U+1F3F4 may carry a tag
--     sequence (U+E0020–E007E)+ U+E007F (England, Scotland, Wales).
-- Rejects empty, text, two emoji side by side, U+FE0E (text presentation), stray joiners,
-- modifiers or tags, controls and anything over 16 code points / 64 bytes.
create or replace function private.is_single_emoji(p text) returns boolean
language plpgsql immutable strict parallel safe set search_path = pg_catalog as $$
declare
  n integer := char_length(p);
  i integer := 1;
  cp integer;
  base integer;
  joins integer := 0;
  tags integer;
begin
  if n = 0 or n > 16 or octet_length(p) > 64 then return false; end if;
  loop
    cp := ascii(substr(p, i, 1));
    if cp between 127462 and 127487 then                       -- flag
      if i = n or ascii(substr(p, i + 1, 1)) not between 127462 and 127487 then return false; end if;
      i := i + 2;
    elsif cp in (35, 42) or cp between 48 and 57 then          -- keycap
      i := i + 1;
      if i <= n and ascii(substr(p, i, 1)) = 65039 then i := i + 1; end if;
      if i > n or ascii(substr(p, i, 1)) <> 8419 then return false; end if;
      i := i + 1;
    elsif private.is_emoji_base(cp) then
      base := cp;
      i := i + 1;
      if i <= n then
        cp := ascii(substr(p, i, 1));
        if cp = 65039 or cp between 127995 and 127999 then i := i + 1; end if;
      end if;
      if base = 127988 and i <= n and ascii(substr(p, i, 1)) between 917536 and 917630 then
        tags := 0;
        while i <= n and ascii(substr(p, i, 1)) between 917536 and 917630 loop
          i := i + 1; tags := tags + 1;
        end loop;
        if tags > 6 or i > n or ascii(substr(p, i, 1)) <> 917631 then return false; end if;
        i := i + 1;
      end if;
    else
      return false;
    end if;
    exit when i > n;
    if ascii(substr(p, i, 1)) <> 8205 or i = n then return false; end if;   -- only U+200D joins
    joins := joins + 1;
    if joins > 4 then return false; end if;
    i := i + 1;
  end loop;
  return true;
end $$;

-- ❤️ with or without U+FE0F (D45 lead default). Stored values are normalised to ❤️ by the
-- trigger below; the bare form is accepted here too so the rule never depends on that.
create or replace function private.is_love_reaction(p text) returns boolean
language sql immutable strict parallel safe set search_path = pg_catalog as $$
  select p in (U&'\2764', U&'\2764\FE0F')
$$;

-- The check constraint runs as the writing role and calls the function by OID (no schema USAGE
-- needed), so the API roles need EXECUTE. Pure functions; PostgREST doesn't expose `private`.
revoke all on function private.is_emoji_base(integer), private.is_single_emoji(text),
  private.is_love_reaction(text) from public, anon, authenticated, service_role;
grant execute on function private.is_emoji_base(integer), private.is_single_emoji(text),
  private.is_love_reaction(text) to authenticated, service_role;

-- ───────────────────────────── Column: enum → one emoji ─────────────────────────────
-- Column privileges (update of kind, BE-05) and RLS policies don't reference the type.
alter table public.reactions alter column kind type text using (
  case kind::text
    when 'love'  then U&'\2764\FE0F'      -- ❤️
    when 'laugh' then U&'\+01F602'        -- 😂
    when 'wow'   then U&'\+01F62E'        -- 😮
    when 'spark' then U&'\+01F525'        -- 🔥
  end);
drop type public.reaction_kind;

-- Friendly error first (BEFORE trigger), the constraint as the backstop that also holds with
-- triggers disabled. NOT NULL stays. SECURITY DEFINER only because the writer has no USAGE on the
-- private schema (the body resolves private.* by name); it reads nothing but NEW.
create or replace function private.reactions_validate_kind() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if new.kind = U&'\2764' then new.kind := U&'\2764\FE0F'; end if;
  if not coalesce(private.is_single_emoji(new.kind), false) then
    raise exception 'INVALID_REACTION';
  end if;
  return new;
end $$;
revoke all on function private.reactions_validate_kind() from public, anon, authenticated, service_role;
create trigger reactions_validate_kind before insert or update of kind on public.reactions
  for each row execute function private.reactions_validate_kind();

alter table public.reactions
  add constraint reactions_kind_single_emoji check (private.is_single_emoji(kind));

-- ───────────────────────────── Hearts given (personal badge) ─────────────────────────────
-- Awarded once when the user currently has at least `threshold` ❤️ reactions (catalogue-driven:
-- no award while the badge isn't loaded). Counting current rows means removing and re-adding a
-- heart can't inflate the count; an award is never taken back.
create index reactions_love_by_user on public.reactions (user_id)
  where kind in (U&'\2764', U&'\2764\FE0F');

create or replace function private.award_hearts_given() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if private.is_love_reaction(new.kind) then
    insert into public.badge_awards (badge_slug, user_id)
      select b.slug, new.user_id from public.badges b
       where b.slug = 'hearts-given'
         and (select count(*) from public.reactions r
               where r.user_id = new.user_id and r.kind in (U&'\2764', U&'\2764\FE0F')) >= b.threshold
      on conflict (badge_slug, user_id) do nothing;
  end if;
  return null;
end $$;
revoke all on function private.award_hearts_given() from public, anon, authenticated, service_role;
create trigger reactions_award_hearts_given after insert or update of kind on public.reactions
  for each row execute function private.award_hearts_given();
