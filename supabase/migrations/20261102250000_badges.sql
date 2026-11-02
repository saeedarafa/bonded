-- BE-12: badge catalogue and streak awards (D19).
create type public.badge_kind as enum ('streak', 'achievement');
create type public.badge_owner as enum ('shared', 'personal');

create table public.badges (
  slug        text primary key check (slug ~ '^[a-z0-9-]+$'),
  kind        public.badge_kind not null,
  owner       public.badge_owner not null,
  threshold   integer not null check (threshold > 0),
  title       text not null check (char_length(title) between 1 and 80),
  description text not null check (char_length(description) between 1 and 240),
  priority    text not null check (priority in ('P0', 'P1', 'P2')),
  status      text not null check (status in ('placeholder', 'approved'))
);
alter table public.badges enable row level security;
create policy "read badge catalogue" on public.badges for select to authenticated using (true);
revoke all on public.badges from anon;

create table public.badge_awards (
  id          uuid primary key default gen_random_uuid(),
  badge_slug  text not null references public.badges(slug) on delete restrict,
  couple_id   uuid references public.couples(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  awarded_at  timestamptz not null default now(),
  check (num_nonnulls(couple_id, user_id) = 1),
  unique (badge_slug, couple_id),
  unique (badge_slug, user_id)
);
create index badge_awards_by_couple on public.badge_awards (couple_id, awarded_at desc) where couple_id is not null;
create index badge_awards_by_user on public.badge_awards (user_id, awarded_at desc) where user_id is not null;
alter table public.badge_awards enable row level security;
create policy "read own badge awards" on public.badge_awards for select to authenticated
  using (user_id = auth.uid() or private.can_read_couple(couple_id));
revoke insert, update, delete on public.badge_awards from anon, authenticated;
revoke all on public.badge_awards from anon;

-- Streak rows are server-owned. Award every crossed shared streak threshold once; a late answer
-- may jump several days when it merges a gap, so use the previous current value as the lower bound.
create or replace function private.award_streak_badges_after_update() returns trigger
language plpgsql security definer set search_path = pg_catalog, extensions, public, pg_temp as $$
begin
  if new.current > old.current then
    insert into public.badge_awards (badge_slug, couple_id)
      select b.slug, new.couple_id
        from public.badges b
       where b.kind = 'streak' and b.owner = 'shared'
         and b.threshold > old.current and b.threshold <= new.current
      on conflict (badge_slug, couple_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function private.award_streak_badges_after_update() from public, anon, authenticated;
create trigger couple_streaks_award_badges
  after update of current on public.couple_streaks
  for each row when (new.current > old.current)
  execute function private.award_streak_badges_after_update();
