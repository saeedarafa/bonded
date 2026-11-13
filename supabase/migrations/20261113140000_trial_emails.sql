-- BE-48d (D50, ACCOUNTS 16): the day-5 trial reminder **email**, next to the `trial_ending` push.
--
-- Same trial, same day-5 window and same quiet hours as `due_trial_endings` (BE-48), but its own
-- ledger: the email must reach people who have no device token or have push turned off, and it
-- must not count toward the D24 push cap. One email per user and trial start, whatever happens.
--
-- Flow (daily-reminder, every 15 minutes, only when RESEND_API_KEY is set):
--   claim_trial_emails(p_now)  → rows {claim_id, email, first_name, ends_at, timezone}
--   send through Resend         → trial_email_result(claim_id, outcome)
-- Outcomes: 'sent' (done), 'rejected' (Resend refused the message, e.g. invalid address: never
-- retried), 'retry' (rate limit or Resend 5xx: the claim is released, the next tick inside the
-- window tries again). A send whose outcome is unknown (network error, timeout) keeps its claim,
-- so nothing is ever sent twice.
--
-- Only a confirmed account email is used (auth.users.email_confirmed_at). The address never leaves
-- the database except to the daily-reminder function (service role), and is never logged.

create table private.trial_emails (
  user_id uuid not null references public.profiles(id) on delete cascade,
  trial_started_at timestamptz not null,
  id uuid not null default gen_random_uuid() unique,
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'rejected')),
  claimed_at timestamptz not null,
  finished_at timestamptz,
  primary key (user_id, trial_started_at)
);
alter table private.trial_emails enable row level security;
revoke all on private.trial_emails from public, anon, authenticated, service_role;

create function public.claim_trial_emails(p_now timestamptz default now(), p_limit integer default 20)
returns table (claim_id uuid, email text, first_name text, ends_at timestamptz, timezone text)
language plpgsql security definer
set search_path = pg_catalog, extensions, public, pg_temp as $$
declare r record; v_id uuid; v_left integer;
begin
  if p_now is null or not isfinite(p_now) then return; end if;
  v_left := least(greatest(coalesce(p_limit, 20), 0), 100);
  if v_left = 0 then return; end if;
  for r in
    select t.user_id uid, t.started_at, t.ends_at, u.email, p.timezone tz,
      private.first_name(p.display_name) fname
    from private.subscription_trials t
    cross join lateral (select least(t.started_at + interval '4 days',
      t.ends_at - interval '2 days') due_at) d
    join public.entitlements e on e.user_id=t.user_id and e.is_active
      and e.expires_at is not null and e.expires_at > p_now
    join public.profiles p on p.id=t.user_id
    join public.notification_prefs np on np.user_id=t.user_id
    join auth.users u on u.id=t.user_id
    where t.will_renew and d.due_at > t.started_at
      and p_now >= d.due_at and p_now < least(d.due_at + interval '24 hours', t.ends_at)
      and u.email is not null and position('@' in u.email) > 1 and char_length(u.email) <= 320
      and u.email_confirmed_at is not null
      and not exists (select 1 from private.trial_emails x
        where x.user_id=t.user_id and x.trial_started_at=t.started_at)
      and not (case when np.quiet_start<np.quiet_end
        then (p_now at time zone p.timezone)::time>=np.quiet_start
          and (p_now at time zone p.timezone)::time<np.quiet_end
        else (p_now at time zone p.timezone)::time>=np.quiet_start
          or (p_now at time zone p.timezone)::time<np.quiet_end end)
    order by t.user_id
  loop
    exit when v_left <= 0;
    v_id := null;
    insert into private.trial_emails(user_id,trial_started_at,claimed_at)
      values(r.uid,r.started_at,p_now) on conflict do nothing returning id into v_id;
    if v_id is null then continue; end if;
    v_left := v_left - 1;
    claim_id := v_id; email := r.email; first_name := r.fname;
    ends_at := r.ends_at; timezone := r.tz;
    return next;
  end loop;
end $$;
revoke all on function public.claim_trial_emails(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_trial_emails(timestamptz, integer) to service_role;

-- Records the outcome of one claimed email. Only a still-claimed row changes; a replayed result is
-- a no-op, and so is an unknown outcome. Returns whether a row changed.
create function public.trial_email_result(p_claim uuid, p_outcome text, p_now timestamptz default now())
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_n integer;
begin
  if p_claim is null or p_now is null or not isfinite(p_now) then return false; end if;
  if p_outcome = 'retry' then
    delete from private.trial_emails where id=p_claim and status='claimed';
  elsif p_outcome in ('sent', 'rejected') then
    update private.trial_emails set status=p_outcome, finished_at=p_now
      where id=p_claim and status='claimed';
  else
    return false;
  end if;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.trial_email_result(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.trial_email_result(uuid, text, timestamptz) to service_role;
