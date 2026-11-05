-- BE-33 / D38: questionnaire history is private to the signed-in person, not their partner.
create table public.onboarding_answers (
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id text not null check (question_id ~ '^[a-z][a-z0-9_]{0,63}$'),
  questionnaire_version integer not null check (questionnaire_version > 0),
  answer jsonb not null check (answer <> 'null'::jsonb and octet_length(answer::text) <= 8192),
  answered_at timestamptz not null default now() check (isfinite(answered_at)),
  primary key (user_id, question_id, questionnaire_version)
);

alter table public.onboarding_answers enable row level security;
revoke all on public.onboarding_answers from public, anon, authenticated;
grant select, insert, update on public.onboarding_answers to authenticated;
grant all on public.onboarding_answers to service_role;

create policy "read own onboarding answers" on public.onboarding_answers
  for select to authenticated using (user_id = (select auth.uid()));
create policy "insert own onboarding answers" on public.onboarding_answers
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own onboarding answers" on public.onboarding_answers
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No client delete, partner policy, Realtime publication, logging trigger or coupling side effect.
