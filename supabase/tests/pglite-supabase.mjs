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
    create schema auth; create schema extensions;
    create role authenticated; create role anon; create role service_role;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;`);
  for (const f of files) {
    // pgvector isn't bundled in PGlite, so the AI-phase vector column is swapped for real[].
    const sql = fs.readFileSync(f, 'utf8')
      .replace(/create extension if not exists vector[^;]*;/, '')
      .replace(/extensions\.vector\(\d+\)/g, 'real[]');
    try { await db.exec(sql); } catch (e) { throw new Error(`applying ${path.basename(f)}: ${e.message}`); }
  }
  return db;
}
