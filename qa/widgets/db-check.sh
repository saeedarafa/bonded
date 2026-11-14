#!/usr/bin/env bash
# QA-49: widget rows for Maya (premium-couple) on a local stack. Never prints a token or its hash.
# Usage: bash qa/widgets/db-check.sh <db container, e.g. supabase_db_qa49c>
set -u
C=$1
docker exec -i "$C" psql -U postgres -X -q -P pager=off <<'SQL'
\echo widget tokens (Maya)
select created_at, expires_at - created_at as lifetime, revoked_at is not null as revoked, last_used_at
  from private.widget_tokens where user_id = '00000000-0000-4000-a000-00000000a001' order by created_at;
\echo usage counters (Maya's tokens)
select u.bucket, u.n, u.window_start from private.widget_token_usage u
  join private.widget_tokens t using (token_hash) where t.user_id = '00000000-0000-4000-a000-00000000a001' order by 1;
\echo little things from the widget (no text exists in this table beyond kind)
select kind, source, created_at, undone_at is not null as undone from public.little_things
  where sender_id = '00000000-0000-4000-a000-00000000a001' order by created_at;
\echo entitlements
select user_id, is_active, product_id, expires_at from public.entitlements order by 1;
SQL
