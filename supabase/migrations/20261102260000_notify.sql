-- BE-08: notification ledger and database-to-function dispatch (D23-D25, D29).
-- The ledger deliberately contains no answer/message content.  `notify` reads the current
-- record through the service-role client and applies preferences/caps before it sends.

create type public.push_type as enum (
  'partner_answered', 'both_answered', 'thread_activity', 'partner_joined',
  'nudge', 'partner_premium', 'ritual_reminder', 'last_call', 'weekly_recap', 'tips', 'celebration'
);

create table public.push_log (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  type                public.push_type not null,
  record_id           uuid not null,
  couple_question_id  uuid references public.couple_questions(id) on delete cascade,
  local_date          date not null,
  status              text not null default 'claimed' check (status in ('claimed', 'sent', 'suppressed')),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  unique (user_id, type, record_id)
);
create index push_log_caps on public.push_log (user_id, local_date, created_at desc);
create index push_log_groups on public.push_log (user_id, type, couple_question_id, created_at desc)
  where type = 'thread_activity';
alter table public.push_log enable row level security;
revoke all on public.push_log from anon, authenticated;

-- On hosted Supabase, Vault holds `functions_url` and `internal_function_secret`.  Local/PGlite
-- environments deliberately have neither Vault nor pg_net, so this is a safe no-op there.
create or replace function private.dispatch_notify(
  p_type public.push_type, p_record_id uuid, p_couple_id uuid,
  p_couple_question_id uuid, p_actor_user_id uuid
) returns void language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_url text; v_secret text; v_payload jsonb;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''functions_url''' into v_url;
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret''' into v_secret;
  exception when undefined_table then return;
  end;
  if v_url is null or v_secret is null or to_regnamespace('net') is null then return; end if;
  v_payload := jsonb_build_object('type', p_type, 'record_id', p_record_id, 'couple_id', p_couple_id,
    'couple_question_id', p_couple_question_id, 'actor_user_id', p_actor_user_id);
  execute 'select net.http_post($1, $2::jsonb, $3::jsonb)'
    using v_url || '/functions/v1/notify', v_payload,
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
exception when undefined_function then
  -- pg_net can be unavailable on local development and PGlite.
  return;
end $$;
revoke all on function private.dispatch_notify(public.push_type, uuid, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function private.notify_after_answer() returns trigger language plpgsql
security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_couple uuid; v_answers integer;
begin
  select couple_id into v_couple from public.couple_questions where id = new.couple_question_id;
  select count(*) into v_answers from public.answers where couple_question_id = new.couple_question_id;
  perform private.dispatch_notify((case when v_answers = 2 then 'both_answered' else 'partner_answered' end)::public.push_type,
    new.id, v_couple, new.couple_question_id, new.user_id);
  return new;
end $$;
create trigger notify_after_answer after insert on public.answers
  for each row execute function private.notify_after_answer();

create or replace function private.notify_after_thread_activity() returns trigger language plpgsql
security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_cq uuid; v_couple uuid; v_actor uuid;
begin
  if tg_table_name = 'thread_messages' then v_cq := new.couple_question_id; v_actor := new.user_id;
  else select coalesce(a.couple_question_id, m.couple_question_id) into v_cq
       from public.reactions r left join public.answers a on a.id = r.answer_id
       left join public.thread_messages m on m.id = r.message_id where r.id = new.id; v_actor := new.user_id;
  end if;
  select couple_id into v_couple from public.couple_questions where id = v_cq;
  perform private.dispatch_notify('thread_activity', new.id, v_couple, v_cq, v_actor);
  return new;
end $$;
create trigger notify_after_thread_message after insert on public.thread_messages
  for each row execute function private.notify_after_thread_activity();
create trigger notify_after_reaction after insert on public.reactions
  for each row execute function private.notify_after_thread_activity();

create or replace function private.notify_after_member_joined() returns trigger language plpgsql
security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if (select count(*) from public.couple_members where couple_id = new.couple_id and left_at is null) = 2 then
    perform private.dispatch_notify('partner_joined', gen_random_uuid(), new.couple_id, null, new.user_id);
  end if;
  return new;
end $$;
create trigger notify_after_member_joined after insert on public.couple_members
  for each row execute function private.notify_after_member_joined();
