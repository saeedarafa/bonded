-- Semgrep rule fixtures for bonded-sql.yml (QA-44b). Not a migration: never applied anywhere.
-- Run: semgrep --test qa/semgrep. A "#" comment line naming a rule id marks the next line as a
-- finding ("ruleid") or a non-finding ("ok"). Generic mode reads "#" annotations only, not "--",
-- so these header lines never carry the annotation words with a colon.
-- CI: qa/ci/semgrep.sh runs these tests and leaves this file out of the scan itself.

-- ===== bonded-sql-security-definer-without-search-path =====

-- Header-first, no search_path.
# ruleid: bonded-sql-security-definer-without-search-path
create or replace function public.f_header_bad()
returns void
language plpgsql
security definer
as $$
begin
  perform 1;
end;
$$;

-- Body-first (SEC-18 #330): attributes after the body, no search_path.
# ruleid: bonded-sql-security-definer-without-search-path
create or replace function public.f_body_first_bad()
returns void as $$
begin
  perform 1;
end;
$$ language plpgsql security definer;

-- Split: language before the body, security definer after it, no search_path.
# ruleid: bonded-sql-security-definer-without-search-path
create function public.f_split_bad() returns int language sql as $$ select 1 $$ security definer;

-- Named dollar tag, body-first, no search_path.
# ruleid: bonded-sql-security-definer-without-search-path
create function public.f_tag_bad() returns int as $fn$ select 1 $fn$ language sql security definer;

-- search_path only inside the body does not count.
# ruleid: bonded-sql-security-definer-without-search-path
create function public.f_body_only_bad() returns void as $$
begin
  perform set_config('search_path', 'public', true);
end;
$$ language plpgsql security definer;

-- Header-first with search_path in the header.
# ok: bonded-sql-security-definer-without-search-path
create or replace function public.f_header_ok()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1;
end;
$$;

-- Header-first, search_path after the body.
# ok: bonded-sql-security-definer-without-search-path
create function public.f_header_trailer_ok() returns void language plpgsql security definer as $$
begin
  perform 1;
end;
$$ set search_path = '';

-- Body-first with search_path after the body.
# ok: bonded-sql-security-definer-without-search-path
create function public.f_body_first_ok() returns void as $$
begin
  perform 1;
end;
$$ language plpgsql security definer set search_path = public;

-- Body-first, search_path in the header.
# ok: bonded-sql-security-definer-without-search-path
create function public.f_body_first_header_ok() returns int set search_path = public as $$
  select 1
$$ language sql security definer;

-- Security invoker (default): no finding even without search_path.
# ok: bonded-sql-security-definer-without-search-path
create function public.f_invoker_ok() returns int as $$ select 1 $$ language sql;

-- "security definer" only inside the body text is not an attribute.
# ok: bonded-sql-security-definer-without-search-path
create function public.f_body_text_ok() returns text as $$ select 'security definer' $$ language sql;

-- ===== bonded-sql-rls-disabled =====

# ruleid: bonded-sql-rls-disabled
alter table public.t disable row level security;

# ok: bonded-sql-rls-disabled
alter table public.t enable row level security;

-- ===== bonded-sql-grant-write-to-anon =====

# ruleid: bonded-sql-grant-write-to-anon
grant insert, update on public.t to anon, authenticated;

# ok: bonded-sql-grant-write-to-anon
grant select on public.t to anon;

-- ===== bonded-sql-policy-using-true =====

# ruleid: bonded-sql-policy-using-true
create policy p_open on public.t for select to authenticated using (true);

# ok: bonded-sql-policy-using-true
create policy p_own on public.t for select to authenticated using (user_id = auth.uid());
