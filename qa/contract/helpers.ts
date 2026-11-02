// Clients and fixtures for the contract tests. Every client goes through PostgREST exactly as
// the app does (supabase-js with the user's session), so RLS, grants and RPC errors are the
// real ones. The service-role `admin` client is only for setup/teardown, never for assertions
// about what a user can see.
import crypto from 'node:crypto';
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { expect, inject } from 'vitest';
import type { Database } from '../../src/types/database';
import { PERSONAS, type PersonaName } from './personas';

export type Db = SupabaseClient<Database>;
export type ErrorCode = Database['public']['Enums']['error_code'];
export { PERSONAS };
export const ID = Object.fromEntries(Object.entries(PERSONAS).map(([n, p]) => [n, p.id])) as Record<
  PersonaName,
  string
>;

const stack = inject('stack');
const tokens = inject('tokens');
const opts = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

const withToken = (token: string): Db =>
  createClient<Database>(stack.url, stack.anonKey, {
    ...opts,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

/** supabase-js signed in as a persona (session from global-setup). */
export const as = (name: PersonaName): Db => withToken(tokens[name]);
/** Signed out: the anon key only. */
export const anon: Db = createClient<Database>(stack.url, stack.anonKey, opts);
/** Service role, for setup and teardown only. */
export const admin: Db = createClient<Database>(stack.url, stack.serviceKey, opts);

/** True when the stack exposes its HS256 JWT secret, needed for noSubject(). */
export const canForgeJwt = Boolean(stack.jwtSecret);
/**
 * A client whose JWT has role `authenticated` but no `sub`: the only way to reach the
 * NOT_AUTHENTICATED branch through the API (a signed-out app uses anon and gets 42501).
 */
export function noSubject(): Db {
  if (!stack.jwtSecret) throw new Error('no JWT secret');
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 600 })}`;
  const sig = crypto.createHmac('sha256', stack.jwtSecret).update(body).digest('base64url');
  return withToken(`${body}.${sig}`);
}

/** Throw on an error so a broken step never looks like a passing assertion. */
export function ok(res: { error: PostgrestError | null }, what: string): void {
  if (res.error) throw new Error(`${what}: ${res.error.code} ${res.error.message}`);
}
/** Like ok(), and returns the data, which must be present. */
export function must<T>(
  res: { data: T; error: PostgrestError | null },
  what: string,
): NonNullable<T> {
  ok(res, what);
  if (res.data == null) throw new Error(`${what}: no data`);
  return res.data as NonNullable<T>;
}

/** CONTRACTS §2 error format: message is exactly the code, SQLSTATE P0001. */
export function expectCode(res: { error: PostgrestError | null }, code: ErrorCode) {
  expect(res.error, `expected ${code}`).not.toBeNull();
  expect({ message: res.error!.message, code: res.error!.code }).toEqual({
    message: code,
    code: 'P0001',
  });
}

/** anon (no grant): Postgres permission denied, 42501, before the function runs. */
export function expectPermissionDenied(res: { error: PostgrestError | null }) {
  expect(res.error, 'expected permission denied').not.toBeNull();
  expect(res.error!.code).toBe('42501');
}

const ALL = Object.values(ID);

/** Every persona unpaired, with no invites, entitlements or push tokens. */
export async function resetWorld() {
  const members = must(
    await admin.from('couple_members').select('couple_id').in('user_id', ALL),
    'read members',
  );
  const couples = [...new Set(members.map((m) => m.couple_id))];
  if (couples.length) ok(await admin.from('couples').delete().in('id', couples), 'delete couples');
  ok(await admin.from('pair_invites').delete().in('inviter_id', ALL), 'delete invites');
  ok(await admin.from('entitlements').delete().in('user_id', ALL), 'delete entitlements');
  ok(await admin.from('push_tokens').delete().in('user_id', ALL), 'delete push tokens');
}

/** Pairs two unpaired personas through the live RPCs; returns the couple id. */
export async function pair(inviter: PersonaName, joiner: PersonaName): Promise<string> {
  const code = must(await as(inviter).rpc('create_invite'), `${inviter} create_invite`);
  return must(await as(joiner).rpc('accept_invite', { p_code: code }), `${joiner} accept_invite`);
}

export const FIX = {
  daily: 'FIXTURE-CONTRACT-DAILY',
  loose: 'FIXTURE-CONTRACT-LOOSE', // in no pack, not daily
  premium: 'FIXTURE-CONTRACT-PREMIUM', // only in the premium pack
  free: 'FIXTURE-CONTRACT-FREE', // in the free pack
} as const;

/**
 * Contract-test content (bodies prefixed FIXTURE-, never shown to users): one daily question,
 * so a stack without seed content still has a library, plus pack questions. Idempotent.
 * Returns the question ids by key.
 */
export async function ensureContent(): Promise<Record<keyof typeof FIX, string>> {
  const wanted = [
    { body: FIX.daily, daily_eligible: true, sort_order: -1000 },
    { body: FIX.loose, daily_eligible: false, sort_order: 0 },
    { body: FIX.premium, daily_eligible: false, sort_order: 0 },
    { body: FIX.free, daily_eligible: false, sort_order: 0 },
  ];
  const bodies = wanted.map((w) => w.body);
  let rows = must(
    await admin.from('questions').select('id, body').in('body', bodies),
    'read questions',
  );
  const missing = wanted.filter((w) => !rows.some((r) => r.body === w.body));
  if (missing.length) {
    ok(await admin.from('questions').insert(missing), 'insert questions');
    rows = must(
      await admin.from('questions').select('id, body').in('body', bodies),
      'read questions',
    );
  }
  const id = (b: string) => rows.find((r) => r.body === b)!.id;

  const packs = must(
    await admin
      .from('question_packs')
      .upsert(
        [
          { slug: 'fixture-contract-premium', title: 'FIXTURE premium', is_premium: true },
          { slug: 'fixture-contract-free', title: 'FIXTURE free', is_premium: false },
        ],
        { onConflict: 'slug' },
      )
      .select('id, slug'),
    'upsert packs',
  );
  const pack = (s: string) => packs.find((p) => p.slug === s)!.id;
  ok(
    await admin.from('pack_questions').upsert(
      [
        { pack_id: pack('fixture-contract-premium'), question_id: id(FIX.premium), position: 1 },
        { pack_id: pack('fixture-contract-free'), question_id: id(FIX.free), position: 1 },
      ],
      { onConflict: 'pack_id,question_id' },
    ),
    'upsert pack items',
  );
  return {
    daily: id(FIX.daily),
    loose: id(FIX.loose),
    premium: id(FIX.premium),
    free: id(FIX.free),
  };
}

/** Marks every active daily-eligible question as used by the couple (for LIBRARY_EXHAUSTED). */
export async function exhaustLibrary(coupleId: string) {
  for (let from = 0; ; from += 1000) {
    const page = must(
      await admin
        .from('questions')
        .select('id')
        .eq('active', true)
        .eq('daily_eligible', true)
        .order('id')
        .range(from, from + 999),
      'read library',
    );
    if (page.length === 0) return;
    ok(
      await admin.from('couple_questions').upsert(
        page.map((q) => ({ couple_id: coupleId, question_id: q.id, source: 'pack' })),
        { onConflict: 'couple_id,question_id', ignoreDuplicates: true },
      ),
      'mark library used',
    );
    if (page.length < 1000) return;
  }
}
