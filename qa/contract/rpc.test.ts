// QA-03: CONTRACTS §2 RPCs that are live on main (BE-02): happy path, every error code,
// anon denied, retries. Each RPC is called through PostgREST as a signed-in persona.
// Changes these RPCs get in BE-03/BE-04 are test.todo in planned.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ID,
  admin,
  anon,
  as,
  canForgeJwt,
  ensureContent,
  exhaustLibrary,
  expectCode,
  expectPermissionDenied,
  must,
  ok,
  noSubject,
  pair,
  resetWorld,
} from './helpers';

let Q: Awaited<ReturnType<typeof ensureContent>>;
const UNKNOWN_ID = '00000000-0000-4000-a000-0000000000ff';

beforeAll(async () => {
  Q = await ensureContent();
});

describe('every live RPC', () => {
  beforeAll(resetWorld);

  it('anon is denied (42501, not a code) for create_invite, accept_invite, get_daily_question, start_pack_question, unpair', async () => {
    expectPermissionDenied(await anon.rpc('create_invite'));
    expectPermissionDenied(await anon.rpc('accept_invite', { p_code: 'ABCDEF' }));
    expectPermissionDenied(await anon.rpc('get_daily_question'));
    expectPermissionDenied(await anon.rpc('start_pack_question', { p_question: Q.free }));
    expectPermissionDenied(await anon.rpc('unpair'));
  });

  it.skipIf(!canForgeJwt)('NOT_AUTHENTICATED: authenticated JWT without a user', async () => {
    const ghost = noSubject();
    expectCode(await ghost.rpc('create_invite'), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('accept_invite', { p_code: 'ABCDEF' }), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('get_daily_question'), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('start_pack_question', { p_question: Q.free }), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('unpair'), 'NOT_AUTHENTICATED');
  });

  it('NOT_PAIRED for get_daily_question, start_pack_question and unpair', async () => {
    const eve = as('eve');
    expectCode(await eve.rpc('get_daily_question'), 'NOT_PAIRED');
    expectCode(await eve.rpc('start_pack_question', { p_question: Q.free }), 'NOT_PAIRED');
    expectCode(await eve.rpc('unpair'), 'NOT_PAIRED');
  });
});

describe('create_invite', () => {
  beforeEach(resetWorld);

  it('returns a code the inviter can read back, and only the inviter', async () => {
    const code = must(await as('maya').rpc('create_invite'), 'create_invite');
    // Live shape until BE-04 (D01 changes it to {code, expires_at} with 4 digits).
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const mine = must(await as('maya').from('pair_invites').select('code, inviter_id'), 'read');
    expect(mine).toEqual([{ code, inviter_id: ID.maya }]);
    expect(must(await as('sam').from('pair_invites').select('code'), 'read')).toEqual([]);
  });

  it('COUPLE_FULL once the caller is in a couple', async () => {
    await pair('maya', 'sam');
    expectCode(await as('maya').rpc('create_invite'), 'COUPLE_FULL');
    expectCode(await as('sam').rpc('create_invite'), 'COUPLE_FULL');
  });
});

describe('accept_invite', () => {
  let mayaCode: string;
  beforeEach(async () => {
    await resetWorld();
    mayaCode = must(await as('maya').rpc('create_invite'), 'create_invite');
  });

  it('pairs the joiner with the inviter; case and surrounding spaces ignored', async () => {
    const couple = must(
      await as('sam').rpc('accept_invite', { p_code: ` ${mayaCode.toLowerCase()} ` }),
      'accept',
    );
    for (const who of ['maya', 'sam'] as const) {
      const c = must(
        await as(who).from('couples').select('id, couple_members(user_id)'),
        'read couple',
      );
      expect(c.map((r) => r.id)).toEqual([couple]);
      expect(c[0].couple_members.map((m) => m.user_id).sort()).toEqual([ID.maya, ID.sam].sort());
    }
  });

  it('INVALID_CODE for an unknown or empty code', async () => {
    expectCode(await as('sam').rpc('accept_invite', { p_code: 'ZZZZZZ' }), 'INVALID_CODE');
    expectCode(await as('sam').rpc('accept_invite', { p_code: '' }), 'INVALID_CODE');
  });

  it('OWN_CODE for the inviter', async () => {
    expectCode(await as('maya').rpc('accept_invite', { p_code: mayaCode }), 'OWN_CODE');
  });

  it('INVITE_EXPIRED for an expired code (expiry pinned in the past)', async () => {
    ok(
      await admin
        .from('pair_invites')
        .update({ expires_at: '2026-01-01T00:00:00Z' })
        .eq('code', mayaCode),
      'expire',
    );
    expectCode(await as('sam').rpc('accept_invite', { p_code: mayaCode }), 'INVITE_EXPIRED');
  });

  it('a retry by the joiner gets ALREADY_PAIRED and creates nothing', async () => {
    const couple = must(await as('sam').rpc('accept_invite', { p_code: mayaCode }), 'accept');
    expectCode(await as('sam').rpc('accept_invite', { p_code: mayaCode }), 'ALREADY_PAIRED');
    const members = must(
      await admin.from('couple_members').select('couple_id').in('user_id', [ID.maya, ID.sam]),
      'members',
    );
    expect(members.map((m) => m.couple_id)).toEqual([couple, couple]);
  });

  it('ALREADY_PAIRED is checked before the code', async () => {
    await as('sam').rpc('accept_invite', { p_code: mayaCode });
    expectCode(await as('maya').rpc('accept_invite', { p_code: 'ZZZZZZ' }), 'ALREADY_PAIRED');
  });

  it('COUPLE_FULL for a used code (J10), also after it expired', async () => {
    must(await as('sam').rpc('accept_invite', { p_code: mayaCode }), 'accept');
    expectCode(await as('lea').rpc('accept_invite', { p_code: mayaCode }), 'COUPLE_FULL');
    ok(
      await admin
        .from('pair_invites')
        .update({ expires_at: '2026-01-01T00:00:00Z' })
        .eq('code', mayaCode),
      'expire',
    );
    expectCode(await as('lea').rpc('accept_invite', { p_code: mayaCode }), 'COUPLE_FULL');
  });

  it('COUPLE_FULL when the inviter paired through someone else', async () => {
    // Maya's invite stays open and unused, but Maya joins Noor's couple instead.
    const noorCode = must(await as('noor').rpc('create_invite'), 'noor invite');
    must(await as('maya').rpc('accept_invite', { p_code: noorCode }), 'maya joins noor');
    expectCode(await as('lea').rpc('accept_invite', { p_code: mayaCode }), 'COUPLE_FULL');
  });

  it('failed accepts create no couple or membership', async () => {
    await as('sam').rpc('accept_invite', { p_code: 'ZZZZZZ' });
    await as('maya').rpc('accept_invite', { p_code: mayaCode });
    const members = must(
      await admin.from('couple_members').select('user_id').in('user_id', Object.values(ID)),
      'members',
    );
    expect(members).toEqual([]);
  });
});

describe('get_daily_question', () => {
  let couple: string;
  beforeEach(async () => {
    await resetWorld();
    couple = await pair('maya', 'sam');
  });

  it("returns today's question; both partners and retries get the same row", async () => {
    const a = must(await as('maya').rpc('get_daily_question'), 'maya');
    const b = must(await as('sam').rpc('get_daily_question'), 'sam');
    const again = must(await as('maya').rpc('get_daily_question'), 'maya retry');
    expect(a).toMatchObject({ couple_id: couple, source: 'daily', answer_count: 0 });
    expect(a.assigned_for).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b.id).toBe(a.id);
    expect(again.id).toBe(a.id);
  });

  it('LIBRARY_EXHAUSTED when the couple has used every daily question', async () => {
    await exhaustLibrary(couple);
    expectCode(await as('maya').rpc('get_daily_question'), 'LIBRARY_EXHAUSTED');
  });
});

describe('start_pack_question', () => {
  let couple: string;
  beforeEach(async () => {
    await resetWorld();
    couple = await pair('maya', 'sam');
  });

  it('starts a free-pack question; a retry returns the same row', async () => {
    const a = must(await as('maya').rpc('start_pack_question', { p_question: Q.free }), 'start');
    expect(a).toMatchObject({
      couple_id: couple,
      question_id: Q.free,
      source: 'pack',
      assigned_for: null,
    });
    const b = must(await as('sam').rpc('start_pack_question', { p_question: Q.free }), 'retry');
    expect(b.id).toBe(a.id);
  });

  it('QUESTION_UNAVAILABLE for a question in no active pack, or an unknown id', async () => {
    expectCode(
      await as('maya').rpc('start_pack_question', { p_question: Q.loose }),
      'QUESTION_UNAVAILABLE',
    );
    expectCode(
      await as('maya').rpc('start_pack_question', { p_question: UNKNOWN_ID }),
      'QUESTION_UNAVAILABLE',
    );
  });

  it('PREMIUM_REQUIRED for a premium-pack question when neither partner is premium', async () => {
    expectCode(
      await as('maya').rpc('start_pack_question', { p_question: Q.premium }),
      'PREMIUM_REQUIRED',
    );
  });

  it('works once the partner is premium (one entitlement covers the couple)', async () => {
    ok(await admin.from('entitlements').insert({ user_id: ID.sam, is_active: true }), 'entitle');
    const row = must(
      await as('maya').rpc('start_pack_question', { p_question: Q.premium }),
      'start',
    );
    expect(row).toMatchObject({ question_id: Q.premium, source: 'pack' });
  });
});

describe('unpair', () => {
  beforeEach(async () => {
    await resetWorld();
    await pair('maya', 'sam');
  });

  it('removes the couple for both; a retry gets NOT_PAIRED (treat as done)', async () => {
    ok(await as('maya').rpc('unpair'), 'unpair');
    expect(must(await as('sam').from('couples').select('id'), 'read')).toEqual([]);
    expectCode(await as('maya').rpc('unpair'), 'NOT_PAIRED');
    expectCode(await as('sam').rpc('unpair'), 'NOT_PAIRED');
  });
});
