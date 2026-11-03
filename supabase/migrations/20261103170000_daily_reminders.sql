-- BE-19: service-only, atomic reminder selection. No answer/message text is read or stored.
create table public.reminder_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  type public.push_type not null check (type in ('ritual_reminder', 'last_call')),
  id uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  primary key (user_id, local_date, type)
);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from public, anon, authenticated;

-- Selection and both ledgers are committed together before Edge delivery. A retry never sends
-- twice, including an unknown Expo outcome; delivery failure deliberately does not release claims.
create function public.due_reminders(p_now timestamptz default now())
returns table (user_id uuid, type public.push_type, claim_id uuid, streak integer,
  partner_name text, partner_answered boolean)
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r record; v_id uuid; v_claim uuid;
begin
  if p_now is null then return; end if;
  for r in
    with members as (
      select c.id couple_id, c.timezone couple_tz, p.timezone user_tz,
        np.*, p_now at time zone p.timezone user_now, p_now at time zone c.timezone couple_now,
        s.current streak, s.last_completed_on,
        (select count(*) from public.couple_members cm where cm.couple_id=c.id and cm.left_at is null) members
      from public.couple_members m
      join public.couples c on c.id=m.couple_id and c.status='active'
      join public.profiles p on p.id=m.user_id
      join public.notification_prefs np on np.user_id=m.user_id
      left join public.couple_streaks s on s.couple_id=c.id
      where m.left_at is null
    ), candidates as (
      select m.*, t.kind, t.due_at from members m cross join lateral (
        values
          ('ritual_reminder'::public.push_type,
           m.user_now::date + m.ritual_time - case when m.user_now::time < m.ritual_time then interval '1 day' else interval '0' end),
          ('last_call'::public.push_type,
           m.couple_now::date + time '22:30' - case when m.couple_now::time < time '22:30' then interval '1 day' else interval '0' end)
      ) t(kind, due_at)
    )
    select c.user_id uid, c.kind, c.due_at::date scheduled_date, c.user_now::date push_date,
      coalesce(c.streak,0) run, cq.id cq_id,
      (select left(p.display_name,30) from public.couple_members pm join public.profiles p on p.id=pm.user_id
        where pm.couple_id=c.couple_id and pm.left_at is null and pm.user_id<>c.user_id limit 1) partner,
      exists(select 1 from public.answers a where a.couple_question_id=cq.id and a.user_id<>c.user_id) partner_done
    from candidates c
    left join public.couple_questions cq on cq.couple_id=c.couple_id
      and cq.source='daily' and cq.assigned_for=c.couple_now::date
    where
      -- Quiet hours and cap dates belong to the recipient; daily progress to the couple.
      not (case when c.quiet_start<c.quiet_end
        then c.user_now::time>=c.quiet_start and c.user_now::time<c.quiet_end
        else c.user_now::time>=c.quiet_start or c.user_now::time<c.quiet_end end)
      and ((c.kind='ritual_reminder' and c.daily_reminder
        and c.user_now>=c.due_at and c.user_now<c.due_at+interval '15 minutes'
        and not exists(select 1 from public.answers a where a.couple_question_id=cq.id and a.user_id=c.user_id))
      or (c.kind='last_call' and c.last_call and c.members=2 and c.streak>=3
        and c.last_completed_on=c.couple_now::date-1
        and c.couple_now>=c.due_at and c.couple_now<c.due_at+interval '15 minutes'
        and coalesce(cq.answer_count,0)<2))
    order by c.user_id, c.kind
  loop
    -- Same lock as event-driven pushes, so every type shares the four/day cap.
    perform pg_advisory_xact_lock(hashtext(r.uid::text));
    if exists(select 1 from public.push_log pl where pl.user_id=r.uid and pl.type=r.kind
      and pl.local_date=r.push_date and pl.status in ('claimed','sent')) then continue; end if;
    v_id := null;
    insert into public.reminder_log(user_id,local_date,type,created_at)
      values(r.uid,r.scheduled_date,r.kind,p_now)
      on conflict do nothing returning id into v_id;
    if v_id is null then continue; end if;
    select cp.claim_id into v_claim from private.claim_push(r.uid,r.kind,v_id,r.cq_id,r.push_date,p_now) cp;
    if v_claim is null then continue; end if;
    user_id:=r.uid; type:=r.kind; claim_id:=v_claim; streak:=r.run;
    partner_name:=coalesce(r.partner,''); partner_answered:=r.partner_done;
    return next;
  end loop;
end $$;
revoke all on function public.due_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.due_reminders(timestamptz) to service_role;

create function private.dispatch_daily_reminders() returns void
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
declare v_url text; v_secret text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''functions_url''' into v_url;
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''internal_function_secret''' into v_secret;
  exception when undefined_table then return; end;
  if v_url is null or v_secret is null or to_regnamespace('net') is null then return; end if;
  execute 'select net.http_post($1, $2::jsonb, $3::jsonb)'
    using v_url || '/functions/v1/daily-reminder', '{}'::jsonb,
      jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_secret);
exception when undefined_function then return;
end $$;
revoke all on function private.dispatch_daily_reminders() from public, anon, authenticated, service_role;

do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron;
    if not exists(select 1 from cron.job where jobname='daily-reminders-quarter-hour') then
      perform cron.schedule('daily-reminders-quarter-hour','*/15 * * * *','select private.dispatch_daily_reminders()');
    end if;
  end if;
end $$;
