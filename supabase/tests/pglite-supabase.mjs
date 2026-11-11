// Shared PGlite setup for Bonded's Docker-free DB tooling (owner: backend).
// Creates minimal Supabase stand-ins (auth schema, auth.uid(), roles, realtime publication),
// then applies migrations in order. Used by rls.test.mjs and gen-types.mjs.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const supabaseDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every .sql file in supabase/migrations/, in filename order (what `supabase db reset` applies). */
export function defaultMigrations() {
  const dir = path.join(supabaseDir, 'migrations');
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => path.join(dir, f));
}

export async function createDb(files = defaultMigrations()) {
  if (files.length === 0) throw new Error('no migrations given');
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth; create schema extensions; create schema storage;
    create role authenticated; create role anon; create role service_role;
    create table auth.users (
      id uuid primary key, instance_id uuid, aud text, role text, email text, email_confirmed_at timestamptz,
      raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', is_anonymous boolean default false,
      confirmation_token text, recovery_token text, email_change_token_new text, email_change text,
      created_at timestamptz default now(), updated_at timestamptz default now());
    create table auth.identities (
      id uuid primary key default gen_random_uuid(), provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
      identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text not null references storage.buckets(id),
      name text not null, owner_id text, metadata jsonb, version text, created_at timestamptz not null default now(),
      unique (bucket_id, name));
    alter table storage.objects enable row level security;
    create function storage.foldername(p_name text) returns text[] language sql immutable
      as $$ select string_to_array(p_name, '/') $$;
    -- Supabase's default privileges: API roles get access to new public objects at creation time,
    -- so a migration's later revoke/grant is what decides access (as on the real stack).
    grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    grant all on storage.buckets, storage.objects to anon, authenticated, service_role;`);
  for (const f of files) {
    // pgvector isn't bundled in PGlite, so the AI-phase vector column is swapped for real[].
    const sql = fs.readFileSync(f, 'utf8')
      .replace(/create extension if not exists vector[^;]*;/, '')
      .replace(/extensions\.vector\(\d+\)/g, 'real[]');
    try { await db.exec(sql); } catch (e) { throw new Error(`applying ${path.basename(f)}: ${e.message}`); }
  }
  return db;
}
