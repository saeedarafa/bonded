-- BE-10 / D16: one nudge per sender per couple-local date, only to an unanswered partner.
-- Private ledger contains identifiers/timestamps only and is never a client API.
create table private.nudge_log (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  created_at timestamptz not null,
  unique (sender_id, local_date),
  check (sender_id <> recipient_id)
);
create index nudge_log_couple on private.nudge_log (couple_id);
create index nudge_log_recipient on private.nudge_log (recipient_id);
alter table private.nudge_log enable row level security;
revoke all on private.nudge_log from public, anon, authenticated, service_role;

create function private.send_nudge_at(p_now timestamptz)
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_couple public.couples;
  v_partner uuid;
  v_today date;
  v_cq uuid;
  v_record uuid;
begin
  if v_uid is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  -- Same parent lock as pairing/unpair: a nudge cannot target an ended/replaced couple.
  select * into v_couple from public.couples
    where id = private.my_couple_id() and status = 'active' for update;
  if not found then perform private.raise_error('NOT_PAIRED'); end if;
  if not exists (select 1 from public.couple_members
      where couple_id = v_couple.id and user_id = v_uid and left_at is null) then
    perform private.raise_error('NOT_PAIRED');
  end if;
  select user_id into v_partner from public.couple_members
    where couple_id = v_couple.id and user_id <> v_uid and left_at is null;
  if v_partner is null then perform private.raise_error('NOT_PAIRED'); end if;
  v_today := (p_now at time zone v_couple.timezone)::date;

  -- Answers serialize on this question too. Recheck after acquiring its row lock;
  -- an answer committed before this check must prevent the nudge.
  select id into v_cq from public.couple_questions
    where couple_id = v_couple.id and source = 'daily' and assigned_for = v_today for update;
  if exists (select 1 from public.answers where couple_question_id = v_cq and user_id = v_partner) then
    perform private.raise_error('PARTNER_ALREADY_ANSWERED');
  end if;

  insert into private.nudge_log (couple_id, sender_id, recipient_id, local_date, created_at)
    values (v_couple.id, v_uid, v_partner, v_today, p_now)
    on conflict (sender_id, local_date) do nothing returning id into v_record;
  if v_record is null then perform private.raise_error('NUDGE_LIMIT'); end if;
  -- notify applies the recipient's preferences, quiet hours and push caps. A retry
  -- cannot dispatch again, even when delivery was suppressed or no device exists.
  -- Nudge opens Today; it never carries an answer, message or invite token.
  perform private.dispatch_notify('nudge', v_record, v_couple.id, null, v_uid);
end $$;

create function public.send_nudge()
returns void language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  perform private.send_nudge_at(now());
end $$;
revoke all on function private.send_nudge_at(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.send_nudge() from public, anon, service_role;
grant execute on function public.send_nudge() to authenticated;
