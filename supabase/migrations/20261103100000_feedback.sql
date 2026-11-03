-- BE-15: private monthly check-ins and product feedback (D22).
-- Feedback can contain sensitive relationship context, so it is write-only to the
-- account owner. Support staff access it through the Supabase service role only.

create type public.feedback_kind as enum ('check_in', 'feedback');

create function private.valid_feedback_tags(p_tags text[]) returns boolean
language sql immutable strict set search_path = pg_catalog as $$
  select cardinality(p_tags) <= 12
     and not exists (
       select 1 from unnest(p_tags) tag
        where tag is null or char_length(tag) not between 1 and 80
     )
$$;
-- The table check runs in the submitting role. `private` itself has no API schema
-- usage, so this grant permits the constraint without making the helper callable
-- through PostgREST.
revoke all on function private.valid_feedback_tags(text[]) from public, anon;
grant execute on function private.valid_feedback_tags(text[]) to authenticated;

create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        public.feedback_kind not null,
  score       smallint check (score between 1 and 5),
  tags        text[] not null default '{}' constraint feedback_tags_valid check (private.valid_feedback_tags(tags)),
  body        text not null default '' check (char_length(body) <= 2000),
  app_version text check (char_length(app_version) between 1 and 80),
  created_at  timestamptz not null default now()
);
create index feedback_by_user_created_at on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;
create policy "add own feedback" on public.feedback for insert to authenticated
  with check (user_id = auth.uid());

-- No client reads or changes feedback after submission. Authenticated users receive
-- INSERT only; service_role bypasses RLS for the support workflow.
revoke all on public.feedback from anon;
revoke select, update, delete on public.feedback from authenticated;
