// QA-03 contract harness, run once per `vitest run`.
// 1. Finds the local stack (env vars, else `supabase status -o env` from the repo root).
// 2. Creates the qa/fixtures/personas.json users through the Auth admin API (fixed ids).
// 3. Signs each persona in with a real email OTP (admin generateLink -> verifyOtp), once,
//    so the run stays far below the stack's token_verifications rate limit.
// Local stack only: refuses any URL that isn't localhost / 127.0.0.1.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import type { TestProject } from 'vitest/node';
import { PERSONAS, type PersonaName, type StackEnv } from './personas';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function stackEnv(): StackEnv {
  let src: Record<string, string | undefined> = process.env;
  if (!process.env.SUPABASE_URL && !process.env.API_URL) {
    try {
      src = parseEnv(
        execFileSync('supabase', ['status', '-o', 'env'], { cwd: repoRoot, encoding: 'utf8' }),
      );
    } catch {
      throw new Error(
        'Contract tests need the local Supabase stack: run `supabase start && supabase db reset` ' +
          '(Docker), or set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
  }
  const url = src.SUPABASE_URL ?? src.API_URL;
  const anonKey = src.SUPABASE_ANON_KEY ?? src.ANON_KEY ?? src.PUBLISHABLE_KEY;
  const serviceKey = src.SUPABASE_SERVICE_ROLE_KEY ?? src.SERVICE_ROLE_KEY ?? src.SECRET_KEY;
  if (!url || !anonKey || !serviceKey)
    throw new Error('Supabase URL, anon key or service key missing');
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Contract tests only run against a local stack, not ${host}`);
  }
  const dbUrl =
    src.SUPABASE_DB_URL ?? src.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const dbHost = new URL(dbUrl).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(dbHost)) {
    throw new Error(`Contract tests only run against a local database, not ${dbHost}`);
  }
  const mailUrl = src.MAILPIT_URL ?? src.INBUCKET_URL ?? 'http://127.0.0.1:54324';
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(mailUrl).hostname)) {
    throw new Error(`Contract tests only read a local mail catcher, not ${mailUrl}`);
  }
  return {
    url,
    anonKey,
    serviceKey,
    jwtSecret: src.SUPABASE_JWT_SECRET ?? src.JWT_SECRET,
    dbUrl,
    mailUrl,
  };
}

export default async function setup(project: TestProject) {
  const env = stackEnv();
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(env.url, env.serviceKey, opts);

  const tokens = {} as Record<PersonaName, string>;
  for (const [name, p] of Object.entries(PERSONAS) as [
    PersonaName,
    (typeof PERSONAS)[PersonaName],
  ][]) {
    const { data: existing } = await admin.auth.admin.getUserById(p.id);
    if (!existing?.user) {
      const { error } = await admin.auth.admin.createUser({
        id: p.id,
        email: p.email,
        email_confirm: true,
        user_metadata: { name: p.display_name },
      });
      if (error) throw new Error(`create persona ${name}: ${error.message}`);
    }
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: p.email,
    });
    if (linkError || !link.properties?.email_otp) {
      throw new Error(`OTP for ${name}: ${linkError?.message ?? 'no email_otp'}`);
    }
    const client = createClient(env.url, env.anonKey, opts);
    const { data, error } = await client.auth.verifyOtp({
      email: p.email,
      token: link.properties.email_otp,
      type: 'email',
    });
    if (error || !data.session)
      throw new Error(`sign in ${name}: ${error?.message ?? 'no session'}`);
    if (data.session.user.id !== p.id) throw new Error(`${name} signed in with the wrong id`);
    tokens[name] = data.session.access_token;
  }

  project.provide('stack', env);
  project.provide('tokens', tokens);
}
