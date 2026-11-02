-- Phase 2: AI profiles and weekly reports. Apply when the AI features ship, not for the MVP launch.
-- Pipeline: answer inserted -> job queued (if consented) -> worker extracts signals per answer
--           -> weekly cron builds each user's profile -> couple report from revealed answers only.

create extension if not exists vector with schema extensions;

-- Opt-in per person. Nothing is sent to a model without the matching flag.
create table public.ai_consents (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  profile_analysis  boolean not null default false,
  weekly_reports    boolean not null default false,
  updated_at        timestamptz not null default now()
);

-- One row per analysed answer. Internal only: clients never read raw signals.
create table public.answer_signals (
  answer_id      uuid primary key references public.answers(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  couple_id      uuid not null references public.couples(id) on delete cascade,
  themes         text[] not null default '{}',     -- e.g. {communication, trust, intimacy}
  sentiment      numeric(3, 2),                     -- -1.00 .. 1.00
  depth_score    smallint check (depth_score between 1 and 4),
  risk_flag      boolean not null default false,    -- crisis/abuse language: route to support resources, never into a report
  embedding      extensions.vector(1024),           -- dimension must match the embedding model you pick
  model          text not null,
  prompt_version text not null,
  created_at     timestamptz not null default now()
);
create index answer_signals_by_user_time on public.answer_signals (user_id, created_at);

-- Durable work queue processed by an edge-function worker (pg_cron calls it every minute).
create table public.ai_jobs (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('analyze_answer', 'user_profile', 'weekly_report')),
  payload     jsonb not null,
  status      text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts    int not null default 0,
  run_after   timestamptz not null default now(),
  last_error  text,
  created_at  timestamptz not null default now()
);
create index ai_jobs_ready on public.ai_jobs (run_after) where status = 'pending';

-- Each person's evolving profile; private to that person.
create table public.user_ai_profiles (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  summary         text not null,
  traits          jsonb not null default '{}',     -- love languages, communication style, recurring themes...
  version         int not null default 1,
  model           text not null,
  prompt_version  text not null,
  updated_at      timestamptz not null default now()
);

-- Shared couple report, built only from answers both partners have already seen.
create table public.weekly_reports (
  id              uuid primary key default gen_random_uuid(),
  couple_id       uuid not null references public.couples(id) on delete cascade,
  week_start      date not null,
  status          text not null default 'pending' check (status in ('pending', 'ready', 'insufficient_data', 'failed')),
  content         jsonb,                            -- {highlights, strengths, growth_areas, suggested_questions}
  model           text,
  prompt_version  text,
  created_at      timestamptz not null default now(),
  unique (couple_id, week_start)
);

-- Queue analysis for consenting users as answers arrive.
create or replace function public.enqueue_answer_analysis() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from ai_consents where user_id = new.user_id and profile_analysis) then
    insert into ai_jobs (kind, payload) values ('analyze_answer', jsonb_build_object('answer_id', new.id));
  end if;
  return new;
end $$;

create trigger answers_enqueue_ai
  after insert or update of body on public.answers
  for each row execute function public.enqueue_answer_analysis();

alter table public.ai_consents      enable row level security;
alter table public.answer_signals   enable row level security;  -- no policies: service role only
alter table public.ai_jobs          enable row level security;  -- no policies: service role only
alter table public.user_ai_profiles enable row level security;
alter table public.weekly_reports   enable row level security;

create policy "own consent" on public.ai_consents for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own profile" on public.user_ai_profiles for select to authenticated
  using (user_id = auth.uid());
create policy "own couple reports" on public.weekly_reports for select to authenticated
  using (couple_id = public.my_couple_id() and status = 'ready');
