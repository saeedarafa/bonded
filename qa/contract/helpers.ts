// Clients and fixtures for the contract tests. Every client goes through PostgREST exactly as
// the app does (supabase-js with the user's session), so RLS, grants and RPC errors are the
// real ones. The service-role `admin` client is only for setup/teardown, never for assertions
// about what a user can see.
import crypto from 'node:crypto';
import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { expect, inject } from 'vitest';
import type { Database } from '../../src/types/database';
import { PERSONAS, type PersonaName } from './personas';

export type Db = SupabaseClient<Database>;
export type ErrorCode = Database['public']['Enums']['error_code'];
type StageList = Database['public']['Enums']['couple_stage'][];
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
/** A persona's access token (for Edge Functions that take a user JWT, e.g. revenuecat-sync). */
export const tokenOf = (name: PersonaName): string => tokens[name];
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

/**
 * Every persona unpaired, with no invites, entitlements or push tokens, and a clean failed-
 * invite-attempt log (the D02 limiter keys on the user, or for anon on the client IP, so tests
 * would otherwise inherit each other's failures).
 */
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
  await resetAttempts();
}

/**
 * Direct SQL on the local stack's Postgres, for what the API never exposes (the `private`
 * schema: failed-invite-attempt log) and for pinning the clock. Reads and test setup only.
 */
export async function sql<T extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: stack.dbUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

export const resetAttempts = async () => {
  await sql('delete from private.invite_attempts');
  await sql('delete from private.invite_failure_counts'); // BE-04c global counter
};

/** Counted failed invite attempts of a persona (the failed row must persist: D02). */
export async function failedAttempts(who: PersonaName): Promise<number> {
  const rows = await sql<{ n: number }>(
    'select count(*)::int n from private.invite_attempts where actor = $1',
    [`u:${ID[who]}`],
  );
  return rows[0].n;
}

/**
 * Calls private.accept_invite_at / invite_preview_at as a persona with the clock pinned to
 * `now` (the public RPCs pass now()). A raised error comes back as `{ raised: 'CODE' }`, a
 * returned body (the HTTP 400 path) as `{ body }`.
 */
export async function atTime(
  fn: 'accept_invite_at' | 'invite_preview_at',
  who: PersonaName,
  code: string,
  token: string | null,
  now: Date,
): Promise<{ body?: unknown; raised?: string }> {
  const client = new pg.Client({ connectionString: stack.dbUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify({ sub: ID[who], role: 'authenticated' }), ID[who]],
    );
    try {
      const res = await client.query(`select private.${fn}($1, $2, $3::timestamptz) as r`, [
        code,
        token,
        now.toISOString(),
      ]);
      await client.query('commit');
      return { body: res.rows[0].r };
    } catch (e) {
      await client.query('rollback');
      return { raised: (e as Error).message };
    }
  } finally {
    await client.end();
  }
}

/**
 * Runs one SQL statement as a signed-in persona (JWT claims set for the transaction), for
 * private functions that take a pinned clock, e.g. `select * from private.get_streak_at($1)`.
 * A raised error comes back as `{ raised: message }`.
 */
export async function callAs<T extends pg.QueryResultRow = Record<string, unknown>>(
  who: PersonaName,
  text: string,
  params: unknown[] = [],
): Promise<{ rows?: T[]; raised?: string }> {
  const client = new pg.Client({ connectionString: stack.dbUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify({ sub: ID[who], role: 'authenticated' }), ID[who]],
    );
    try {
      const res = await client.query<T>(text, params);
      await client.query('commit');
      return { rows: res.rows };
    } catch (e) {
      await client.query('rollback');
      return { raised: (e as Error).message };
    }
  } finally {
    await client.end();
  }
}

export type Invite = { code: string; expires_at: string; token: string };

/** create_invite as a persona; asserts the BE-04 shape. */
export async function createInvite(who: PersonaName): Promise<Invite> {
  const inv = must(await as(who).rpc('create_invite'), `${who} create_invite`);
  if (!inv.code || !inv.expires_at || !inv.token)
    throw new Error(`create_invite: ${JSON.stringify(inv)}`);
  return inv as Invite;
}

/** Another 4-digit code than `code` (for "unknown code" cases). */
export const otherCode = (code: string) => (code === '0000' ? '0001' : '0000');

/** BE-26 (D02): what accept_invite returns for a typed code without a token. */
export type PendingJoin = { status: 'pending'; request_id: string; expires_at: string };

/** Asserts the pending-request shape exactly (no couple id or anything else in it). */
export function asPending(data: unknown, what = 'accept_invite'): PendingJoin {
  const d = data as Partial<PendingJoin> | null;
  if (
    !d ||
    typeof d !== 'object' ||
    d.status !== 'pending' ||
    typeof d.request_id !== 'string' ||
    typeof d.expires_at !== 'string' ||
    Object.keys(d).sort().join() !== 'expires_at,request_id,status'
  )
    throw new Error(`${what}: expected a pending join request, got ${JSON.stringify(data)}`);
  return d as PendingJoin;
}

/**
 * BE-35 (D37): a joiner who has a solo couple must pass `p_archive_own: true` (the D37 sheet's
 * confirm) or gets CONFIRM_ARCHIVE. Callers that mean "archive my solo space" pass
 * `{ archiveOwn: true }`; an unpaired joiner needs nothing (the flag is then omitted).
 */
export type JoinOpts = { archiveOwn?: boolean };

const archiveArg = (opts: JoinOpts) =>
  opts.archiveOwn === undefined ? {} : { p_archive_own: opts.archiveOwn };

/** The joiner types the code (no token): a pending request, nobody paired yet (BE-26, D02). */
export async function requestJoin(
  joiner: PersonaName,
  code: string,
  opts: JoinOpts = {},
): Promise<PendingJoin> {
  return asPending(
    must(
      await as(joiner).rpc('accept_invite', { p_code: code, ...archiveArg(opts) }),
      `${joiner} accept_invite`,
    ),
  );
}

/** The inviter approves a pending request; returns the couple id (a json string). */
export async function approveJoin(inviter: PersonaName, requestId: string): Promise<string> {
  const id = must(
    await as(inviter).rpc('approve_join', { p_request: requestId }),
    `${inviter} approve_join`,
  );
  if (typeof id !== 'string') throw new Error(`approve_join: ${JSON.stringify(id)}`);
  return id;
}

/** Typed code -> pending -> the inviter approves. Returns the couple id. */
export async function joinByCode(
  joiner: PersonaName,
  inviter: PersonaName,
  code: string,
  opts: JoinOpts = {},
): Promise<string> {
  const req = await requestJoin(joiner, code, opts);
  return approveJoin(inviter, req.request_id);
}

/** The invite link (code + a valid token): pairs at once. Returns the couple id. */
export async function joinByLink(
  joiner: PersonaName,
  invite: Invite,
  opts: JoinOpts = {},
): Promise<string> {
  const id = must(
    await as(joiner).rpc('accept_invite', {
      p_code: invite.code,
      p_token: invite.token,
      ...archiveArg(opts),
    }),
    `${joiner} accept_invite (link)`,
  );
  if (typeof id !== 'string') throw new Error(`accept_invite (link): ${JSON.stringify(id)}`);
  return id;
}

/**
 * Pairs two unpaired personas through the live RPCs; returns the couple id. Since BE-03 the
 * inviter creates a solo couple first (create_couple); the joiner has no couple (a joiner with
 * a solo couple is covered separately: D04). Since BE-26 (D02) a typed code only creates a
 * request, so `via: 'code'` (default) is typed code -> pending -> inviter approve_join, and
 * `via: 'link'` is the invite link (code + token), which pairs at once. A joiner who has a solo
 * couple passes `{ archiveOwn: true }` (BE-35).
 */
export async function pair(
  inviter: PersonaName,
  joiner: PersonaName,
  via: 'code' | 'link' = 'code',
  opts: JoinOpts = {},
): Promise<string> {
  must(await as(inviter).rpc('create_couple', { p_stage: 'dating' }), `${inviter} create_couple`);
  const invite = await createInvite(inviter);
  return via === 'link'
    ? joinByLink(joiner, invite, opts)
    : joinByCode(joiner, inviter, invite.code, opts);
}

/** A client typed loosely, for calling things that must NOT exist (BE-24 private helpers). */
export const loose = (db: Db): SupabaseClient => db as unknown as SupabaseClient;

export const FIX = {
  daily: 'FIXTURE-CONTRACT-DAILY',
  stage: 'FIXTURE-CONTRACT-STAGE', // daily, only for engaged_married couples, sorts before daily
  loose: 'FIXTURE-CONTRACT-LOOSE', // in no pack, not daily
  // D51 (BE-46, reverses D43/BE-36): no pack question is free. Every pack question needs a Premium
  // couple, whatever its position or the pack's is_premium flag. The premium pack keeps two
  // questions (position 0 and 1) so the tests show that position no longer matters.
  premiumFirst: 'FIXTURE-CONTRACT-PREMIUM-FIRST', // first in the premium pack: Premium only (D51)
  premium: 'FIXTURE-CONTRACT-PREMIUM', // second in the premium pack: Premium only
  free: 'FIXTURE-CONTRACT-FREE', // in the pack with is_premium=false: still Premium only (D51)
} as const;

/**
 * Contract-test content (bodies prefixed FIXTURE-, never shown to users): one daily question,
 * so a stack without seed content still has a library, plus pack questions. Idempotent.
 * Returns the question ids by key.
 */
export async function ensureContent(): Promise<Record<keyof typeof FIX, string>> {
  const wanted = [
    { body: FIX.daily, daily_eligible: true, sort_order: -1000, stages: [] as StageList },
    {
      body: FIX.stage,
      daily_eligible: true,
      sort_order: -2000,
      stages: ['engaged_married'] as StageList,
    },
    { body: FIX.loose, daily_eligible: false, sort_order: 0, stages: [] as StageList },
    { body: FIX.premiumFirst, daily_eligible: false, sort_order: 0, stages: [] as StageList },
    { body: FIX.premium, daily_eligible: false, sort_order: 0, stages: [] as StageList },
    { body: FIX.free, daily_eligible: false, sort_order: 0, stages: [] as StageList },
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
  // A test may deactivate a fixture question (QUESTION_UNAVAILABLE checks); start from active.
  ok(await admin.from('questions').update({ active: true }).in('body', bodies), 'activate');

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
        {
          pack_id: pack('fixture-contract-premium'),
          question_id: id(FIX.premiumFirst),
          position: 0,
        },
        { pack_id: pack('fixture-contract-premium'), question_id: id(FIX.premium), position: 1 },
        { pack_id: pack('fixture-contract-free'), question_id: id(FIX.free), position: 1 },
      ],
      { onConflict: 'pack_id,question_id' },
    ),
    'upsert pack items',
  );
  return {
    daily: id(FIX.daily),
    stage: id(FIX.stage),
    loose: id(FIX.loose),
    premiumFirst: id(FIX.premiumFirst),
    premium: id(FIX.premium),
    free: id(FIX.free),
  };
}

/**
 * D51 (BE-46): a free couple can no longer start a pack question. Tests that need a pack row for a
 * free couple insert it as admin, the way a row started under D43 (or while the couple was Premium)
 * exists; start_pack_question then returns it as-is, and answers, reveal, thread and reactions work
 * on it. Idempotent: returns the existing row when the couple already has one.
 */
export async function preStartedPackRow(coupleId: string, questionId: string) {
  ok(
    await admin
      .from('couple_questions')
      .upsert(
        { couple_id: coupleId, question_id: questionId, source: 'pack' },
        { onConflict: 'couple_id,question_id', ignoreDuplicates: true },
      ),
    'pre-start pack row',
  );
  return must(
    await admin
      .from('couple_questions')
      .select('*')
      .eq('couple_id', coupleId)
      .eq('question_id', questionId)
      .single(),
    'read pack row',
  );
}

/** The active first_day special question (D12), from the seeded content. */
export async function firstDayId(): Promise<string> {
  const rows = must(
    await admin.from('questions').select('id').eq('special', 'first_day').eq('active', true),
    'read first_day',
  );
  if (rows.length !== 1)
    throw new Error(`expected one active first_day question, got ${rows.length}`);
  return rows[0].id;
}

/**
 * Marks every active daily-eligible question as used by the couple, and gives it a daily
 * question on an old day (so it is past day 1 and the first_day special is not due), for
 * LIBRARY_EXHAUSTED.
 */
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
    if (page.length > 0) {
      ok(
        await admin.from('couple_questions').upsert(
          page.map((q) => ({ couple_id: coupleId, question_id: q.id, source: 'pack' })),
          { onConflict: 'couple_id,question_id', ignoreDuplicates: true },
        ),
        'mark library used',
      );
    }
    if (page.length < 1000) break;
  }
  ok(
    await admin.from('couple_questions').upsert(
      {
        couple_id: coupleId,
        question_id: await firstDayId(),
        source: 'daily',
        assigned_for: '2020-01-01',
      },
      { onConflict: 'couple_id,question_id', ignoreDuplicates: true },
    ),
    'past daily question',
  );
}
