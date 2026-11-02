-- Dev seed engine (BE-05). LOCAL STACK AND `dev` ONLY: never loaded on prod (seed.sql is not run by
-- `supabase db push`, and its first statement refuses to run next to real users).
-- Hand-written; supabase/scripts/build-seed.mjs wraps it with content + the persona rows from
-- qa/fixtures/personas.json into supabase/seed.sql.
--
--   select dev_seed.apply_scenario('streak-11-your-turn');           -- relative to now()
--   select dev_seed.apply_scenario('history-month', '2026-12-01T09:00:00Z');   -- pinned clock (tests)
--   select * from dev_seed.scenarios();
--
-- Each call wipes the persona couples, invites and entitlements and rebuilds the state of one
-- scenario from personas.json ("day_offset 0 = today in the couple's timezone"). Data is inserted
-- as the owner (RLS bypassed); the app's own triggers run, so answer_count and streaks are real.

create schema if not exists dev_seed;
revoke all on schema dev_seed from public, anon, authenticated;

create table if not exists dev_seed.persona (
  key text primary key, id uuid not null, email text not null, display_name text not null,
  timezone text not null, locale text not null, platform text);
create table if not exists dev_seed.couple (
  key text primary key, id uuid not null, members text[] not null, timezone text not null,
  stage text, goals text[] not null default '{}', partner_name text);
create table if not exists dev_seed.key_date (
  couple_key text not null, kind text not null, user_key text, date date not null);
revoke all on all tables in schema dev_seed from public, anon, authenticated;

-- ───────────────────────────── small helpers ─────────────────────────────
create or replace function dev_seed.uid(p_key text) returns uuid language plpgsql stable as $$
declare v uuid;
begin
  select id into v from dev_seed.persona where key = p_key;
  if v is null then raise exception 'dev_seed: unknown persona %', p_key; end if;
  return v;
end $$;

create or replace function dev_seed.cid(p_key text) returns uuid language plpgsql stable as $$
declare v uuid;
begin
  select id into v from dev_seed.couple where key = p_key;
  if v is null then raise exception 'dev_seed: unknown couple %', p_key; end if;
  return v;
end $$;

-- Local calendar date of "today + offset" in the couple's timezone.
create or replace function dev_seed.day(p_couple text, p_now timestamptz, p_offset int) returns date
language sql stable as $$
  select ((p_now at time zone c.timezone)::date + p_offset) from dev_seed.couple c where c.key = p_couple
$$;

-- A wall-clock time on a local day in the couple's timezone, as timestamptz.
create or replace function dev_seed.at(p_couple text, p_day date, p_time time) returns timestamptz
language sql stable as $$
  select ((p_day + p_time)::timestamp at time zone c.timezone) from dev_seed.couple c where c.key = p_couple
$$;

create or replace function dev_seed.ensure_user(p_key text) returns void
language plpgsql set search_path = public, extensions as $$
declare p dev_seed.persona;
begin
  select * into p from dev_seed.persona where key = p_key;
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', p.id, 'authenticated', 'authenticated', p.email, now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('name', p.display_name),
          '', '', '', '', now(), now())
  on conflict (id) do nothing;
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select p.id::text, p.id, jsonb_build_object('sub', p.id::text, 'email', p.email, 'email_verified', true), 'email', now(), now(), now()
   where not exists (select 1 from auth.identities where user_id = p.id);
  update profiles set display_name = p.display_name, timezone = p.timezone, locale = p.locale where id = p.id;
end $$;

create or replace function dev_seed.drop_user(p_key text) returns void language sql as $$
  delete from auth.users where id = dev_seed.uid(p_key)
$$;

-- Wipe everything the scenarios own, then make sure every persona has an account.
create or replace function dev_seed.reset() returns void
language plpgsql set search_path = public, extensions as $$
declare k text;
begin
  delete from couples where id in (select id from dev_seed.couple);   -- cascades members, questions, answers, threads, streak, key dates
  delete from pair_invites where inviter_id in (select id from dev_seed.persona);
  delete from entitlements where user_id in (select id from dev_seed.persona);
  delete from push_tokens where user_id in (select id from dev_seed.persona);
  delete from private.invite_attempts where actor in (select 'u:' || id::text from dev_seed.persona);
  for k in select key from dev_seed.persona loop perform dev_seed.ensure_user(k); end loop;
end $$;

-- A couple row from the persona definition. Members as given; streak row; the couple's key dates
-- (birthdays only for members present).
create or replace function dev_seed.mk_couple(p_key text, p_members text[], p_created timestamptz) returns uuid
language plpgsql set search_path = public as $$
declare c dev_seed.couple; m text;
begin
  select * into c from dev_seed.couple where key = p_key;
  insert into couples (id, timezone, stage, goals, partner_name, created_at)
    values (c.id, c.timezone, c.stage::couple_stage, c.goals, c.partner_name, p_created);
  foreach m in array p_members loop
    insert into couple_members (couple_id, user_id, joined_at) values (c.id, dev_seed.uid(m), p_created);
  end loop;
  insert into couple_streaks (couple_id) values (c.id);
  insert into key_dates (couple_id, kind, user_id, date)
    select c.id, k.kind::key_date_kind, case when k.user_key is null then null else dev_seed.uid(k.user_key) end, k.date
      from dev_seed.key_date k where k.couple_key = p_key and (k.user_key is null or k.user_key = any (p_members));
  return c.id;
end $$;

create or replace function dev_seed.set_streak(p_couple text, p_current int, p_longest int, p_last date) returns void
language sql as $$
  update couple_streaks set current = p_current, longest = p_longest, last_completed_on = p_last
   where couple_id = dev_seed.cid(p_couple)
$$;

-- A couple_question for a day (by external_id); the question must be loaded (content first).
create or replace function dev_seed.mk_cq(p_couple text, p_ext text, p_day date) returns uuid
language plpgsql set search_path = public as $$
declare v uuid;
begin
  insert into couple_questions (couple_id, question_id, source, assigned_for, created_at)
    select dev_seed.cid(p_couple), q.id, 'daily', p_day, dev_seed.at(p_couple, p_day, '00:05')
      from questions q where q.external_id = p_ext
    returning id into v;
  if v is null then raise exception 'dev_seed: question % is not loaded (run the content loader)', p_ext; end if;
  return v;
end $$;

-- D17: the answer must fall on the question's local day to count for the streak, so a "3 hours ago"
-- that lands before local midnight is moved to just after it (only matters when seeding at night).
create or replace function dev_seed.ans(p_cq uuid, p_user text, p_body text, p_at timestamptz) returns uuid
language sql as $$
  insert into answers (couple_question_id, user_id, body, created_at, updated_at)
  select p_cq, dev_seed.uid(p_user), p_body, x.t, x.t
    from (select greatest(p_at, ((cq.assigned_for + time '00:01')::timestamp at time zone c.timezone)) t
            from couple_questions cq join couples c on c.id = cq.couple_id where cq.id = p_cq) x
  returning id
$$;

create or replace function dev_seed.msg(p_cq uuid, p_user text, p_body text, p_at timestamptz) returns uuid
language sql as $$
  insert into thread_messages (client_id, couple_question_id, user_id, body, created_at)
  values (gen_random_uuid(), p_cq, dev_seed.uid(p_user), p_body, p_at) returning id
$$;

create or replace function dev_seed.cq_on(p_couple text, p_day date) returns uuid
language sql stable as $$
  select id from couple_questions where couple_id = dev_seed.cid(p_couple) and source = 'daily' and assigned_for = p_day
$$;

-- Days from..to (offsets from today). The first day is the special question first_day (D12), later
-- days d(100+offset). p_skip: nobody answered; p_one: only the first member answered; p_ext: overrides
-- as {"-4": "d004"}. Everyone else answers, in the evening. Chronological, so the streak trigger is real.
create or replace function dev_seed.history(p_couple text, p_now timestamptz, p_from int, p_to int,
  p_skip int[] default '{}', p_one int[] default '{}', p_ext jsonb default '{}') returns void
language plpgsql set search_path = public as $$
declare
  v_members text[] := (select members from dev_seed.couple where key = p_couple);
  v_off int; v_day date; v_ext text; v_cq uuid; v_who text[]; m text; i int;
begin
  for v_off in p_from..p_to loop
    continue when v_off = any (p_skip);
    v_day := dev_seed.day(p_couple, p_now, v_off);
    v_ext := coalesce(p_ext ->> v_off::text, case when v_off = p_from then 'special-first_day' else 'd' || lpad((100 + v_off)::text, 3, '0') end);
    v_cq := dev_seed.mk_cq(p_couple, v_ext, v_day);
    v_who := case when v_off = any (p_one) then v_members[1:1] else v_members end;
    i := 0;
    foreach m in array v_who loop
      perform dev_seed.ans(v_cq, m, format('Seed answer from %s for day %s.', initcap(m), v_off),
        dev_seed.at(p_couple, v_day, '19:30'::time + i * interval '11 minutes'));
      i := i + 1;
    end loop;
  end loop;
end $$;

-- Thread messages and reactions for one day: p_msgs alternating replies, p_reacts reactions that
-- cycle love/laugh/wow/spark (first two on the answers, the rest on messages).
create or replace function dev_seed.chat(p_couple text, p_now timestamptz, p_off int, p_msgs int, p_reacts int) returns void
language plpgsql set search_path = public as $$
declare
  v_members text[] := (select members from dev_seed.couple where key = p_couple);
  v_day date := dev_seed.day(p_couple, p_now, p_off);
  v_cq uuid := dev_seed.cq_on(p_couple, v_day);
  v_lines text[] := array['Wait, really?', 'Every single time.', 'Okay, tomorrow is on me.', 'Deal.', 'You always say that.', 'Ha, fair.'];
  v_kinds reaction_kind[] := array['love', 'laugh', 'wow', 'spark']::reaction_kind[];
  v_msgs uuid[] := '{}'; v_id uuid; r int; u text; ans_id uuid;
begin
  for r in 1..p_msgs loop
    v_msgs := v_msgs || dev_seed.msg(v_cq, v_members[1 + (r - 1) % 2], v_lines[1 + (r - 1) % 6],
      dev_seed.at(p_couple, v_day, '21:00'::time + r * interval '2 minutes'));
  end loop;
  for r in 1..p_reacts loop
    u := v_members[1 + r % 2];                                     -- r=1: second member, r=2: first, ...
    if r <= 2 then
      select id into ans_id from answers where couple_question_id = v_cq and user_id = dev_seed.uid(v_members[1 + (r - 1) % 2]);
      insert into reactions (user_id, answer_id, kind, created_at) values (dev_seed.uid(u), ans_id, v_kinds[1 + (r - 1) % 4],
        dev_seed.at(p_couple, v_day, '21:30'));
    else
      insert into reactions (user_id, message_id, kind, created_at) values (dev_seed.uid(u), v_msgs[r - 2], v_kinds[1 + (r - 1) % 4],
        dev_seed.at(p_couple, v_day, '21:31'));
    end if;
  end loop;
end $$;

-- The outsider couple (isolation tests): three days of answers and replies, in every scenario but fresh-install.
create or replace function dev_seed.outsiders(p_now timestamptz) returns void
language plpgsql set search_path = public as $$
declare v_off int;
begin
  perform dev_seed.mk_couple('eve_finn', array['eve', 'finn'], p_now - interval '3 days');
  perform dev_seed.history('eve_finn', p_now, -2, 0, '{}', '{}', '{"-2": "special-first_day"}');
  for v_off in -2..0 loop perform dev_seed.chat('eve_finn', p_now, v_off, 2, 1); end loop;
end $$;

create or replace function dev_seed.invite(p_couple text, p_inviter text, p_code text, p_created timestamptz, p_expires timestamptz,
  p_accepted_by text default null, p_accepted_at timestamptz default null) returns void
language plpgsql set search_path = public, extensions as $$
declare v_id uuid;
begin
  insert into pair_invites (code, inviter_id, couple_id, partner_name, created_at, expires_at, accepted_by, accepted_at)
    select p_code, dev_seed.uid(p_inviter), c.id, c.partner_name, p_created, p_expires,
           case when p_accepted_by is null then null else dev_seed.uid(p_accepted_by) end, p_accepted_at
      from dev_seed.couple c where c.key = p_couple returning id into v_id;
  -- Link token for E2E: /j/BND<code>?t=dev-seed-token-<code> (dev only; the DB keeps the hash).
  insert into private.invite_tokens (invite_id, token_hash) values (v_id, digest('dev-seed-token-' || p_code, 'sha256'));
end $$;

create or replace function dev_seed.entitle(p_user text, p_now timestamptz) returns void
language sql as $$
  insert into entitlements (user_id, is_active, product_id, store, expires_at)
  values (dev_seed.uid(p_user), true, 'yearly_trial', 'app_store', p_now + interval '300 days')
$$;

create or replace function dev_seed.scenarios() returns table (id text) language sql stable as $$
  select unnest(array['fresh-install', 'solo-invite-pending', 'paired-day1-partner-answered', 'invite-expired', 'invite-wrong-code',
    'couple-full', 'streak-11-your-turn', 'streak-11-both-answered', 'streak-6-milestone', 'missed-day-napping',
    'missed-day-premium-saver', 'premium-couple', 'free-couple-packs', 'history-month', 'empty-history', 'partner-left',
    'delete-account', 'outsider-couple', 'anniversary-today'])
$$;

-- ───────────────────────────── the scenarios ─────────────────────────────
create or replace function dev_seed.apply_scenario(p_id text, p_now timestamptz default now()) returns void
language plpgsql set search_path = public, extensions as $$
declare
  v_today date; v_yday date; v_cq uuid; v_a uuid; v_off int;
  c constant text := 'maya_sam';
  v_maya_day1 constant text := 'Your laugh. Loud, sudden, and somehow the best sound in the room.';
  v_sam_today constant text := 'When you hum while cooking. I don''t think you notice, but it makes the kitchen feel like home.';
  v_maya_today constant text := 'When you leave the coffee ready before you go. It''s tiny, but it feels like a note that says I thought of you.';
begin
  if p_id not in (select id from dev_seed.scenarios()) then raise exception 'dev_seed: unknown scenario %', p_id; end if;
  -- Seed rows carry their own timestamps (the answers trigger trusts them when no JWT user is set).
  perform set_config('request.jwt.claim.sub', '', true);
  perform dev_seed.reset();
  v_today := dev_seed.day(c, p_now, 0);
  v_yday := v_today - 1;

  if p_id = 'fresh-install' then
    perform dev_seed.drop_user('noor');
    return;
  end if;

  -- Always there except in fresh-install: Lea (solo), Eve and Finn (outsiders), Noor (no couple yet).
  perform dev_seed.mk_couple('lea_solo', array['lea'], p_now - interval '2 days');
  perform dev_seed.outsiders(p_now);

  if p_id in ('solo-invite-pending', 'paired-day1-partner-answered', 'couple-full', 'invite-expired', 'invite-wrong-code') then
    perform dev_seed.mk_couple(c, array['maya'], case p_id when 'invite-expired' then p_now - interval '50 hours' else p_now - interval '1 hour' end);
    if p_id = 'invite-wrong-code' then return; end if;
    if p_id = 'invite-expired' then
      perform dev_seed.invite(c, 'maya', '4827', p_now - interval '49 hours', p_now - interval '1 hour');
      return;
    end if;
    v_cq := dev_seed.mk_cq(c, 'special-first_day', v_today);
    perform dev_seed.ans(v_cq, 'maya', v_maya_day1, p_now - interval '55 minutes');
    if p_id = 'solo-invite-pending' then
      perform dev_seed.invite(c, 'maya', '4827', p_now - interval '1 hour', p_now + interval '47 hours');
      perform dev_seed.drop_user('sam');                         -- "Sam has no account"
    else
      -- Sam redeemed 4827 half an hour ago: he is in Maya's couple; Maya has answered, Sam has not.
      insert into couple_members (couple_id, user_id, joined_at) values (dev_seed.cid(c), dev_seed.uid('sam'), p_now - interval '30 minutes');
      perform dev_seed.invite(c, 'maya', '4827', p_now - interval '1 hour', p_now + interval '47 hours', 'sam', p_now - interval '30 minutes');
    end if;
    return;
  end if;

  if p_id in ('streak-11-your-turn', 'streak-11-both-answered', 'outsider-couple') then
    perform dev_seed.mk_couple(c, array['maya', 'sam'], p_now - interval '11 days');
    perform dev_seed.history(c, p_now, -11, -1);
    perform dev_seed.set_streak(c, 11, 11, v_yday);
    v_cq := dev_seed.mk_cq(c, 'd001', v_today);
    perform dev_seed.ans(v_cq, 'sam', v_sam_today, p_now - interval '3 hours');
    if p_id <> 'streak-11-your-turn' then
      v_a := dev_seed.ans(v_cq, 'maya', v_maya_today, p_now - interval '2 hours 40 minutes');
      perform dev_seed.msg(v_cq, 'maya', 'Wait, I hum while I cook??', p_now - interval '2 hours');
      perform dev_seed.msg(v_cq, 'sam', 'Every single time. Please never stop.', p_now - interval '1 hour 55 minutes');
      perform dev_seed.msg(v_cq, 'sam', 'Okay, tomorrow the coffee is on me.', p_now - interval '1 hour 50 minutes');
      perform dev_seed.msg(v_cq, 'maya', 'Deal. Bring the humming too.', p_now - interval '1 hour 45 minutes');
      insert into reactions (user_id, answer_id, kind, created_at) values (dev_seed.uid('sam'), v_a, 'love', p_now - interval '1 hour 40 minutes');
    end if;
    return;
  end if;

  if p_id = 'streak-6-milestone' then
    perform dev_seed.mk_couple(c, array['maya', 'sam'], p_now - interval '6 days');
    perform dev_seed.history(c, p_now, -6, -1);
    perform dev_seed.set_streak(c, 6, 6, v_yday);
    v_cq := dev_seed.mk_cq(c, 'd001', v_today);
    perform dev_seed.ans(v_cq, 'sam', v_sam_today, p_now - interval '3 hours');
    return;
  end if;

  if p_id in ('missed-day-napping', 'missed-day-premium-saver') then
    perform dev_seed.mk_couple(c, array['maya', 'sam'], p_now - interval '12 days');
    perform dev_seed.history(c, p_now, -12, -2);                 -- yesterday was missed
    perform dev_seed.set_streak(c, 11, 41, v_today - 2);
    if p_id = 'missed-day-premium-saver' then perform dev_seed.entitle('maya', p_now); end if;
    return;
  end if;

  if p_id = 'premium-couple' then
    perform dev_seed.mk_couple(c, array['maya', 'sam'], p_now - interval '3 days');
    perform dev_seed.history(c, p_now, -3, -1);
    perform dev_seed.entitle('maya', p_now);                     -- Sam has no row: "on Maya's plan"
    return;
  end if;

  if p_id = 'free-couple-packs' then
    perform dev_seed.mk_couple(c, array['maya', 'sam'], p_now - interval '2 days');
    perform dev_seed.history(c, p_now, -2, -1);
    return;
  end if;

  if p_id = 'empty-history' then
    perform dev_seed.mk_couple(c, array['maya', 'sam'], p_now);
    return;
  end if;

  if p_id in ('history-month', 'delete-account') then
    -- Days -29..0: both answered on 24, one on 4 (-26, -17, -12, -5), missed on 2 (-21, -9); day -4 is d004.
    perform dev_seed.mk_couple(c, array['maya', 'sam'], p_now - interval '30 days');
    perform dev_seed.history(c, p_now, -29, 0, array[-21, -9], array[-26, -17, -12, -5], '{"-4": "d004"}');
    -- Last 7 days: 18 replies, 11 reactions (day -4 has 6 replies).
    perform dev_seed.chat(c, p_now, 0, 3, 2);
    perform dev_seed.chat(c, p_now, -1, 3, 2);
    perform dev_seed.chat(c, p_now, -2, 2, 2);
    perform dev_seed.chat(c, p_now, -3, 2, 1);
    perform dev_seed.chat(c, p_now, -4, 6, 3);
    perform dev_seed.chat(c, p_now, -6, 2, 1);
    if p_id = 'delete-account' then
      delete from auth.users where id = dev_seed.uid('sam');    -- his profile, answers, messages and reactions cascade
      update couple_questions set answer_count = (select count(*) from answers a where a.couple_question_id = couple_questions.id)
        where couple_id = dev_seed.cid(c);
      update couples set status = 'ended', ended_at = p_now where id = dev_seed.cid(c);
    end if;
    return;
  end if;

  if p_id = 'partner-left' then
    -- 12 days of history (-14..-3); Sam left 2 days ago.
    perform dev_seed.mk_couple(c, array['maya', 'sam'], p_now - interval '14 days');
    perform dev_seed.history(c, p_now, -14, -3);
    update couples set status = 'ended', ended_at = p_now - interval '2 days' where id = dev_seed.cid(c);
    update couple_members set left_at = p_now - interval '2 days' where couple_id = dev_seed.cid(c) and user_id = dev_seed.uid('sam');
    return;
  end if;

  if p_id = 'anniversary-today' then
    perform dev_seed.mk_couple(c, array['maya', 'sam'], p_now - interval '5 days');
    perform dev_seed.history(c, p_now, -5, -1);
    update key_dates set date = (v_today - interval '2 years 6 months')::date
     where couple_id = dev_seed.cid(c) and kind = 'together_since';
    return;
  end if;

  raise exception 'dev_seed: scenario % has no builder', p_id;
end $$;

revoke all on all functions in schema dev_seed from public, anon, authenticated;
