// QA-12: BE-28 (D36) invite_link() through PostgREST as signed-in personas and as anon.
// CONTRACTS §2 `invite_link`: returns {code, expires_at, token} for the caller's current open
// invite with a NEW link token; the code, the expiry and every earlier token stay valid; SQL null
// when there is no open invite; at most 10 invite_link tokens per invite, then RATE_LIMITED;
// authenticated only, no argument (so it can only ever return the caller's own invite).
//
// Cast: Maya is the inviter (solo couple + one open invite). Sam and Lea join; Eve is an outsider
// with her own couple and invite; Noor has no couple.
import type { PostgrestError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  admin,
  anon,
  as,
  canForgeJwt,
  createInvite,
  expectCode,
  expectPermissionDenied,
  joinByLink,
  must,
  noSubject,
  ok,
  requestJoin,
  resetWorld,
  sql,
  type Invite,
} from './helpers';
import type { PersonaName } from './personas';

type Res = { error: PostgrestError | null; status: number; data: unknown };

const link = (who: PersonaName) => as(who).rpc('invite_link');

/** invite_link that must return a link; asserts the composite shape. */
async function newLink(who: PersonaName): Promise<Invite> {
  const res = await link(who);
  ok(res, `${who} invite_link`);
  const d = res.data as Partial<Invite> | null;
  if (!d?.token) throw new Error(`${who} invite_link: no token, got ${JSON.stringify(res.data)}`);
  expect(Object.keys(d).sort()).toEqual(['code', 'expires_at', 'token']);
  return d as Invite;
}

/** CONTRACTS §2: "No open invite: SQL null (check !data?.token)". */
function expectNoLink(res: Res, what: string) {
  ok(res, what);
  const d = res.data as Partial<Invite> | null;
  expect(d?.token ?? null, `${what}: no token`).toBeNull();
  expect(d?.code ?? null, `${what}: no code`).toBeNull();
}

/** A counted failure: HTTP 400, body-borne (CONTRACTS §2 error format). */
function expectBodyError(res: Res, code: Parameters<typeof expectCode>[1]) {
  expectCode(res, code);
  expect(res.status, `${code} status`).toBe(400);
}

const accept = (who: PersonaName, inv: Invite, token = inv.token) =>
  as(who).rpc('accept_invite', { p_code: inv.code, p_token: token });
const preview = (inv: Invite, token = inv.token) =>
  anon.rpc('invite_preview', { p_code: inv.code, p_token: token });

const tokenRows = async (code: string) =>
  (
    await sql<{ n: number }>(
      `select count(*)::int n from private.invite_tokens t join pair_invites i on i.id = t.invite_id
        where i.code = $1 and i.revoked_at is null`,
      [code],
    )
  )[0].n;

let created: Invite; // Maya's invite as create_invite returned it

async function setup() {
  await resetWorld();
  must(
    await as('maya').rpc('create_couple', { p_stage: 'dating', p_partner_name: 'Sam' }),
    'maya create_couple',
  );
  created = await createInvite('maya');
}

describe('invite_link (BE-28, D36)', () => {
  beforeEach(setup);

  it('returns the same code and expiry with a new 192-bit url-safe token every call', async () => {
    const a = await newLink('maya');
    const b = await newLink('maya');
    for (const l of [a, b]) {
      expect(l.code).toBe(created.code);
      expect(new Date(l.expires_at).toISOString()).toBe(new Date(created.expires_at).toISOString());
      expect(l.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    }
    expect(new Set([created.token, a.token, b.token]).size).toBe(3);
  });

  it('does not replace the code: one open invite, not revoked, not extended (fails if re-opening 10 changes the code)', async () => {
    await newLink('maya');
    await newLink('maya');
    const rows = must(
      await as('maya').from('pair_invites').select('code, expires_at, accepted_at'),
      'read invites',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe(created.code);
    expect(new Date(rows[0].expires_at).toISOString()).toBe(
      new Date(created.expires_at).toISOString(),
    );
    const open = await sql<{ n: number }>(
      `select count(*)::int n from pair_invites where code = $1 and revoked_at is null`,
      [created.code],
    );
    expect(open[0].n).toBe(1);
  });

  it('every token of the invite previews (anon), the create_invite one and each invite_link one', async () => {
    const a = await newLink('maya');
    const b = await newLink('maya');
    for (const token of [created.token, a.token, b.token]) {
      const p = must(await preview(created, token), 'preview');
      expect(p).toMatchObject({ inviter_name: expect.any(String) });
    }
  });

  it('the old (create_invite) token still joins after invite_link, at once (no approval)', async () => {
    await newLink('maya');
    const couple = await joinByLink('sam', created);
    const maya = must(await as('maya').from('couple_members').select('couple_id'), 'maya');
    expect(maya.map((m) => m.couple_id)).toContain(couple);
  });

  it('a new invite_link token joins at once (no approval)', async () => {
    const l = await newLink('maya');
    const couple = await joinByLink('sam', l);
    const rows = must(
      await admin.from('couple_members').select('user_id').eq('couple_id', couple),
      'members',
    );
    expect(rows).toHaveLength(2);
  });

  it('the typed code (no token) still works after invite_link: a pending request', async () => {
    await newLink('maya');
    await requestJoin('sam', created.code);
  });

  it('stores only a hash: the plain token is in no table', async () => {
    const l = await newLink('maya');
    const dump = await sql<{ t: string }>(
      `select coalesce(json_agg(t)::text, '') t from private.invite_tokens t`,
    );
    expect(dump[0].t).not.toContain(l.token);
    expect(dump[0].t).not.toContain(created.token);
    const pub = await sql<{ t: string }>(`select coalesce(json_agg(i)::text, '') t from pair_invites i`);
    expect(pub[0].t).not.toContain(l.token);
  });

  describe('no open invite -> SQL null (the app then calls create_invite)', () => {
    it('no couple at all', async () => {
      expectNoLink(await link('noor'), 'noor');
    });

    it('a couple but no invite yet', async () => {
      must(await as('eve').rpc('create_couple', { p_stage: 'dating' }), 'eve create_couple');
      expectNoLink(await link('eve'), 'eve');
    });

    it('revoked: the invite_link tokens die with the code', async () => {
      const l = await newLink('maya');
      ok(
        await admin
          .from('pair_invites')
          .update({ revoked_at: new Date().toISOString() })
          .eq('code', created.code),
        'revoke',
      );
      expectNoLink(await link('maya'), 'revoked');
      expectBodyError(await accept('sam', l), 'INVALID_CODE');
    });

    it('replaced by a new create_invite: the earlier invite_link tokens are rejected, the new invite gets its own links', async () => {
      const l = await newLink('maya');
      const second = await createInvite('maya');
      expectBodyError(await accept('sam', l), 'INVALID_CODE');
      const l2 = await newLink('maya');
      expect(l2.code).toBe(second.code);
      await joinByLink('sam', l2);
    });

    it('expired: null, and its invite_link tokens are INVITE_EXPIRED', async () => {
      const l = await newLink('maya');
      ok(
        await admin
          .from('pair_invites')
          .update({ expires_at: '2026-01-01T00:00:00Z' })
          .eq('code', created.code)
          .is('revoked_at', null),
        'expire',
      );
      expectNoLink(await link('maya'), 'expired');
      expectBodyError(await accept('sam', l), 'INVITE_EXPIRED');
    });

    it('used: null for the inviter, and another invite_link token is COUPLE_FULL', async () => {
      const l = await newLink('maya');
      await joinByLink('sam', created);
      expectNoLink(await link('maya'), 'used (maya)');
      expectNoLink(await link('sam'), 'used (sam)');
      expectBodyError(await accept('lea', l), 'COUPLE_FULL');
    });
  });

  it('10 invite_link tokens per invite, the 11th is RATE_LIMITED; the code and the links keep working', async () => {
    const links: Invite[] = [];
    for (let i = 0; i < 10; i++) links.push(await newLink('maya'));
    expect(await tokenRows(created.code)).toBe(11); // create_invite's + 10
    expectCode(await link('maya'), 'RATE_LIMITED');
    expectCode(await link('maya'), 'RATE_LIMITED');
    expect(await tokenRows(created.code)).toBe(11);
    // Nothing was revoked: the first and the last link still preview, one of them joins.
    must(await preview(created, links[0].token), 'first link previews');
    must(await preview(created, created.token), 'create_invite token previews');
    await joinByLink('sam', links[9]);
  });

  it('the cap is per invite: a new create_invite starts a fresh budget', async () => {
    for (let i = 0; i < 10; i++) await newLink('maya');
    expectCode(await link('maya'), 'RATE_LIMITED');
    await createInvite('maya');
    await newLink('maya');
  });

  describe('only ever the caller own invite', () => {
    it('another user gets their own invite or null, never Maya code or a token for it', async () => {
      must(await as('eve').rpc('create_couple', { p_stage: 'dating' }), 'eve create_couple');
      const eves = await createInvite('eve');
      const l = await newLink('eve');
      expect(l.code).toBe(eves.code);
      expect(l.code).not.toBe(created.code);
      // Eve's token does not vouch for Maya's code.
      expectBodyError(await accept('sam', { ...created, token: l.token }), 'INVALID_CODE');
      for (const who of ['sam', 'lea', 'noor'] as const) expectNoLink(await link(who), who);
    });

    it('takes no argument: a p_code / p_invite argument is not accepted', async () => {
      const res = await as('eve').rpc('invite_link' as never, { p_code: created.code } as never);
      expect(res.error).not.toBeNull();
    });

    it('anon is denied (42501)', async () => {
      expectPermissionDenied(await anon.rpc('invite_link'));
    });

    it.skipIf(!canForgeJwt)('NOT_AUTHENTICATED for a JWT without a subject', async () => {
      expectCode(await noSubject().rpc('invite_link'), 'NOT_AUTHENTICATED');
    });

    it('the core private.invite_link_at is not reachable through the API', async () => {
      const res = await (as('maya') as unknown as {
        rpc: (fn: string, args: object) => Promise<Res>;
      }).rpc('invite_link_at', { p_now: new Date().toISOString() });
      expect(res.error).not.toBeNull();
    });
  });
});
