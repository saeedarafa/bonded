-- BE-04c: pairing hardening (SEC-01 findings F2, F4, F5, F8, F9, F10, F11, F12).
--   F2   reveal rule: nobody can answer, or read a partner's answer to, a question that was open
--        before the couple was paired, except the daily question of the pairing day (D03: the
--        inviter's day-1 answer is what the joiner is meant to unlock).
--   F5   D04: couples are locked in one fixed order and the solo couple is re-checked before it is deleted.
--   F8   per-actor advisory lock around the limiter's check + insert.
--   F4   failed-attempt counting is bounded and indexed; the global count is a sharded counter.
--   F9   create_invite throttle (10/hour/user → RATE_LIMITED), exhaustion is RATE_LIMITED, purge function.
--   F10  display_name length, avatar only from our storage host in the anon preview.
--   F11  goals element length, couples.timezone must be an IANA name.
--   F12  SECURITY DEFINER functions: search_path = pg_catalog, extensions, public, pg_temp.
-- Not here (PO decisions): F1 pending approval for typed codes, F6 used-code oracle, F7 D04 undo.
-- F3 (gateway headers) is a note for the dev project: verify cf-connecting-ip is platform-set.

-- ───────────────────────────── F2: paired_at and the pairing-period rule ─────────────────────────────
alter table public.couples add column paired_at timestamptz;
comment on column public.couples.paired_at is 'When the second member joined (null while solo). Questions that were open before it are closed to answering and revealing, except the pairing day''s daily question (SEC-01 F2).';

update public.couples c set paired_at = (select max(joined_at) from public.couple_members m where m.couple_id = c.id)
 where (select count(*) from public.couple_members m where m.couple_id = c.id) >= 2;

-- Set by the data, not by one RPC: any path that adds the second member (accept_invite, the seed)
-- starts the pairing period.
create or replace function public.couple_members_after_insert() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  update couples set paired_at = new.joined_at
   where id = new.couple_id and paired_at is null
     and (select count(*) from couple_members where couple_id = new.couple_id) >= 2;
  return new;
end $$;
create trigger couple_members_paired after insert on public.couple_members
  for each row execute function public.couple_members_after_insert();

-- May this question carry answers that both partners can see? Always for a solo couple (only the
-- owner's own answer exists), for questions created at or after pairing, and for the daily question
-- of the pairing day (local date in the couple's timezone).
create or replace function private.cq_in_pair_period(p_cq uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
  select coalesce((
    select c.paired_at is null
        or cq.created_at >= c.paired_at
        or (cq.source = 'daily' and cq.assigned_for = (c.paired_at at time zone c.timezone)::date)
      from couple_questions cq join couples c on c.id = cq.couple_id
     where cq.id = p_cq), false)
$$;
revoke all on function private.cq_in_pair_period(uuid) from public, anon;
grant execute on function private.cq_in_pair_period(uuid) to authenticated;

-- The partner's answer is visible only inside the pairing period; writing a new answer too.
-- (Own answers stay readable and editable with a plain update; an upsert re-checks the insert rule.)
drop policy "read own or revealed answers" on public.answers;
create policy "read own or revealed answers" on public.answers for select to authenticated
  using (
    user_id = auth.uid()
    or (private.is_cq_member(couple_question_id) and private.has_answered(couple_question_id)
        and private.cq_in_pair_period(couple_question_id))
  );
drop policy "write own answer" on public.answers;
create policy "write own answer" on public.answers for insert to authenticated
  with check (user_id = auth.uid() and private.is_cq_member(couple_question_id)
              and private.cq_in_pair_period(couple_question_id));

-- SEC-01 R1: answers were not the only historical surface. A row that already had both answers
-- before this migration could otherwise still expose its thread, reactions and read state to a
-- newly joined partner. Keep the same pairing-period boundary on every dependent policy.
drop policy "read open threads" on public.thread_messages;
create policy "read open threads" on public.thread_messages for select to authenticated
  using (private.is_cq_member(couple_question_id) and private.both_answered(couple_question_id)
         and private.cq_in_pair_period(couple_question_id));
drop policy "post to open threads" on public.thread_messages;
create policy "post to open threads" on public.thread_messages for insert to authenticated
  with check (user_id = auth.uid() and private.is_cq_member(couple_question_id)
              and private.both_answered(couple_question_id) and private.cq_in_pair_period(couple_question_id));
drop policy "edit own messages" on public.thread_messages;
create policy "edit own messages" on public.thread_messages for update to authenticated
  using (user_id = auth.uid() and private.is_cq_member(couple_question_id)
         and private.cq_in_pair_period(couple_question_id))
  with check (user_id = auth.uid() and private.is_cq_member(couple_question_id)
              and private.cq_in_pair_period(couple_question_id));

drop policy "read reactions in own couple" on public.reactions;
create policy "read reactions in own couple" on public.reactions for select to authenticated
  using (private.is_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
         and private.has_answered(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
         and private.cq_in_pair_period(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))));
drop policy "react in own couple" on public.reactions;
create policy "react in own couple" on public.reactions for insert to authenticated
  with check (user_id = auth.uid()
              and private.is_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.has_answered(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.cq_in_pair_period(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))));
drop policy "change own reactions" on public.reactions;
create policy "change own reactions" on public.reactions for update to authenticated
  using (user_id = auth.uid()
         and private.is_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
         and private.cq_in_pair_period(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))))
  with check (user_id = auth.uid()
              and private.is_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.has_answered(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
              and private.cq_in_pair_period(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))));
drop policy "remove own reactions" on public.reactions;
create policy "remove own reactions" on public.reactions for delete to authenticated
  using (user_id = auth.uid()
         and private.is_cq_member(coalesce(private.answer_cq(answer_id), private.message_cq(message_id)))
         and private.cq_in_pair_period(coalesce(private.answer_cq(answer_id), private.message_cq(message_id))));

drop policy "own read markers" on public.thread_reads;
create policy "own read markers" on public.thread_reads for all to authenticated
  using (user_id = auth.uid() and private.is_cq_member(couple_question_id)
         and private.cq_in_pair_period(couple_question_id))
  with check (user_id = auth.uid() and private.is_cq_member(couple_question_id)
              and private.cq_in_pair_period(couple_question_id));

-- ───────────────────────────── settings, counters, purge ─────────────────────────────
create table private.app_settings (key text primary key, value text not null);
alter table private.app_settings enable row level security;
comment on table private.app_settings is 'Per-environment values set once by hand (storage_host: the host of this project''s Storage, e.g. abcd.supabase.co; unset = no avatar in the anon preview).';

create table private.invite_failure_counts (
  bucket timestamptz not null,       -- clock hour
  shard  smallint    not null,       -- 0..15: spreads concurrent increments over 16 rows
  n      int         not null default 0,
  primary key (bucket, shard)
);
alter table private.invite_failure_counts enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;

create index pair_invites_by_inviter_time on public.pair_invites (inviter_id, created_at);

-- Test seam: a no-op the tests replace to interleave a competing transaction at a named point.
create or replace function private.race_point(p_name text) returns void language plpgsql as $$ begin end $$;
revoke all on function private.race_point(text) from public, anon, authenticated;

-- ───────────────────────────── F4/F8: limiter ─────────────────────────────
-- Bounded: reads at most `cap` rows from the (actor, created_at) index.
create or replace function private.invite_limited(p_actor text, p_now timestamptz) returns boolean
language sql stable set search_path = pg_catalog, public, pg_temp as $$
  select (select count(*) from (
            select 1 from private.invite_attempts
             where actor = p_actor
               and created_at > p_now - make_interval(mins => (select window_min from private.invite_limits()))
               and created_at <= p_now
             limit (select per_actor from private.invite_limits())) t)
         >= (select per_actor from private.invite_limits())
$$;

-- One insert for the actor, one counter bump on a random one of 16 shard rows, one 16-row sum, and
-- an INSERT .. DO NOTHING for the alert (no update of a shared row once the cap is crossed).
-- Old rows are purged by private.purge_pairing_data, not here.
create or replace function private.invite_record_failure(p_actor text, p_now timestamptz) returns void
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  v_hour  timestamptz := date_trunc('hour', p_now);
  v_total bigint;
begin
  insert into private.invite_attempts (actor, created_at) values (p_actor, p_now);
  insert into private.invite_failure_counts (bucket, shard, n) values (v_hour, (random() * 15)::int, 1)
    on conflict (bucket, shard) do update set n = invite_failure_counts.n + 1;
  select sum(n) into v_total from private.invite_failure_counts where bucket = v_hour;
  if v_total >= (select global_per_hour from private.invite_limits()) then
    insert into private.security_alerts (kind, bucket, detail)
      values ('invite_guessing', v_hour, jsonb_build_object('failures_in_hour', v_total))
      on conflict (kind, bucket) do nothing;
  end if;
end $$;

-- Housekeeping for the pairing tables; scheduled hourly below, callable by hand.
create or replace function private.purge_pairing_data(p_now timestamptz default now()) returns void
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  delete from private.invite_attempts where created_at < p_now - interval '1 day';
  delete from private.invite_failure_counts where bucket < p_now - interval '2 days';
  -- Revoked, expired and used invites (and their token hashes, by cascade) after a week.
  delete from public.pair_invites
   where created_at < p_now - interval '7 days'
     and (accepted_at is not null or revoked_at is not null or expires_at < p_now);
end $$;
revoke all on function private.purge_pairing_data(timestamptz) from public, anon, authenticated;

-- ───────────────────────────── F9: create_invite ─────────────────────────────
-- At most 10 invites per user per hour (rows are kept a week, so the count is a plain indexed
-- count) and no free code → RATE_LIMITED (retry later) instead of a free-text error.
create or replace function private.create_invite_at(p_now timestamptz) returns public.invite_created
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid := private.my_couple_id();
  v_code   text;
  v_token  text := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_id     uuid;
  v_exp    timestamptz := p_now + interval '48 hours';
  v_try    int := 0;
  v_rnd    bytea;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  perform 1 from couples where id = v_couple for update;  -- serialises concurrent calls
  if (select count(*) from couple_members where couple_id = v_couple) >= 2 then
    perform private.raise_error('COUPLE_FULL');
  end if;
  if (select count(*) from pair_invites where inviter_id = auth.uid()
        and created_at > p_now - interval '1 hour' and created_at <= p_now) >= 10 then
    perform private.raise_error('RATE_LIMITED');
  end if;
  update pair_invites set revoked_at = p_now
   where inviter_id = auth.uid() and accepted_at is null and revoked_at is null;
  loop
    v_try := v_try + 1;
    if v_try > 200 then perform private.raise_error('RATE_LIMITED'); end if;
    v_rnd := gen_random_bytes(4);
    v_code := lpad((((get_byte(v_rnd, 0)::bigint << 24) + (get_byte(v_rnd, 1) << 16)
                   + (get_byte(v_rnd, 2) << 8) + get_byte(v_rnd, 3)) % 10000)::text, 4, '0');
    -- An expired invite doesn't hold its digits.
    update pair_invites set revoked_at = p_now
     where code = v_code and accepted_at is null and revoked_at is null and expires_at <= p_now;
    begin
      insert into pair_invites (code, inviter_id, couple_id, partner_name, created_at, expires_at)
        select v_code, auth.uid(), v_couple, partner_name, p_now, v_exp from couples where id = v_couple
        returning id into v_id;
      exit;
    exception when unique_violation then
      -- digits held by a live invite: try others
    end;
  end loop;
  insert into private.invite_tokens (invite_id, token_hash) values (v_id, digest(v_token, 'sha256'));
  return row(v_code, v_exp, v_token)::public.invite_created;
end $$;

-- ───────────────────────────── F5/F8: accept_invite ─────────────────────────────
-- Lock order, always: the actor's advisory lock, then the couples involved in ascending id order,
-- then the invite. A solo caller's own couple and the inviter's couple are both locked before
-- either is read for a decision, and the solo couple is re-checked (still a single active member,
-- not the inviter's) before it is deleted, so crossing accepts can neither deadlock nor delete a
-- couple that was joined in the meantime.
create or replace function private.accept_invite_at(p_code text, p_token text, p_now timestamptz)
returns json
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_actor  text := private.invite_actor();
  v_mine   uuid;
  v_cid    uuid;
  v_try    int := 0;
  r        record;
  v_inv    pair_invites;
  v_couple couples;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor, 0));   -- F8: check + insert of failures is one at a time per actor
  perform private.race_point('actor_locked');

  loop
    v_try := v_try + 1;
    v_mine := private.my_couple_id();
    if v_mine is not null and (select count(*) from couple_members where couple_id = v_mine) >= 2 then
      perform private.raise_error('ALREADY_PAIRED');
    end if;
    select * into r from private.resolve_invite(p_code, p_token, p_now);
    if not r.token_ok and private.invite_limited(v_actor, p_now) then
      perform private.raise_error('RATE_LIMITED');
    end if;
    if r.err is not null then return private.invite_fail(v_actor, r.err, p_now); end if;
    select couple_id into v_cid from pair_invites where id = r.invite_id;
    perform private.race_point('before_couple_lock');
    perform 1 from couples where id in (v_mine, v_cid) order by id for update;
    perform private.race_point('couples_locked');
    exit when private.my_couple_id() is not distinct from v_mine;   -- unchanged while we waited
    if v_try >= 3 then perform private.raise_error('ALREADY_PAIRED'); end if;
  end loop;

  -- Everything below reads state that is now locked.
  if v_mine is not null and (select count(*) from couple_members where couple_id = v_mine) >= 2 then
    perform private.race_point('refused');
    perform private.raise_error('ALREADY_PAIRED');
  end if;
  select * into v_inv from pair_invites where id = r.invite_id for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    return private.invite_fail(v_actor, 'COUPLE_FULL', p_now, not r.token_ok);  -- lost a race
  end if;
  if v_inv.inviter_id = v_uid then perform private.raise_error('OWN_CODE'); end if;

  select * into v_couple from couples where id = v_inv.couple_id;
  if not found or v_couple.status <> 'active'
     or (select count(*) from couple_members where couple_id = v_couple.id) >= 2 then
    return private.invite_fail(v_actor, 'COUPLE_FULL', p_now, not r.token_ok);
  end if;
  if v_inv.expires_at <= p_now then
    return private.invite_fail(v_actor, 'INVITE_EXPIRED', p_now, not r.token_ok);
  end if;

  -- D04: the caller's solo couple goes, with its answers, messages, key dates and open invite.
  if v_mine is not null then
    if v_mine = v_couple.id
       or (select count(*) from couple_members where couple_id = v_mine) <> 1
       or not exists (select 1 from couples where id = v_mine and status = 'active') then
      perform private.race_point('refused');
      perform private.raise_error('ALREADY_PAIRED');
    end if;
    delete from couples where id = v_mine;
  end if;
  insert into couple_members (couple_id, user_id, joined_at) values (v_couple.id, v_uid, p_now);
  update pair_invites set accepted_by = v_uid, accepted_at = p_now where id = v_inv.id;
  return to_json(v_couple.id);
end $$;

-- ───────────────────────────── F10/F8: invite_preview ─────────────────────────────
-- First name only, at most 30 characters; the avatar only when it is an https URL under this
-- project's own Storage host (private.app_settings 'storage_host'; unset = no avatar).
create or replace function private.invite_preview_at(p_code text, p_token text, p_now timestamptz)
returns json
language plpgsql set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_actor  text := private.invite_actor();
  r        record;
  v_inv    pair_invites;
  v_couple couples;
  v_prof   profiles;
  v_prefix text;
  v_avatar text;
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
    return private.invite_fail(v_actor, 'INVITE_EXPIRED', p_now, not r.token_ok);
  end if;

  select * into v_prof from profiles where id = v_inv.inviter_id;
  v_prefix := 'https://' || (select value from private.app_settings where key = 'storage_host') || '/storage/v1/object/public/avatars/';
  v_avatar := case when v_prefix is not null and v_prof.avatar_url is not null
                    and char_length(v_prof.avatar_url) <= 500 and v_prof.avatar_url !~ '[[:space:]]'
                    and left(v_prof.avatar_url, char_length(v_prefix)) = v_prefix
                   then v_prof.avatar_url end;
  return json_build_object(
    'inviter_name', left(split_part(btrim(v_prof.display_name), ' ', 1), 30),
    'inviter_avatar_url', v_avatar,
    'inviter_answered_today', exists (
      select 1 from couple_questions cq join answers a on a.couple_question_id = cq.id
       where cq.couple_id = v_couple.id and cq.source = 'daily'
         and cq.assigned_for = (p_now at time zone v_couple.timezone)::date
         and a.user_id = v_inv.inviter_id),
    'expires_at', v_inv.expires_at);
end $$;

revoke all on function private.invite_limited(text, timestamptz) from public, anon, authenticated;
revoke all on function private.invite_record_failure(text, timestamptz) from public, anon, authenticated;
revoke all on function private.create_invite_at(timestamptz) from public, anon, authenticated;
revoke all on function private.accept_invite_at(text, text, timestamptz) from public, anon, authenticated;
revoke all on function private.invite_preview_at(text, text, timestamptz) from public, anon, authenticated;

-- ───────────────────────────── F10/F11: profile and couple settings ─────────────────────────────
-- NOT VALID: rows written before this migration are not re-checked; every new or changed value is.
alter table public.profiles
  add constraint profiles_display_name_length check (char_length(display_name) <= 60) not valid,
  add constraint profiles_avatar_url_length check (char_length(avatar_url) <= 500) not valid;

create or replace function private.is_valid_timezone(p_tz text) returns boolean
language sql stable set search_path = pg_catalog as $$
  select p_tz is not null
     and p_tz ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'
     and (p_tz = 'UTC' or p_tz like '%/%')
     and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = p_tz)
$$;
create or replace function private.goals_within_length(p_goals text[]) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select not exists (select 1 from pg_catalog.unnest(p_goals) g where pg_catalog.char_length(g) > 60)
$$;
alter table public.couples
  drop constraint if exists couples_timezone_is_iana,
  add constraint couples_timezone_is_iana check (private.is_valid_timezone(timezone)) not valid,
  add constraint couples_goals_length check (private.goals_within_length(goals)) not valid;
alter table public.profiles
  drop constraint if exists profiles_timezone_is_iana,
  add constraint profiles_timezone_is_iana check (private.is_valid_timezone(timezone)) not valid;

-- create_couple keeps its contract; goals longer than 60 characters are cut like partner_name is.
create or replace function public.create_couple(
  p_stage public.couple_stage, p_goals text[] default '{}', p_partner_name text default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple  uuid;
  v_goals   text[];
  v_partner text := nullif(left(btrim(coalesce(p_partner_name, '')), 40), '');
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  select coalesce(array_agg(g order by i), '{}') into v_goals from (
    select left(btrim(g), 60) g, min(i) i from unnest(coalesce(p_goals, '{}')) with ordinality u(g, i)
     where btrim(g) <> '' group by left(btrim(g), 60) order by min(i) limit 12) x;

  v_couple := private.my_couple_id();
  if v_couple is not null then
    perform 1 from couples where id = v_couple for update;
    if (select count(*) from couple_members where couple_id = v_couple) >= 2 then
      perform private.raise_error('ALREADY_PAIRED');
    end if;
    update couples set stage = p_stage, goals = v_goals, partner_name = v_partner where id = v_couple;
    return v_couple;
  end if;

  insert into couples (timezone, stage, goals, partner_name)
    select timezone, p_stage, v_goals, v_partner from profiles where id = auth.uid()
    returning id into v_couple;
  insert into couple_members (couple_id, user_id) values (v_couple, auth.uid());
  insert into couple_streaks (couple_id) values (v_couple);
  return v_couple;
exception when unique_violation then
  v_couple := private.my_couple_id();
  if v_couple is null then raise; end if;
  return v_couple;
end $$;

-- ───────────────────────────── F12: search_path ─────────────────────────────
-- Every SECURITY DEFINER function (and the helpers they call) resolves names in pg_catalog, then
-- extensions (digest, gen_random_bytes), then public, with pg_temp last, so nothing created in
-- public or a temp schema can shadow a function a definer relies on.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and (p.prosecdef or exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and p.proname <> 'is_valid_timezone' and p.proname <> 'goals_within_length'
  loop
    execute format('alter function %s set search_path = pg_catalog, extensions, public, pg_temp', f.sig);
  end loop;
end $$;
revoke create on schema public from public, anon, authenticated;

-- ───────────────────────────── purge schedule ─────────────────────────────
-- Hourly where pg_cron is available (Supabase); silently skipped elsewhere (tests, plain Postgres).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-pairing-data', '17 * * * *', 'select private.purge_pairing_data()');
  end if;
exception when others then
  raise notice 'pairing purge not scheduled: %', sqlerrm;
end $$;
