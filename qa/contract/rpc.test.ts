// QA-03: CONTRACTS §2 RPCs that are live on main (BE-02, BE-03, BE-24): happy path, every error
// code, anon denied, retries. Each RPC is called through PostgREST as a signed-in persona.
// Changes these RPCs get in BE-04 are test.todo in planned.test.ts.
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ID,
  admin,
  anon,
  as,
  canForgeJwt,
  createInvite,
  ensureContent,
  exhaustLibrary,
  expectCode,
  expectPermissionDenied,
  firstDayId,
  joinByCode,
  loose,
  must,
  ok,
  noSubject,
  pair,
  preStartedPackRow,
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
    expectPermissionDenied(await anon.rpc('accept_invite', { p_code: '4827' }));
    expectPermissionDenied(await anon.rpc('get_daily_question'));
    expectPermissionDenied(await anon.rpc('start_pack_question', { p_question: Q.free }));
    expectPermissionDenied(await anon.rpc('unpair'));
  });

  it.skipIf(!canForgeJwt)('NOT_AUTHENTICATED: authenticated JWT without a user', async () => {
    const ghost = noSubject();
    expectCode(await ghost.rpc('create_couple', { p_stage: 'dating' }), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('create_invite'), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('accept_invite', { p_code: '4827' }), 'NOT_AUTHENTICATED');
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
    const { code } = await createInvite('maya');
    await joinByCode('sam', 'maya', code);
    expect(must(await as('sam').rpc('get_daily_question'), 'joiner daily').id).toBe(solo.id);
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

  it('day 1 is the first_day special question (D12), not an ordinary daily', async () => {
    const first = must(await as('maya').rpc('get_daily_question'), 'day 1');
    expect(first.question_id).toBe(await firstDayId());
    const q = must(
      await as('maya')
        .from('questions')
        .select('special, daily_eligible')
        .eq('id', first.question_id)
        .single(),
      'question',
    );
    expect(q).toEqual({ special: 'first_day', daily_eligible: false });
    expect(first).toMatchObject({ source: 'daily', answer_count: 0 });
  });

  it('day 2 is an ordinary daily question: never a special, never the first_day again', async () => {
    const first = must(await as('maya').rpc('get_daily_question'), 'day 1');
    // Move day 1 into the past (the clock is not injectable through the API).
    ok(
      await admin
        .from('couple_questions')
        .update({ assigned_for: '2020-01-01' })
        .eq('id', first.id),
      'age day 1',
    );
    const second = must(await as('sam').rpc('get_daily_question'), 'day 2');
    expect(second.id).not.toBe(first.id);
    expect(second.question_id).toBe(Q.daily);
    const q = must(
      await as('sam').from('questions').select('special').eq('id', second.question_id).single(),
      'question',
    );
    expect(q.special).toBeNull();
  });

  it("daily questions respect the couple's stage; '{}' fits every stage", async () => {
    // The FIXTURE stage question (engaged_married only) sorts before every other daily question.
    const stages = [
      ['maya', 'sam', 'dating', Q.daily],
      ['lea', 'noor', 'engaged_married', Q.stage],
    ] as const;
    await resetWorld();
    for (const [a, b, stage, expected] of stages) {
      must(await as(a).rpc('create_couple', { p_stage: stage }), `${a} create_couple`);
      const { code } = await createInvite(a);
      await joinByCode(b, a, code);
      const day1 = must(await as(a).rpc('get_daily_question'), `${a} day 1`);
      ok(
        await admin
          .from('couple_questions')
          .update({ assigned_for: '2020-01-01' })
          .eq('id', day1.id),
        'age day 1',
      );
      const day2 = must(await as(b).rpc('get_daily_question'), `${b} day 2`);
      expect(day2.question_id, `${stage} couple`).toBe(expected);
    }
  });
});

describe('start_pack_question', () => {
  let couple: string;
  beforeEach(async () => {
    await resetWorld();
    couple = await pair('maya', 'sam');
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

  it('a premium couple starts a question; a retry by the partner returns the same row', async () => {
    ok(await admin.from('entitlements').insert({ user_id: ID.sam, is_active: true }), 'entitle');
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

  it('works once the partner is premium (one entitlement covers the couple)', async () => {
    ok(await admin.from('entitlements').insert({ user_id: ID.sam, is_active: true }), 'entitle');
    const row = must(
      await as('maya').rpc('start_pack_question', { p_question: Q.premium }),
      'start',
    );
    expect(row).toMatchObject({ question_id: Q.premium, source: 'pack' });
  });
});

describe('start_pack_question: no free pack questions (D51, BE-46; reverses D43/BE-36)', () => {
  let couple: string;
  const start = (who: 'maya' | 'sam', q: string) =>
    as(who).rpc('start_pack_question', { p_question: q });
  const rowsFor = async (q: string) =>
    must(
      await admin
        .from('couple_questions')
        .select('id')
        .eq('couple_id', couple)
        .eq('question_id', q),
      'rows',
    );
  beforeEach(async () => {
    await resetWorld();
    couple = await pair('maya', 'sam');
  });

  it('a free couple gets PREMIUM_REQUIRED for position 1 and 2 of a premium pack, for both partners, and no row', async () => {
    for (const q of [Q.premiumFirst, Q.premium]) {
      expectCode(await start('maya', q), 'PREMIUM_REQUIRED');
      expectCode(await start('sam', q), 'PREMIUM_REQUIRED');
      expect(await rowsFor(q)).toEqual([]);
    }
  });

  it("a pack's is_premium=false flag no longer grants free access", async () => {
    expectCode(await start('maya', Q.free), 'PREMIUM_REQUIRED');
    expect(await rowsFor(Q.free)).toEqual([]);
  });

  it('an expired or inactive entitlement does not unlock any pack question', async () => {
    ok(
      await admin.from('entitlements').insert([
        { user_id: ID.maya, is_active: true, expires_at: '2020-01-01T00:00:00Z' },
        { user_id: ID.sam, is_active: false },
      ]),
      'expired + inactive entitlements',
    );
    for (const q of [Q.premiumFirst, Q.premium, Q.free]) {
      expectCode(await start('sam', q), 'PREMIUM_REQUIRED');
    }
  });

  it('a premium couple starts every pack question (either partner entitled); the partner gets the same row', async () => {
    ok(await admin.from('entitlements').insert({ user_id: ID.maya, is_active: true }), 'entitle');
    for (const q of [Q.premiumFirst, Q.premium, Q.free]) {
      const mine = must(await start('sam', q), `sam starts ${q}`);
      expect(mine).toMatchObject({ couple_id: couple, question_id: q, source: 'pack' });
      expect(must(await start('maya', q), `maya ${q}`).id).toBe(mine.id);
      expect(await rowsFor(q)).toHaveLength(1);
    }
  });

  it('availability is checked before premium: an inactive question is QUESTION_UNAVAILABLE for a free couple', async () => {
    ok(
      await admin.from('questions').update({ active: false }).eq('id', Q.premiumFirst),
      'deactivate q1',
    );
    try {
      expectCode(await start('maya', Q.premiumFirst), 'QUESTION_UNAVAILABLE');
      expectCode(await start('maya', Q.premium), 'PREMIUM_REQUIRED');
    } finally {
      ok(
        await admin.from('questions').update({ active: true }).eq('id', Q.premiumFirst),
        'reactivate q1',
      );
    }
  });

  it('a row the free couple already has (started under D43) is returned as-is, then answered and revealed', async () => {
    const pre = await preStartedPackRow(couple, Q.premiumFirst);
    const a = must(await start('maya', Q.premiumFirst), 'maya opens her D43 row');
    const b = must(await start('sam', Q.premiumFirst), 'sam opens the same row');
    expect(a).toMatchObject({ id: pre.id, couple_id: couple, question_id: Q.premiumFirst });
    expect(b.id).toBe(pre.id);
    expect(await rowsFor(Q.premiumFirst)).toHaveLength(1);
    // Other pack questions stay locked for this couple.
    expectCode(await start('maya', Q.premium), 'PREMIUM_REQUIRED');

    ok(
      await as('maya')
        .from('answers')
        .insert({ couple_question_id: pre.id, user_id: ID.maya, body: 'FIXTURE-CONTRACT-D43-MAYA' }),
      'maya answers',
    );
    // Reveal rule: Sam cannot read Maya's answer before he answers.
    expect(
      must(await as('sam').from('answers').select('body').eq('couple_question_id', pre.id), 'early'),
    ).toEqual([]);
    ok(
      await as('sam')
        .from('answers')
        .insert({ couple_question_id: pre.id, user_id: ID.sam, body: 'FIXTURE-CONTRACT-D43-SAM' }),
      'sam answers',
    );
    const seen = must(
      await as('sam').from('answers').select('user_id').eq('couple_question_id', pre.id),
      'revealed',
    );
    expect(seen.map((r) => r.user_id).sort()).toEqual([ID.maya, ID.sam].sort());
    ok(
      await as('maya').from('thread_messages').insert({
        client_id: randomUUID(),
        couple_question_id: pre.id,
        user_id: ID.maya,
        body: 'FIXTURE-CONTRACT-D43-MSG',
      }),
      'thread opens on the D43 row',
    );
  });

  it("a row is per couple: another free couple cannot start the question another couple has", async () => {
    const mine = await preStartedPackRow(couple, Q.premiumFirst);
    await pair('eve', 'finn');
    expectCode(
      await as('eve').rpc('start_pack_question', { p_question: Q.premiumFirst }),
      'PREMIUM_REQUIRED',
    );
    expect(
      must(await as('eve').from('couple_questions').select('id').eq('id', mine.id), 'eve reads'),
    ).toEqual([]);
  });
});

describe('unpair', () => {
  beforeEach(async () => {
    await resetWorld();
    await pair('maya', 'sam');
  });

  // BE-09 (D08): the couple is ended, not deleted; the read-only archive and the 30-day window
  // are covered in ended-couples.test.ts.
  it('ends the couple for both; a retry gets NOT_PAIRED (treat as done)', async () => {
    ok(await as('maya').rpc('unpair'), 'unpair');
    expect(
      must(await as('sam').from('couples').select('id').eq('status', 'active'), 'active'),
    ).toEqual([]);
    const ended = must(await as('sam').from('couples').select('status, ended_at'), 'read');
    expect(ended).toHaveLength(1);
    expect(ended[0].status).toBe('ended');
    expect(ended[0].ended_at).not.toBeNull();
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
    // BE-04: the pinned-clock variants and limiter internals are private too.
    ['create_invite_at', { p_now: '2026-11-02T10:00:00Z' }],
    ['accept_invite_at', { p_code: '1234', p_token: 'x', p_now: '2026-11-02T10:00:00Z' }],
    ['invite_preview_at', { p_code: '1234', p_token: 'x', p_now: '2026-11-02T10:00:00Z' }],
    ['invite_limited', { p_actor: 'u:x', p_now: '2026-11-02T10:00:00Z' }],
    ['invite_record_failure', { p_actor: 'u:x', p_now: '2026-11-02T10:00:00Z' }],
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
