// QA-03: CONTRACTS §2 RPCs that are live on main (BE-02, BE-03, BE-24): happy path, every error
// code, anon denied, retries. Each RPC is called through PostgREST as a signed-in persona.
// Changes these RPCs get in BE-04 are test.todo in planned.test.ts.
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
  loose,
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

  it('anon is denied (42501, not a code) for create_couple, create_invite, accept_invite, get_daily_question, start_pack_question, unpair', async () => {
    expectPermissionDenied(await anon.rpc('create_couple', { p_stage: 'dating' }));
    expectPermissionDenied(await anon.rpc('create_invite'));
    expectPermissionDenied(await anon.rpc('accept_invite', { p_code: 'ABCDEF' }));
    expectPermissionDenied(await anon.rpc('get_daily_question'));
    expectPermissionDenied(await anon.rpc('start_pack_question', { p_question: Q.free }));
    expectPermissionDenied(await anon.rpc('unpair'));
  });

  it.skipIf(!canForgeJwt)('NOT_AUTHENTICATED: authenticated JWT without a user', async () => {
    const ghost = noSubject();
    expectCode(await ghost.rpc('create_couple', { p_stage: 'dating' }), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('create_invite'), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('accept_invite', { p_code: 'ABCDEF' }), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('get_daily_question'), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('start_pack_question', { p_question: Q.free }), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('unpair'), 'NOT_AUTHENTICATED');
  });

  it('NOT_PAIRED for create_invite, get_daily_question, start_pack_question and unpair', async () => {
    const eve = as('eve');
    expectCode(await eve.rpc('create_invite'), 'NOT_PAIRED');
    expectCode(await eve.rpc('get_daily_question'), 'NOT_PAIRED');
    expectCode(await eve.rpc('start_pack_question', { p_question: Q.free }), 'NOT_PAIRED');
    expectCode(await eve.rpc('unpair'), 'NOT_PAIRED');
  });
});

describe('create_couple (BE-03, D03)', () => {
  beforeEach(resetWorld);

  it('creates a solo couple: one member, settings cleaned, couple timezone = my profile timezone', async () => {
    const id = must(
      await as('maya').rpc('create_couple', {
        p_stage: 'long_distance',
        p_goals: ['deep_talks', '', 'our_future', 'deep_talks'],
        p_partner_name: '  Sam  ',
      }),
      'create_couple',
    );
    const rows = must(
      await as('maya').from('couples').select('*, couple_members(user_id, left_at)'),
      'read couple',
    );
    expect(rows).toHaveLength(1);
    const c = rows[0];
    expect(c).toMatchObject({
      id,
      stage: 'long_distance',
      goals: ['deep_talks', 'our_future'], // blanks and duplicates dropped, order kept
      partner_name: 'Sam', // trimmed
      status: 'active',
      ended_at: null,
    });
    expect(c.couple_members).toEqual([{ user_id: ID.maya, left_at: null }]);
    const profile = must(
      await as('maya').from('profiles').select('timezone').eq('id', ID.maya).single(),
      'profile',
    );
    expect(c.timezone).toBe(profile.timezone);
  });

  it('caps goals at 12 and partner_name at 40; stage is optional', async () => {
    must(
      await as('lea').rpc('create_couple', {
        p_stage: null as never,
        p_goals: Array.from({ length: 20 }, (_, i) => `goal_${i}`),
        p_partner_name: 'x'.repeat(60),
      }),
      'create_couple',
    );
    const c = must(
      await as('lea').from('couples').select('stage, goals, partner_name').single(),
      'read',
    );
    expect(c.stage).toBeNull();
    expect(c.goals).toHaveLength(12);
    expect(c.partner_name).toHaveLength(40);
  });

  it('a retry while still solo returns the same id, updates the settings, creates nothing', async () => {
    const first = must(
      await as('maya').rpc('create_couple', { p_stage: 'long_distance', p_partner_name: 'Sam' }),
      'first',
    );
    const again = must(
      await as('maya').rpc('create_couple', { p_stage: 'dating', p_goals: ['romance'] }),
      'retry',
    );
    expect(again).toBe(first);
    const c = must(
      await as('maya').from('couples').select('id, stage, goals, partner_name'),
      'read',
    );
    expect(c).toEqual([{ id: first, stage: 'dating', goals: ['romance'], partner_name: null }]);
    const members = must(
      await admin.from('couple_members').select('user_id').eq('couple_id', first),
      'members',
    );
    expect(members).toEqual([{ user_id: ID.maya }]);
  });

  it('ALREADY_PAIRED once the couple has two members; nothing changes', async () => {
    const couple = await pair('maya', 'sam');
    expectCode(
      await as('maya').rpc('create_couple', { p_stage: 'engaged_married' }),
      'ALREADY_PAIRED',
    );
    expectCode(
      await as('sam').rpc('create_couple', { p_stage: 'engaged_married' }),
      'ALREADY_PAIRED',
    );
    const c = must(await as('maya').from('couples').select('id, stage'), 'read');
    expect(c).toEqual([{ id: couple, stage: 'dating' }]);
  });

  it('an unknown stage is rejected by the enum (22P02, a client bug, not a code)', async () => {
    const res = await as('maya').rpc('create_couple', { p_stage: 'married' as never });
    expect(res.error?.code).toBe('22P02');
    expect(must(await as('maya').from('couples').select('id'), 'read')).toEqual([]);
  });

  it('get_daily_question works for a solo couple, and the joiner then gets the same question', async () => {
    const couple = must(await as('maya').rpc('create_couple', { p_stage: 'dating' }), 'create');
    const solo = must(await as('maya').rpc('get_daily_question'), 'solo daily');
    expect(solo).toMatchObject({ couple_id: couple, source: 'daily', answer_count: 0 });
    const code = must(await as('maya').rpc('create_invite'), 'invite');
    must(await as('sam').rpc('accept_invite', { p_code: code }), 'accept');
    expect(must(await as('sam').rpc('get_daily_question'), 'joiner daily').id).toBe(solo.id);
  });
});

describe('create_invite', () => {
  beforeEach(resetWorld);

  it('NOT_PAIRED until create_couple has run (BE-03), then returns a code', async () => {
    expectCode(await as('maya').rpc('create_invite'), 'NOT_PAIRED');
    must(await as('maya').rpc('create_couple', { p_stage: 'dating' }), 'create_couple');
    expect(must(await as('maya').rpc('create_invite'), 'create_invite')).toMatch(
      /^[A-HJ-NP-Z2-9]{6}$/,
    );
  });

  it('returns a code the inviter can read back, and only the inviter; it points at their couple', async () => {
    const couple = must(
      await as('maya').rpc('create_couple', { p_stage: 'dating', p_partner_name: 'Sam' }),
      'create_couple',
    );
    const code = must(await as('maya').rpc('create_invite'), 'create_invite');
    // Live shape until BE-04 (D01 changes it to {code, expires_at} with 4 digits).
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const mine = must(
      await as('maya').from('pair_invites').select('code, inviter_id, couple_id, partner_name'),
      'read',
    );
    expect(mine).toEqual([{ code, inviter_id: ID.maya, couple_id: couple, partner_name: 'Sam' }]);
    expect(must(await as('sam').from('pair_invites').select('code'), 'read')).toEqual([]);
  });

  it('COUPLE_FULL once the caller is in a two-member couple', async () => {
    await pair('maya', 'sam');
    expectCode(await as('maya').rpc('create_invite'), 'COUPLE_FULL');
    expectCode(await as('sam').rpc('create_invite'), 'COUPLE_FULL');
  });
});

describe('accept_invite', () => {
  let mayaCouple: string;
  let mayaCode: string;
  beforeEach(async () => {
    await resetWorld();
    mayaCouple = must(
      await as('maya').rpc('create_couple', {
        p_stage: 'long_distance',
        p_goals: ['deep_talks', 'our_future'],
        p_partner_name: 'Sam',
      }),
      'create_couple',
    );
    mayaCode = must(await as('maya').rpc('create_invite'), 'create_invite');
  });

  it("joins the inviter's couple (same id); case and surrounding spaces ignored", async () => {
    const couple = must(
      await as('sam').rpc('accept_invite', { p_code: ` ${mayaCode.toLowerCase()} ` }),
      'accept',
    );
    expect(couple).toBe(mayaCouple);
    for (const who of ['maya', 'sam'] as const) {
      const c = must(
        await as(who).from('couples').select('id, couple_members(user_id)'),
        'read couple',
      );
      expect(c.map((r) => r.id)).toEqual([couple]);
      expect(c[0].couple_members.map((m) => m.user_id).sort()).toEqual([ID.maya, ID.sam].sort());
    }
    const invite = must(
      await as('maya').from('pair_invites').select('accepted_by, accepted_at'),
      'invite',
    );
    expect(invite[0].accepted_by).toBe(ID.sam);
    expect(invite[0].accepted_at).not.toBeNull();
  });

  it('the joiner inherits stage, goals and key dates (J5)', async () => {
    must(
      await as('maya')
        .from('key_dates')
        .insert({
          couple_id: mayaCouple,
          kind: 'together_since',
          date: '2023-03-14',
          remind_week_before: true,
        })
        .select(),
      'key date',
    );
    expect(must(await as('sam').from('key_dates').select('id'), 'before')).toEqual([]);
    must(await as('sam').rpc('accept_invite', { p_code: mayaCode }), 'accept');
    const c = must(await as('sam').from('couples').select('stage, goals, partner_name'), 'couple');
    expect(c).toEqual([
      { stage: 'long_distance', goals: ['deep_talks', 'our_future'], partner_name: 'Sam' },
    ]);
    const dates = must(
      await as('sam').from('key_dates').select('kind, date, remind_week_before, user_id'),
      'dates',
    );
    expect(dates).toEqual([
      { kind: 'together_since', date: '2023-03-14', remind_week_before: true, user_id: null },
    ]);
  });

  it('INVALID_CODE for an unknown or empty code', async () => {
    expectCode(await as('sam').rpc('accept_invite', { p_code: 'ZZZZZZ' }), 'INVALID_CODE');
    expectCode(await as('sam').rpc('accept_invite', { p_code: '' }), 'INVALID_CODE');
  });

  it('OWN_CODE for the inviter, even though they now have a (solo) couple', async () => {
    expectCode(await as('maya').rpc('accept_invite', { p_code: mayaCode }), 'OWN_CODE');
  });

  it('ALREADY_PAIRED for a caller with a solo couple and a valid code (until BE-04, D04)', async () => {
    must(await as('sam').rpc('create_couple', { p_stage: 'dating' }), 'sam solo');
    expectCode(await as('sam').rpc('accept_invite', { p_code: mayaCode }), 'ALREADY_PAIRED');
    // INVALID_CODE and OWN_CODE are checked before the solo-caller ALREADY_PAIRED.
    expectCode(await as('sam').rpc('accept_invite', { p_code: 'ZZZZZZ' }), 'INVALID_CODE');
    const members = must(
      await admin.from('couple_members').select('couple_id').eq('couple_id', mayaCouple),
      'members',
    );
    expect(members).toHaveLength(1);
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

  it('COUPLE_FULL for a second, unused code of a couple that is now full', async () => {
    // Until BE-04 (one active invite per inviter) Maya can hold two open codes.
    const second = must(await as('maya').rpc('create_invite'), 'second invite');
    must(await as('sam').rpc('accept_invite', { p_code: mayaCode }), 'sam joins');
    expectCode(await as('lea').rpc('accept_invite', { p_code: second }), 'COUPLE_FULL');
  });

  it('failed accepts create no couple or membership', async () => {
    await as('sam').rpc('accept_invite', { p_code: 'ZZZZZZ' });
    await as('maya').rpc('accept_invite', { p_code: mayaCode });
    const members = must(
      await admin.from('couple_members').select('user_id').in('user_id', Object.values(ID)),
      'members',
    );
    expect(members).toEqual([{ user_id: ID.maya }]); // only Maya's solo membership
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

// BE-24: the 0001 SECURITY DEFINER helpers moved to the `private` schema. They are not part of
// the API: no persona (member, outsider, anon) can call them with rpc(), nor name the schema.
describe('private helpers are unreachable (BE-24)', () => {
  const ARG = '00000000-0000-4000-a000-0000000000ee';
  const HELPERS: Array<[string, Record<string, string>]> = [
    ['my_couple_id', {}],
    ['is_cq_member', { p_cq: ARG }],
    ['has_answered', { p_cq: ARG }],
    ['both_answered', { p_cq: ARG }],
    ['answer_cq', { p_answer: ARG }],
    ['message_cq', { p_message: ARG }],
    ['is_couple_premium', { p_couple: ARG }],
  ];
  const callers = { maya: as('maya'), eve: as('eve'), anon };
  let foreignCq: string;

  beforeAll(async () => {
    await resetWorld();
    await pair('eve', 'finn');
    foreignCq = must(await as('eve').rpc('get_daily_question'), 'eve daily').id;
  });

  for (const [fn, args] of HELPERS) {
    for (const [who, db] of Object.entries(callers)) {
      it(`rpc('${fn}') as ${who} finds no such function`, async () => {
        const res = await loose(db).rpc(fn, args);
        expect(res.data).toBeNull();
        expect(res.error, 'expected an error').not.toBeNull();
        // PostgREST: function not in the schema cache.
        expect(res.error!.code).toBe('PGRST202');
        expect(res.status).toBe(404);
      });
    }
  }

  it('the private schema itself is not exposed through the API', async () => {
    for (const [who, db] of Object.entries(callers)) {
      const res = await loose(db).schema('private').rpc('my_couple_id');
      expect(res.error?.code, `as ${who}`).toBe('PGRST106');
      expect(res.data).toBeNull();
    }
  });

  it('an outsider cannot learn whether another couple answered (has_answered/both_answered on a foreign question)', async () => {
    ok(
      await as('eve')
        .from('answers')
        .insert({ couple_question_id: foreignCq, user_id: ID.eve, body: 'FIXTURE-CONTRACT-EVE-1' }),
      'eve answers',
    );
    for (const fn of ['has_answered', 'both_answered', 'is_cq_member']) {
      const res = await loose(as('maya')).rpc(fn, { p_cq: foreignCq });
      expect(res.data, fn).toBeNull();
      expect(res.error?.code, fn).toBe('PGRST202');
    }
  });
});
