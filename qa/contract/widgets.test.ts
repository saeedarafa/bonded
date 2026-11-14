// QA-49 (part): BE-60 widget auth + widget RPCs (D59, SEC-21; CONTRACTS §2 `mint_widget_token`,
// `revoke_widget_tokens`, §3 `widget` and its service-only `widget_send` / `widget_undo` /
// `widget_state`). The edge function itself is covered by supabase/functions/widget/index_test.ts;
// here the database side through supabase-js as the app and the function call it: the token hash
// is the hex SHA-256 the function computes, and the service-only RPCs are called with the service
// key exactly as the function does.
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
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
  sessions.set(who, db);
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
