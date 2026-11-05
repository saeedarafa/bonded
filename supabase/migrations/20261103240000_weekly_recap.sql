-- BE-14 / D21: revealed pair-period recap, server-side premium boundary, Sunday delivery.
create type public.weekly_recap_state as (
  days_together integer, replies integer, reactions integer,
  most_loved_answer_id uuid, is_full boolean
);

-- Internal selection shared by the app recap and service-only push. Never selects user text.
create function private.recap_questions(p_couple uuid, p_now timestamptz)
returns table (id uuid, source text, assigned_for date)
language sql stable security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
  select q.id, q.source, q.assigned_for
  from public.couple_questions q
  join public.couples c on c.id=q.couple_id and c.status='active'
  where q.couple_id=p_couple and private.cq_in_pair_period(q.id)
    and (select count(*) from public.couple_members m
      where m.couple_id=c.id and m.left_at is null)=2
    and (select count(*) from public.answers a join public.couple_members m
      on m.user_id=a.user_id and m.couple_id=c.id and m.left_at is null
      where a.couple_question_id=q.id and a.created_at<=p_now)=2
$$;
revoke all on function private.recap_questions(uuid,timestamptz) from public, anon, authenticated, service_role;

create function private.recap_days(p_couple uuid, p_week date, p_now timestamptz) returns integer
language sql stable security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
  select count(*)::integer from private.recap_questions(p_couple,p_now) q
  join public.couples c on c.id=p_couple
  where q.source='daily' and q.assigned_for>=p_week and q.assigned_for<p_week+7
    and q.assigned_for<=(p_now at time zone c.timezone)::date
$$;
revoke all on function private.recap_days(uuid,date,timestamptz) from public, anon, authenticated, service_role;

create function private.weekly_recap_at(p_week_start date, p_now timestamptz)
returns public.weekly_recap_state
language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare
  v_couple uuid := private.my_couple_id(); v_zone text; v_week date;
  v_start timestamptz; v_end timestamptz; v_result public.weekly_recap_state;
begin
  if auth.uid() is null then perform private.raise_error('NOT_AUTHENTICATED'); end if;
  if v_couple is null then perform private.raise_error('NOT_PAIRED'); end if;
  select c.timezone into v_zone from public.couples c where c.id=v_couple for update;
  if private.my_couple_id() is distinct from v_couple then perform private.raise_error('NOT_PAIRED'); end if;
  v_week:=coalesce(p_week_start,date_trunc('week',p_now at time zone v_zone)::date);
  v_start:=v_week::timestamp at time zone v_zone;
  v_end:=(v_week+7)::timestamp at time zone v_zone;
  v_result.days_together:=private.recap_days(v_couple,v_week,p_now);
  select exists(select 1 from public.entitlements e join public.couple_members m on m.user_id=e.user_id
    where m.couple_id=v_couple and m.left_at is null and e.is_active
      and (e.expires_at is null or e.expires_at>p_now)) into v_result.is_full;
  if not v_result.is_full then return v_result; end if;

  with eligible as materialized (select id from private.recap_questions(v_couple,p_now)),
  members as (select user_id from public.couple_members where couple_id=v_couple and left_at is null),
  week_reactions as materialized (
    select r.id,r.answer_id from public.reactions r
    left join public.answers a on a.id=r.answer_id
    left join public.thread_messages t on t.id=r.message_id
    where coalesce(a.couple_question_id,t.couple_question_id) in (select id from eligible)
      and r.user_id in (select user_id from members)
      and r.created_at>=v_start and r.created_at<v_end and r.created_at<=p_now
  )
  select
    (select count(*)::integer from public.thread_messages t where t.couple_question_id in (select id from eligible)
      and t.user_id in (select user_id from members)
      and t.created_at>=v_start and t.created_at<v_end and t.created_at<=p_now),
    (select count(*)::integer from week_reactions),
    (select a.id from public.answers a join week_reactions r on r.answer_id=a.id
      where a.user_id in (select user_id from members)
      group by a.id order by count(*) desc,a.created_at desc,a.id desc limit 1)
  into v_result.replies,v_result.reactions,v_result.most_loved_answer_id;
  return v_result;
end $$;
revoke all on function private.weekly_recap_at(date,timestamptz) from public, anon, authenticated, service_role;

create function public.weekly_recap(p_week_start date) returns public.weekly_recap_state
language sql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
  select private.weekly_recap_at(p_week_start,now())
$$;
revoke all on function public.weekly_recap(date) from public, anon;
grant execute on function public.weekly_recap(date) to authenticated;

-- One recipient/week claim survives re-pairing, missing devices and uncertain delivery.
create table public.weekly_recap_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  id uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  primary key (user_id,week_start)
);
alter table public.weekly_recap_log enable row level security;
revoke all on public.weekly_recap_log from public, anon, authenticated;

create function public.due_weekly_recaps(p_now timestamptz default now())
returns table (user_id uuid, claim_id uuid, days_together integer)
language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r record; v_id uuid; v_claim uuid;
begin
  if p_now is null then return; end if;
  for r in
    select m.user_id uid,c.id couple_id,
      date_trunc('week',p_now at time zone c.timezone)::date week,
      (p_now at time zone p.timezone)::date push_date
    from public.couple_members m
    join public.couples c on c.id=m.couple_id and c.status='active'
    join public.profiles p on p.id=m.user_id
    join public.notification_prefs np on np.user_id=m.user_id
    where m.left_at is null and np.replies
      and extract(isodow from p_now at time zone c.timezone)=7
      and (p_now at time zone c.timezone)::time>=time '18:00'
      and (p_now at time zone c.timezone)::time<time '18:15'
      and not (case when np.quiet_start<np.quiet_end
        then (p_now at time zone p.timezone)::time>=np.quiet_start
          and (p_now at time zone p.timezone)::time<np.quiet_end
        else (p_now at time zone p.timezone)::time>=np.quiet_start
          or (p_now at time zone p.timezone)::time<np.quiet_end end)
    order by c.id,m.user_id
  loop
    perform 1 from public.couples c where c.id=r.couple_id for update;
    -- Recheck membership after waiting for a concurrent unpair/delete.
    if not exists(select 1 from public.couple_members m join public.couples c on c.id=m.couple_id
      where c.id=r.couple_id and c.status='active' and m.user_id=r.uid and m.left_at is null)
      or (select count(*) from public.couple_members m where m.couple_id=r.couple_id and m.left_at is null)<>2
      then continue; end if;
    perform pg_advisory_xact_lock(hashtext(r.uid::text));
    if exists(select 1 from public.push_log p where p.user_id=r.uid and p.type='weekly_recap'
      and p.local_date=r.push_date and p.status in ('claimed','sent')) then continue; end if;
    v_id:=null;
    insert into public.weekly_recap_log(user_id,week_start,created_at)
      values(r.uid,r.week,p_now) on conflict do nothing returning id into v_id;
    if v_id is null then continue; end if;
    select p.claim_id into v_claim from private.claim_push(r.uid,'weekly_recap',v_id,null,r.push_date,p_now) p;
    if v_claim is null then continue; end if;
    user_id:=r.uid; claim_id:=v_claim;
    days_together:=private.recap_days(r.couple_id,r.week,p_now);
    return next;
  end loop;
end $$;
revoke all on function public.due_weekly_recaps(timestamptz) from public, anon, authenticated;
grant execute on function public.due_weekly_recaps(timestamptz) to service_role;
