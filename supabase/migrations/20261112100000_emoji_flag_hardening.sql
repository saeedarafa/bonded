-- BE-40b (SEC-09 optional hardening, P3): `private.is_single_emoji` only accepts real flags.
--   * a regional-indicator pair must be one of the 259 RGI_Emoji_Flag_Sequence entries of
--     Unicode emoji-sequences.txt, Emoji 18.0 (2026-04-30): the 249 ISO 3166-1 alpha-2 codes plus
--     AC CP CQ DG EA EU IC TA UN XK. A made-up pair such as 🇦🇦 or 🇿🇿 (shown as two boxed letters)
--     is rejected. A future Unicode flag needs a new migration adding its code here;
--   * a tag sequence is accepted only directly after 🏴 (U+1F3F4) and only as one of the three
--     RGI subdivision flags: England (gbeng), Scotland (gbsct), Wales (gbwls). 🏴 alone stays valid.
-- Everything else is unchanged (same signature, same OID: the `reactions_kind_single_emoji` check
-- and the `reactions_validate_kind` trigger pick the new body up; the error stays
-- INVALID_REACTION). The picker never offers the rejected forms, so the app is not affected.
-- Cost: one array lookup per flag, one string compare per tag flag.
create or replace function private.is_single_emoji(p text) returns boolean
language plpgsql immutable strict parallel safe set search_path = pg_catalog as $$
declare
  n integer := char_length(p);
  i integer := 1;
  cp integer;
  base integer;
  joins integer := 0;
  tags text;
begin
  if n = 0 or n > 16 or octet_length(p) > 64 then return false; end if;
  loop
    cp := ascii(substr(p, i, 1));
    if cp between 127462 and 127487 then                       -- flag: two regional indicators
      if i = n or ascii(substr(p, i + 1, 1)) not between 127462 and 127487 then return false; end if;
      -- U+1F1E6 = 'A' (127462 - 65 = 127397)
      if not (chr(cp - 127397) || chr(ascii(substr(p, i + 1, 1)) - 127397)) = any ('{
        AD,AE,AF,AG,AI,AL,AM,AO,AQ,AR,AS,AT,AU,AW,AX,AZ,
        BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BV,BW,BY,BZ,
        CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,
        DE,DJ,DK,DM,DO,DZ, EC,EE,EG,EH,ER,ES,ET, FI,FJ,FK,FM,FO,FR,
        GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GS,GT,GU,GW,GY,
        HK,HM,HN,HR,HT,HU, ID,IE,IL,IM,IN,IO,IQ,IR,IS,IT, JE,JM,JO,JP,
        KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ, LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,
        MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,
        NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ, OM,
        PA,PE,PF,PG,PH,PK,PL,PM,PN,PR,PS,PT,PW,PY, QA, RE,RO,RS,RU,RW,
        SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,
        TC,TD,TF,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ, UA,UG,UM,US,UY,UZ,
        VA,VC,VE,VG,VI,VN,VU, WF,WS, YE,YT, ZA,ZM,ZW,
        AC,CP,CQ,DG,EA,EU,IC,TA,UN,XK}'::text[]) then
        return false;
      end if;
      i := i + 2;
    elsif cp in (35, 42) or cp between 48 and 57 then          -- keycap
      i := i + 1;
      if i <= n and ascii(substr(p, i, 1)) = 65039 then i := i + 1; end if;
      if i > n or ascii(substr(p, i, 1)) <> 8419 then return false; end if;
      i := i + 1;
    elsif cp = 127988 and i < n and ascii(substr(p, i + 1, 1)) between 917536 and 917630 then
      -- 🏴 + tag letters + U+E007F: England, Scotland or Wales only (tag = U+E0000 + ASCII)
      i := i + 1;
      tags := '';
      while i <= n and ascii(substr(p, i, 1)) between 917536 and 917630 loop
        tags := tags || chr(ascii(substr(p, i, 1)) - 917504);
        i := i + 1;
      end loop;
      if tags not in ('gbeng', 'gbsct', 'gbwls') or i > n or ascii(substr(p, i, 1)) <> 917631 then
        return false;
      end if;
      i := i + 1;
    elsif private.is_emoji_base(cp) then
      base := cp;
      i := i + 1;
      if i <= n then
        cp := ascii(substr(p, i, 1));
        if cp = 65039 or cp between 127995 and 127999 then i := i + 1; end if;
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

revoke all on function private.is_single_emoji(text) from public, anon, authenticated, service_role;
grant execute on function private.is_single_emoji(text) to authenticated, service_role;

-- `create or replace` does not re-check existing rows. A reaction stored under the old rule that
-- the new one rejects (a made-up flag pair, an unknown tag flag) would make every later UPDATE of
-- that row fail the check, so remove it now. Reactions are a one-tap, replaceable signal; none
-- exist on any shared environment yet (bonded-dev has no users; production is not live).
delete from public.reactions where not private.is_single_emoji(kind);
