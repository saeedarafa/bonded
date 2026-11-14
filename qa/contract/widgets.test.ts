// QA-49 (part): BE-60 widget auth + widget RPCs (D59, SEC-21; CONTRACTS §2 `mint_widget_token`,
// `revoke_widget_tokens`, §3 `widget` and its service-only `widget_send` / `widget_undo` /
// `widget_state`). The edge function itself is covered by supabase/functions/widget/index_test.ts;
// here the database side through supabase-js as the app and the function call it: the token hash
// is the hex SHA-256 the function computes, and the service-only RPCs are called with the service
// key exactly as the function does.
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { Database } from '../../src/types/database';
import {
  ID,
  PERSONAS,
  admin,
  anon,
  as,
  expectCode,
  expectPermissionDenied,
  loose,
  must,
  ok,
  pair,
  resetWorld,
  sql,
} from './helpers';
import type { PersonaName } from './personas';

type Minted = { token: string; expires_at: string };
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');
const HOUR = 3600 * 1000;

const stack = inject('stack');

/**
 * A fresh Auth session for a persona. The token is bound to the minting session (auth.sessions),
 * and the scenario seeder (scenarios / e2e-seeds tests) re-creates some persona accounts, which
 * drops the sessions global-setup made; PostgREST does not notice, the widget auth does.
 */
const sessions = new Map<PersonaName, ReturnType<typeof createClient<Database>>>();
async function session(who: PersonaName) {
  const cached = sessions.get(who);
  if (cached) return cached;
  const db = await signIn(who);
  sessions.set(who, db);
  return db;
}

/** A new, uncached Auth session (for tests that end or time-box the session row). */
async function signIn(who: PersonaName) {
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: PERSONAS[who].email,
  });
  if (linkError || !link.properties?.email_otp) throw new Error(`OTP for ${who}: ${linkError?.message}`);
  const client = createClient<Database>(stack.url, stack.anonKey, opts);
  const { data, error } = await client.auth.verifyOtp({
    email: PERSONAS[who].email,
    token: link.properties.email_otp,
    type: 'email',
  });
  if (error || !data.session) throw new Error(`sign in ${who}: ${error?.message ?? 'no session'}`);
  const db = createClient<Database>(stack.url, stack.anonKey, {
    ...opts,
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  return db;
}

const mint = async (who: PersonaName, device = randomUUID()) =>
  must(
    await (await session(who)).rpc('mint_widget_token', { p_device_id: device }),
    `${who} mint`,
  ) as unknown as Minted;
const state = (token: string) => admin.rpc('widget_state', { p_token_hash: hashOf(token) });
const widgetSend = (token: string, kind: string, client = randomUUID()) =>
  admin.rpc('widget_send', { p_token_hash: hashOf(token), p_kind: kind, p_client_id: client });

const ANSWER_SENTINEL = 'QA49-ANSWER-SENTINEL-do-not-leak';
const MESSAGE_SENTINEL = 'QA49-MESSAGE-SENTINEL-do-not-leak';

let free = '';
let pro = '';

beforeAll(async () => {
  await resetWorld();
  free = await pair('maya', 'sam');
  pro = await pair('eve', 'finn');
  ok(
    await admin.from('entitlements').upsert({ user_id: ID.eve, is_active: true, expires_at: null }),
    'entitle eve',
  );
});

afterAll(async () => {
  await sql('delete from private.widget_tokens where user_id = any($1::uuid[])', [
    [ID.maya, ID.sam, ID.eve, ID.finn],
  ]);
  await resetWorld();
});

describe('widget RPC grants (BE-60, SEC-21)', () => {
  it('anon cannot execute any widget RPC', async () => {
    const h = 'a'.repeat(64);
    expectPermissionDenied(await anon.rpc('mint_widget_token', { p_device_id: randomUUID() }));
    expectPermissionDenied(await anon.rpc('revoke_widget_tokens', {}));
    expectPermissionDenied(await anon.rpc('widget_state', { p_token_hash: h }));
    expectPermissionDenied(
      await anon.rpc('widget_send', { p_token_hash: h, p_kind: 'hug', p_client_id: randomUUID() }),
    );
    expectPermissionDenied(await anon.rpc('widget_undo', { p_token_hash: h, p_id: randomUUID() }));
  });

  it('a signed-in user cannot call the service-only widget_state / widget_send / widget_undo', async () => {
    const t = await mint('eve');
    const h = hashOf(t.token);
    const eve = await session('eve');
    expectPermissionDenied(await eve.rpc('widget_state', { p_token_hash: h }));
    expectPermissionDenied(
      await eve.rpc('widget_send', { p_token_hash: h, p_kind: 'hug', p_client_id: randomUUID() }),
    );
    expectPermissionDenied(await eve.rpc('widget_undo', { p_token_hash: h, p_id: randomUUID() }));
  });
});

describe('mint_widget_token (BE-60)', () => {
  it('returns {token, expires_at}: bwt_ + 43 base64url chars, 48 h absolute, stored only as a hash', async () => {
    const before = Date.now();
    const t = await mint('maya');
    expect(Object.keys(t).sort()).toEqual(['expires_at', 'token']);
    expect(t.token).toMatch(/^bwt_[A-Za-z0-9_-]{43}$/);
    const life = new Date(t.expires_at).getTime() - before;
    expect(life).toBeGreaterThan(47.9 * HOUR);
    expect(life).toBeLessThanOrEqual(48 * HOUR + 60_000);
    const rows = await sql<{ n: string }>(
      `select count(*)::text n from private.widget_tokens
        where user_id = $1 and (token_hash = $2 or token_hash = $3)`,
      [ID.maya, hashOf(t.token), t.token],
    );
    expect(rows[0].n).toBe('1'); // the hash matches, the raw token is not stored
  });

  it('a solo user gets NOT_PAIRED', async () => {
    must(await as('lea').rpc('create_couple', { p_stage: 'dating' }), 'lea solo');
    expectCode(await (await session('lea')).rpc('mint_widget_token', { p_device_id: randomUUID() }), 'NOT_PAIRED');
  });

  it('a garbage or revoked token is WIDGET_AUTH', async () => {
    expectCode(await admin.rpc('widget_state', { p_token_hash: 'a'.repeat(64) }), 'WIDGET_AUTH');
    expectCode(await admin.rpc('widget_state', { p_token_hash: 'not-a-hash' }), 'WIDGET_AUTH');
    const t = await mint('finn');
    must(await state(t.token), 'live token reads');
    ok(await (await session('finn')).rpc('revoke_widget_tokens', {}), 'revoke all');
    expectCode(await state(t.token), 'WIDGET_AUTH');
  });

  it('minting again on the same device revokes the previous token', async () => {
    const device = randomUUID();
    const a = await mint('finn', device);
    const b = await mint('finn', device);
    expectCode(await state(a.token), 'WIDGET_AUTH');
    must(await state(b.token), 'new token reads');
  });
});

describe('free couple (BE-60, D59)', () => {
  it('widget_state is exactly the locked {premium:false, server_now}', async () => {
    const t = await mint('maya');
    const s = must(await state(t.token), 'free state') as Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(['premium', 'server_now']);
    expect(s.premium).toBe(false);
  });

  it('widget send is refused with PREMIUM_REQUIRED and writes nothing', async () => {
    const t = await mint('sam');
    const before = await sql<{ n: string }>(
      'select count(*)::text n from public.little_things where couple_id = $1',
      [free],
    );
    for (const kind of ['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you'])
      expectCode(await widgetSend(t.token, kind), 'PREMIUM_REQUIRED');
    const after = await sql<{ n: string }>(
      'select count(*)::text n from public.little_things where couple_id = $1',
      [free],
    );
    expect(after[0].n).toBe(before[0].n);
  });
});

describe('Premium couple (BE-60, D59)', () => {
  it("widget send writes source 'widget'; the partner reads it; a retry with the same client id counts once", async () => {
    const t = await mint('eve');
    const client = randomUUID();
    const r = must(await widgetSend(t.token, 'miss_you', client), 'widget send') as {
      id: string;
      same_time: boolean;
      at_limit: boolean;
    };
    expect(Object.keys(r).sort()).toEqual(['at_limit', 'id', 'same_time']);
    const again = must(await widgetSend(t.token, 'miss_you', client), 'retry') as { id: string };
    expect(again.id).toBe(r.id);
    const row = must(
      await as('finn').from('little_things').select('*').eq('id', r.id).single(),
      'finn reads',
    );
    expect(row).toMatchObject({ couple_id: pro, sender_id: ID.eve, kind: 'miss_you', amount: 1, source: 'widget' });
  });

  it("the app path writes 'app' and the app cannot rewrite source", async () => {
    const r = must(await as('eve').rpc('send_little_thing', { p_kind: 'kiss' }), 'app send') as {
      id: string;
    };
    await loose(as('eve')).from('little_things').update({ source: 'widget' }).eq('id', r.id);
    await loose(as('eve'))
      .from('little_things')
      .insert({ couple_id: pro, sender_id: ID.eve, kind: 'hug', amount: 1, source: 'widget' });
    const rows = must(
      await admin.from('little_things').select('id, source').eq('couple_id', pro).eq('sender_id', ID.eve),
      'rows',
    );
    expect(rows.find((x) => x.id === r.id)?.source).toBe('app');
    // Only the widget send above wrote 'widget'; the direct insert did not land.
    expect(rows.filter((x) => x.source === 'widget')).toHaveLength(1);
  });

  it('widget_state carries no answer, thread-message or voice text, path or token', async () => {
    const cq = must(await as('eve').rpc('get_daily_question'), 'daily') as { id: string };
    for (const who of ['eve', 'finn'] as const)
      ok(
        await admin
          .from('answers')
          .upsert(
            { couple_question_id: cq.id, user_id: ID[who], body: `${ANSWER_SENTINEL}-${who}` },
            { onConflict: 'couple_question_id,user_id' },
          ),
        `${who} answers`,
      );
    ok(
      await admin.from('thread_messages').insert({
        couple_question_id: cq.id,
        user_id: ID.finn,
        client_id: randomUUID(),
        body: MESSAGE_SENTINEL,
      }),
      'finn message',
    );
    const t = await mint('eve');
    const s = must(await state(t.token), 'pro state') as Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(
      [
        'premium',
        'server_now',
        'token_expires_at',
        'partner_first_name',
        'days_together',
        'days_in_bonded',
        'next_key_dates',
        'streak',
        'today',
        'mascot',
        'last_from_partner',
        'on_this_day',
        'ritual_time',
        'little_things',
      ].sort(),
    );
    expect(s.premium).toBe(true);
    expect(s.today).toMatchObject({
      couple_question_id: cq.id,
      me_answered: true,
      partner_answered: true,
    });
    expect(Object.keys(s.today as object).sort()).toEqual(
      ['couple_question_id', 'me_answered', 'partner_answered', 'question_text'].sort(),
    );
    const wire = JSON.stringify(s);
    expect(wire).not.toContain(ANSWER_SENTINEL);
    expect(wire).not.toContain(MESSAGE_SENTINEL);
    expect(wire).not.toContain(t.token);
    expect(wire).not.toContain(hashOf(t.token));
    expect(wire).not.toMatch(/"(body|answer|answers|message|messages|voice_path|path|url|token)"\s*:/);
  });
});

// ───────────────────────────── QA-49 (BE-60b): consumer-side widget rules ─────────────────────────────
// The function calls one service RPC per action; these pin what the widget can rely on:
// undo = the app's undo (sender only, 5 s, 10 a day, not Premium-gated), the app's limits,
// WIDGET_AUTH after revoke / expiry / an ended or time-boxed session, the per-token limiter
// counting successful calls only, and a lapse turning the same token into the locked preview.

type Kinds = { kind: string; at_limit: boolean }[];
const KINDS = ['good_morning', 'goodnight', 'hug', 'kiss', 'miss_you'];
const widgetUndo = (token: string, id: string) =>
  admin.rpc('widget_undo', { p_token_hash: hashOf(token), p_id: id });
const sentId = async (res: Awaited<ReturnType<typeof widgetSend>>, what: string) =>
  (must(res, what) as { id: string }).id;
const undoneAt = async (id: string) =>
  must(await admin.from('little_things').select('undone_at').eq('id', id).single(), 'row').undone_at;
const thingCount = async (couple: string) =>
  Number(
    (
      await sql<{ n: string }>('select count(*)::text n from public.little_things where couple_id = $1', [
        couple,
      ])
    )[0].n,
  );
/** The token's counter for a bucket, or 0 when no successful call has been counted yet. */
const usage = async (token: string, bucket: 'write' | 'read') =>
  (
    await sql<{ n: number }>(
      'select n from private.widget_token_usage where token_hash = $1 and bucket = $2',
      [hashOf(token), bucket],
    )
  )[0]?.n ?? 0;
/** Starts each test of a block from an empty day (the daily caps and the 10-undo cap are per day). */
const clearThings = () =>
  sql('delete from public.little_things where couple_id = any($1::uuid[])', [[free, pro]]);
/**
 * Every test mints its own tokens; dropping the old rows keeps each user under the 20 mints per
 * rolling 24 h (RATE_LIMITED) and the 5-live-tokens rotation across this many cases.
 */
const dropTokens = () =>
  sql('delete from private.widget_tokens where user_id = any($1::uuid[])', [
    [ID.maya, ID.sam, ID.eve, ID.finn],
  ]);
const entitleEve = async (active: boolean) =>
  ok(
    await admin
      .from('entitlements')
      .upsert({
        user_id: ID.eve,
        is_active: active,
        expires_at: active ? null : '2000-01-01T00:00:00Z',
      }),
    active ? 'entitle eve' : 'lapse eve',
  );
/** LITTLE_THING_LIMIT with its JSON details, as the function forwards them (409 body). */
function expectLimit(res: Awaited<ReturnType<typeof widgetSend>>, kind: string, more: boolean) {
  expectCode(res, 'LITTLE_THING_LIMIT');
  expect(JSON.parse(res.error!.details)).toEqual({ kind, more_with_premium: more });
}
function expectKinds(data: unknown) {
  const list = data as Kinds;
  expect(list).toHaveLength(5);
  expect(list.map((x) => x.kind).sort()).toEqual(KINDS);
  for (const x of list) expect(Object.keys(x).sort()).toEqual(['at_limit', 'kind']);
}

describe('widget undo = the app undo (BE-60, BE-60b)', () => {
  beforeAll(clearThings);
  beforeEach(dropTokens);

  it('the sender undoes a widget send within 5 s: exactly the five {kind, at_limit}; a repeat is idempotent', async () => {
    const t = await mint('eve');
    const id = await sentId(await widgetSend(t.token, 'hug'), 'send');
    const u = must(await widgetUndo(t.token, id), 'undo');
    expectKinds(u);
    expect(await undoneAt(id)).not.toBeNull();
    expectKinds(must(await widgetUndo(t.token, id), 'undo again'));
  });

  it('only the sender: the partner, the other couple and an unknown id get INVALID_LITTLE_THING', async () => {
    const eve = await mint('eve');
    const id = await sentId(await widgetSend(eve.token, 'kiss'), 'send');
    expectCode(await widgetUndo((await mint('finn')).token, id), 'INVALID_LITTLE_THING');
    expectCode(await widgetUndo((await mint('maya')).token, id), 'INVALID_LITTLE_THING');
    expectCode(await widgetUndo(eve.token, randomUUID()), 'INVALID_LITTLE_THING');
    expectCode(await as('finn').rpc('undo_little_thing', { p_id: id }), 'INVALID_LITTLE_THING');
    expect(await undoneAt(id)).toBeNull();
  });

  it('a widget send can be undone from the app by its sender (one core)', async () => {
    const t = await mint('eve');
    const id = await sentId(await widgetSend(t.token, 'kiss'), 'send');
    must(await as('eve').rpc('undo_little_thing', { p_id: id }), 'app undo');
    expect(await undoneAt(id)).not.toBeNull();
  });

  it('more than 5 s after the send, or once dispatched, is UNDO_EXPIRED and nothing changes', async () => {
    const t = await mint('eve');
    const old = await sql<{ r: { id: string } }>(
      `select private.widget_send_at($1, 'kiss', $2, now() - interval '6 seconds') r`,
      [hashOf(t.token), randomUUID()],
    );
    expectCode(await widgetUndo(t.token, old[0].r.id), 'UNDO_EXPIRED');
    expect(await undoneAt(old[0].r.id)).toBeNull();

    const id = await sentId(await widgetSend(t.token, 'kiss'), 'send');
    await sql(
      `insert into private.little_thing_dispatch (little_thing_id, recipient_id, outcome, handled_at)
       values ($1, $2, 'pushed', now())`,
      [id, ID.finn],
    );
    expectCode(await widgetUndo(t.token, id), 'UNDO_EXPIRED');
    expect(await undoneAt(id)).toBeNull();
  });

  it('the 10-undos-a-day cap is shared with the app: 5 app + 5 widget undos, the 11th is UNDO_EXPIRED', async () => {
    await clearThings();
    const t = await mint('eve');
    for (let i = 0; i < 5; i++) {
      const r = must(await as('eve').rpc('send_little_thing', { p_kind: 'kiss' }), 'app send') as {
        id: string;
      };
      must(await as('eve').rpc('undo_little_thing', { p_id: r.id }), `app undo ${i}`);
      const id = await sentId(await widgetSend(t.token, 'kiss'), 'widget send');
      must(await widgetUndo(t.token, id), `widget undo ${i}`);
    }
    const last = await sentId(await widgetSend(t.token, 'kiss'), 'widget send 11');
    expectCode(await widgetUndo(t.token, last), 'UNDO_EXPIRED');
    expect(await undoneAt(last)).toBeNull();
  });

  it('undo is not Premium-gated: a couple that lapses inside the 5 s window still undoes; a free couple undoes an app send', async () => {
    await clearThings();
    const t = await mint('eve');
    const id = await sentId(await widgetSend(t.token, 'hug'), 'send');
    await entitleEve(false);
    try {
      expectCode(await widgetSend(t.token, 'hug'), 'PREMIUM_REQUIRED');
      expectKinds(must(await widgetUndo(t.token, id), 'undo after lapse'));
      expect(await undoneAt(id)).not.toBeNull();
    } finally {
      await entitleEve(true);
    }
    const m = await mint('maya');
    const r = must(await as('maya').rpc('send_little_thing', { p_kind: 'hug' }), 'maya app send') as {
      id: string;
    };
    expectKinds(must(await widgetUndo(m.token, r.id), 'free undo'));
    expect(await undoneAt(r.id)).not.toBeNull();
  });
});

describe('widget send limits = the app limits (BE-60, D48)', () => {
  beforeAll(clearThings);
  beforeEach(dropTokens);

  it('one goodnight and one good morning a day, shared between app and widget', async () => {
    const t = await mint('eve');
    must(await as('eve').rpc('send_little_thing', { p_kind: 'goodnight' }), 'app goodnight');
    expectLimit(await widgetSend(t.token, 'goodnight'), 'goodnight', false);
    const gm = must(await widgetSend(t.token, 'good_morning'), 'widget good morning') as {
      at_limit: boolean;
    };
    expect(gm.at_limit).toBe(true);
    expectCode(await as('eve').rpc('send_little_thing', { p_kind: 'good_morning' }), 'LITTLE_THING_LIMIT');
  });

  it('Premium miss-you cap 15 counts app and widget sends; the 15th says at_limit, the 16th is refused whole', async () => {
    const t = await mint('eve');
    for (let i = 0; i < 14; i++)
      must(await as('eve').rpc('send_little_thing', { p_kind: 'miss_you' }), `app miss_you ${i}`);
    const r = must(await widgetSend(t.token, 'miss_you'), '15th') as { at_limit: boolean };
    expect(r.at_limit).toBe(true);
    const before = await thingCount(pro);
    expectLimit(await widgetSend(t.token, 'miss_you'), 'miss_you', false);
    expect(await thingCount(pro)).toBe(before);
  });

  it('a widget kiss is always one kiss; an unknown kind or a missing client id is INVALID_LITTLE_THING', async () => {
    const t = await mint('eve');
    const id = await sentId(await widgetSend(t.token, 'kiss'), 'kiss');
    const row = must(await admin.from('little_things').select('amount, source').eq('id', id).single(), 'row');
    expect(row).toEqual({ amount: 1, source: 'widget' });
    expectCode(await widgetSend(t.token, 'wave'), 'INVALID_LITTLE_THING');
    expectCode(
      await admin.rpc('widget_send', {
        p_token_hash: hashOf(t.token),
        p_kind: 'hug',
        p_client_id: null as unknown as string,
      }),
      'INVALID_LITTLE_THING',
    );
  });
});

describe('token refused after revoke, expiry and the end of its session (BE-60, BE-60b)', () => {
  beforeAll(clearThings);
  beforeEach(dropTokens);

  const allRefused = async (token: string) => {
    expectCode(await state(token), 'WIDGET_AUTH');
    expectCode(await widgetSend(token, 'kiss'), 'WIDGET_AUTH');
    expectCode(await widgetUndo(token, randomUUID()), 'WIDGET_AUTH');
  };

  it('revoke by device refuses only that device; revoke-all refuses every action of every token', async () => {
    const dA = randomUUID();
    const a = await mint('eve', dA);
    const b = await mint('eve');
    ok(await (await session('eve')).rpc('revoke_widget_tokens', { p_device_id: dA }), 'revoke A');
    await allRefused(a.token);
    must(await state(b.token), 'B still reads');
    // The app may be signed in as someone else: revoking never touches another user's tokens.
    const f = await mint('finn');
    ok(await (await session('eve')).rpc('revoke_widget_tokens', {}), 'revoke all');
    await allRefused(b.token);
    must(await state(f.token), "finn's token untouched");
  });

  it('a token past its 48 h expires_at is refused (state, send, undo)', async () => {
    const t = await mint('eve');
    await sql(
      `update private.widget_tokens
          set created_at = now() - interval '49 hours', expires_at = now() - interval '1 hour'
        where token_hash = $1`,
      [hashOf(t.token)],
    );
    await allRefused(t.token);
  });

  it("a token whose minting session is past auth.sessions.not_after is refused; the user's other sessions are not", async () => {
    const db = await signIn('eve');
    const t = must(await db.rpc('mint_widget_token', { p_device_id: randomUUID() }), 'mint') as unknown as Minted;
    const other = await mint('eve');
    const sid = (
      await sql<{ session_id: string }>('select session_id::text from private.widget_tokens where token_hash = $1', [
        hashOf(t.token),
      ])
    )[0].session_id;
    await sql(`update auth.sessions set not_after = now() + interval '1 hour' where id = $1`, [sid]);
    must(await state(t.token), 'future not_after still reads');
    await sql(`update auth.sessions set not_after = now() - interval '1 second' where id = $1`, [sid]);
    await allRefused(t.token);
    must(await state(other.token), 'other session reads');
  });

  it('a token whose minting session row is gone (signed out) is refused', async () => {
    const db = await signIn('eve');
    const t = must(await db.rpc('mint_widget_token', { p_device_id: randomUUID() }), 'mint') as unknown as Minted;
    must(await state(t.token), 'reads before sign-out');
    await sql(
      'delete from auth.sessions where id = (select session_id from private.widget_tokens where token_hash = $1)',
      [hashOf(t.token)],
    );
    await allRefused(t.token);
  });
});

describe('per-token rate limit counts successful calls only (BE-60b, SEC-21 Info 1)', () => {
  beforeAll(clearThings);
  beforeEach(dropTokens);

  it('failed sends and undos (limit, invalid, unknown id) leave the write counter alone', async () => {
    const t = await mint('eve');
    must(await widgetSend(t.token, 'goodnight'), 'goodnight');
    expect(await usage(t.token, 'write')).toBe(1);
    for (let i = 0; i < 40; i++) expectLimit(await widgetSend(t.token, 'goodnight'), 'goodnight', false);
    expectCode(await widgetSend(t.token, 'wave'), 'INVALID_LITTLE_THING');
    expectCode(await widgetUndo(t.token, randomUUID()), 'INVALID_LITTLE_THING');
    expect(await usage(t.token, 'write')).toBe(1);
    must(await widgetSend(t.token, 'kiss'), 'a send after 43 failures still works');
    expect(await usage(t.token, 'write')).toBe(2);
  });

  it("a free couple's PREMIUM_REQUIRED sends are not counted: 35 refusals, then its undo still works", async () => {
    const m = await mint('maya');
    for (let i = 0; i < 35; i++) expectCode(await widgetSend(m.token, 'kiss'), 'PREMIUM_REQUIRED');
    expect(await usage(m.token, 'write')).toBe(0);
    const r = must(await as('maya').rpc('send_little_thing', { p_kind: 'kiss' }), 'maya app send') as {
      id: string;
    };
    expectKinds(must(await widgetUndo(m.token, r.id), 'undo'));
    expect(await usage(m.token, 'write')).toBe(1);
  });

  it('30 successful writes per 10 min: the 31st is RATE_LIMITED and writes nothing; reads go on', async () => {
    await clearThings();
    const t = await mint('eve');
    for (let i = 0; i < 30; i++) must(await widgetSend(t.token, 'kiss'), `kiss ${i + 1}`);
    const before = await thingCount(pro);
    expectCode(await widgetSend(t.token, 'kiss'), 'RATE_LIMITED');
    expectCode(await widgetUndo(t.token, randomUUID()), 'RATE_LIMITED');
    expect(await thingCount(pro)).toBe(before);
    expect(await usage(t.token, 'write')).toBe(30); // stays at the cap: limited until the window ends
    must(await state(t.token), 'reads are a separate bucket');
    // Another token of the same user has its own counter.
    must(await widgetSend((await mint('eve')).token, 'kiss'), 'other token sends');
    // Once the window has passed, the counter starts again.
    await sql(
      `update private.widget_token_usage set window_start = now() - interval '10 minutes 1 second'
        where token_hash = $1 and bucket = 'write'`,
      [hashOf(t.token)],
    );
    must(await widgetSend(t.token, 'kiss'), 'new window');
    expect(await usage(t.token, 'write')).toBe(1);
  });

  it('120 reads per hour: at the cap, state is RATE_LIMITED and sends still work', async () => {
    const t = await mint('eve');
    must(await state(t.token), 'first read');
    expect(await usage(t.token, 'read')).toBe(1);
    await sql(
      `update private.widget_token_usage set n = 120, window_start = now() where token_hash = $1 and bucket = 'read'`,
      [hashOf(t.token)],
    );
    expectCode(await state(t.token), 'RATE_LIMITED');
    expect(await usage(t.token, 'read')).toBe(120);
    must(await widgetSend(t.token, 'hug'), 'writes are a separate bucket');
  });
});

describe('Premium lapse -> locked, on the same token (BE-60, D59)', () => {
  beforeAll(clearThings);
  beforeEach(dropTokens);

  it('a lapse locks both partners: state is exactly {premium:false, server_now}, send is PREMIUM_REQUIRED, no row', async () => {
    const e = await mint('eve');
    const f = await mint('finn');
    expect((must(await state(e.token), 'premium') as { premium: boolean }).premium).toBe(true);
    await entitleEve(false);
    try {
      for (const t of [e, f]) {
        const s = must(await state(t.token), 'locked') as Record<string, unknown>;
        expect(Object.keys(s).sort()).toEqual(['premium', 'server_now']);
        expect(s.premium).toBe(false);
        const before = await thingCount(pro);
        expectCode(await widgetSend(t.token, 'hug'), 'PREMIUM_REQUIRED');
        expect(await thingCount(pro)).toBe(before);
      }
    } finally {
      await entitleEve(true);
    }
    // Renewing unlocks the same token again (no re-mint needed).
    expect((must(await state(f.token), 'renewed') as { premium: boolean }).premium).toBe(true);
  });

  it("either partner's entitlement unlocks the couple", async () => {
    await entitleEve(false);
    try {
      ok(await admin.from('entitlements').upsert({ user_id: ID.finn, is_active: true, expires_at: null }), 'entitle finn');
      const e = await mint('eve');
      expect((must(await state(e.token), 'via finn') as { premium: boolean }).premium).toBe(true);
      must(await widgetSend(e.token, 'hug'), 'eve sends on finn’s Premium');
    } finally {
      ok(await admin.from('entitlements').delete().eq('user_id', ID.finn), 'unentitle finn');
      await entitleEve(true);
    }
  });
});

describe('widget reads never carry answer, message or little-thing text (D59)', () => {
  beforeEach(dropTokens);
  it('the little-thing parts are exactly {kind, count, sent_at} and five {kind, at_limit}', async () => {
    await clearThings();
    must(await widgetSend((await mint('finn')).token, 'hug'), 'finn sends');
    const s = must(await state((await mint('eve')).token), 'state') as Record<string, unknown>;
    expect(Object.keys(s.last_from_partner as object).sort()).toEqual(['count', 'kind', 'sent_at']);
    expect(s.last_from_partner).toMatchObject({ kind: 'hug', count: 1 });
    expectKinds(s.little_things);
    const wire = JSON.stringify(s);
    expect(wire).not.toMatch(/"(id|client_id|sender_id|couple_id|source|body|text|note)"\s*:/);
  });

  it('a free couple with answers and messages gets only the locked shape', async () => {
    const cq = must(await as('maya').rpc('get_daily_question'), 'daily') as { id: string };
    ok(
      await admin
        .from('answers')
        .upsert(
          { couple_question_id: cq.id, user_id: ID.sam, body: `${ANSWER_SENTINEL}-sam` },
          { onConflict: 'couple_question_id,user_id' },
        ),
      'sam answers',
    );
    const s = must(await state((await mint('maya')).token), 'free state') as Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(['premium', 'server_now']);
    expect(JSON.stringify(s)).not.toContain(ANSWER_SENTINEL);
  });
});
