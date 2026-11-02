// QA-03: CONTRACTS §2 "Direct table access" rows that are live on main, as the app calls them.
// Maya and Sam are a couple, Eve is the outsider (other couple), anon is signed out.
// Answer and message bodies are FIXTURE- text (privacy tests grep for it).
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ID,
  admin,
  anon,
  as,
  ensureContent,
  expectPermissionDenied,
  must,
  ok,
  pair,
  resetWorld,
} from './helpers';

let couple: string;
let cqId: string;

beforeAll(async () => {
  await ensureContent();
  await resetWorld();
  couple = await pair('maya', 'sam');
  await pair('eve', 'finn');
  cqId = must(await as('maya').rpc('get_daily_question'), 'daily').id;
});

const detail = (who: 'maya' | 'sam' | 'eve') =>
  as(who)
    .from('couple_questions')
    .select('*, question:questions(*), answers(*)')
    .eq('id', cqId)
    .maybeSingle();

const upsertAnswer = (who: 'maya' | 'sam' | 'eve', body: string) =>
  as(who)
    .from('answers')
    .upsert(
      { couple_question_id: cqId, user_id: ID[who], body },
      { onConflict: 'couple_question_id,user_id' },
    )
    .select();

describe('profiles', () => {
  it('a partner reads self and partner; the outsider reads only self', async () => {
    const mine = must(await as('maya').from('profiles').select('id'), 'maya');
    expect(mine.map((p) => p.id).sort()).toEqual([ID.maya, ID.sam].sort());
    const leas = must(await as('lea').from('profiles').select('id'), 'lea');
    expect(leas.map((p) => p.id)).toEqual([ID.lea]);
  });

  it('updates only my own profile', async () => {
    const own = must(
      await as('maya').from('profiles').update({ locale: 'en' }).eq('id', ID.maya).select('id'),
      'own',
    );
    expect(own).toHaveLength(1);
    const partner = must(
      await as('maya').from('profiles').update({ locale: 'de' }).eq('id', ID.sam).select('id'),
      'partner',
    );
    expect(partner).toEqual([]);
  });
});

describe('couple and invites', () => {
  it('the outsider and anon see neither the couple nor its members', async () => {
    const eve = must(await as('eve').from('couples').select('id'), 'eve');
    expect(eve.map((c) => c.id)).not.toContain(couple);
    expect(
      must(await as('eve').from('couple_members').select('user_id').eq('couple_id', couple), 'm'),
    ).toEqual([]);
    expect(must(await anon.from('couples').select('id'), 'anon')).toEqual([]);
    expect(must(await anon.from('pair_invites').select('code'), 'anon')).toEqual([]);
  });

  it('a member reads the couple with members and status, as the app does (maybeSingle)', async () => {
    const res = await as('maya')
      .from('couples')
      .select('*, couple_members(user_id, left_at)')
      .eq('status', 'active')
      .maybeSingle();
    const c = must(res, 'couple');
    expect(c).toMatchObject({ id: couple, status: 'active', ended_at: null });
    expect(c.couple_members.map((m) => m.user_id).sort()).toEqual([ID.maya, ID.sam].sort());
    expect(c.couple_members.every((m) => m.left_at === null)).toBe(true);
    // No ended couple for anyone yet.
    expect(
      must(await as('maya').from('couples').select('id').eq('status', 'ended'), 'ended'),
    ).toEqual([]);
  });
});

describe('couple settings (BE-03, D10)', () => {
  it('a member updates stage, goals and partner_name; the partner sees it', async () => {
    const updated = must(
      await as('maya')
        .from('couples')
        .update({ stage: 'living_together', goals: ['romance', 'fun'], partner_name: 'Sam' })
        .eq('id', couple)
        .select('stage, goals, partner_name'),
      'update',
    );
    expect(updated).toEqual([
      { stage: 'living_together', goals: ['romance', 'fun'], partner_name: 'Sam' },
    ]);
    const seen = must(
      await as('sam').from('couples').select('stage, goals').eq('id', couple),
      'sam',
    );
    expect(seen).toEqual([{ stage: 'living_together', goals: ['romance', 'fun'] }]);
  });

  it('stage accepts only dating, living_together, engaged_married, long_distance', async () => {
    for (const stage of [
      'dating',
      'living_together',
      'engaged_married',
      'long_distance',
    ] as const) {
      expect(
        must(
          await as('maya').from('couples').update({ stage }).eq('id', couple).select('stage'),
          stage,
        ),
      ).toEqual([{ stage }]);
    }
    const bad = await as('maya')
      .from('couples')
      .update({ stage: 'married' as never })
      .eq('id', couple);
    expect(bad.error?.code).toBe('22P02');
  });

  it('rejects more than 12 goals and a partner_name over 40 characters (23514)', async () => {
    const goals = await as('maya')
      .from('couples')
      .update({ goals: Array.from({ length: 13 }, (_, i) => `g${i}`) })
      .eq('id', couple);
    expect(goals.error?.code).toBe('23514');
    const name = await as('maya')
      .from('couples')
      .update({ partner_name: 'x'.repeat(41) })
      .eq('id', couple);
    expect(name.error?.code).toBe('23514');
  });

  it('status, ended_at and id are server-owned: permission denied (42501)', async () => {
    const status = await as('maya').from('couples').update({ status: 'ended' }).eq('id', couple);
    expect(status.error?.code).toBe('42501');
    const ended = await as('maya')
      .from('couples')
      .update({ ended_at: '2026-11-02T10:00:00Z' })
      .eq('id', couple);
    expect(ended.error?.code).toBe('42501');
    const id = await as('maya').from('couples').update({ id: randomUUID() }).eq('id', couple);
    expect(id.error?.code).toBe('42501');
    const c = must(
      await as('maya').from('couples').select('status, ended_at').eq('id', couple),
      'read',
    );
    expect(c).toEqual([{ status: 'active', ended_at: null }]);
  });

  it('a couple cannot be created or deleted from the client (create_couple is the only way)', async () => {
    const ins = await as('lea').from('couples').insert({ timezone: 'UTC' });
    expect(ins.error?.code).toBe('42501');
    const del = await as('maya').from('couples').delete().eq('id', couple).select('id');
    expect(del.error ? del.error.code : del.data).toSatisfy(
      (v: unknown) => v === '42501' || (Array.isArray(v) && v.length === 0),
    );
    expect(
      must(await as('maya').from('couples').select('id').eq('id', couple), 'still there'),
    ).toHaveLength(1);
  });

  it('the outsider updates nothing: 0 rows affected, the couple is unchanged', async () => {
    const res = await as('eve')
      .from('couples')
      .update({ stage: 'dating', goals: ['FIXTURE-CONTRACT-EVE'] })
      .eq('id', couple)
      .select('id');
    expect(res.error).toBeNull();
    expect(res.data).toEqual([]);
    const c = must(await as('maya').from('couples').select('goals').eq('id', couple), 'read');
    expect(c[0].goals).not.toContain('FIXTURE-CONTRACT-EVE');
  });
});

describe('key_dates (BE-03, D10)', () => {
  type KeyDate = {
    couple_id: string;
    kind: 'together_since' | 'anniversary' | 'birthday';
    user_id: string | null;
    date: string;
    remind_week_before?: boolean;
  };
  const upsert = (who: 'maya' | 'sam' | 'eve', row: KeyDate) =>
    as(who).from('key_dates').upsert(row, { onConflict: 'couple_id,kind,user_id' }).select();

  it('members upsert couple-wide dates: one row per kind, the partner reads it', async () => {
    must(
      await upsert('maya', {
        couple_id: couple,
        kind: 'together_since',
        user_id: null,
        date: '2023-03-14',
        remind_week_before: true,
      }),
      'insert',
    );
    // The partner edits the same row: still one row, new date.
    const edited = must(
      await upsert('sam', {
        couple_id: couple,
        kind: 'together_since',
        user_id: null,
        date: '2023-03-15',
        remind_week_before: false,
      }),
      'edit',
    );
    expect(edited).toHaveLength(1);
    const rows = must(
      await as('maya')
        .from('key_dates')
        .select('kind, user_id, date, remind_week_before')
        .eq('kind', 'together_since'),
      'read',
    );
    expect(rows).toEqual([
      { kind: 'together_since', user_id: null, date: '2023-03-15', remind_week_before: false },
    ]);
    must(
      await upsert('maya', {
        couple_id: couple,
        kind: 'anniversary',
        user_id: null,
        date: '2024-06-01',
      }),
      'anniversary',
    );
  });

  it('a birthday carries its owner; each partner sets only their own', async () => {
    must(
      await upsert('maya', {
        couple_id: couple,
        kind: 'birthday',
        user_id: ID.maya,
        date: '1994-05-09',
      }),
      'maya',
    );
    must(
      await upsert('sam', {
        couple_id: couple,
        kind: 'birthday',
        user_id: ID.sam,
        date: '1993-11-20',
      }),
      'sam',
    );
    const both = must(
      await as('maya')
        .from('key_dates')
        .select('user_id, date')
        .eq('kind', 'birthday')
        .order('user_id'),
      'read',
    );
    expect(both.map((r) => r.user_id).sort()).toEqual([ID.maya, ID.sam].sort());

    const forged = await upsert('sam', {
      couple_id: couple,
      kind: 'birthday',
      user_id: ID.maya,
      date: '2001-01-01',
    });
    expect(forged.error?.code).toBe('42501');
    const edit = must(
      await as('sam')
        .from('key_dates')
        .update({ date: '2001-01-01' })
        .eq('kind', 'birthday')
        .eq('user_id', ID.maya)
        .select('id'),
      'edit partner birthday',
    );
    expect(edit).toEqual([]);
    const maya = must(
      await as('maya')
        .from('key_dates')
        .select('date')
        .eq('kind', 'birthday')
        .eq('user_id', ID.maya),
      'maya',
    );
    expect(maya).toEqual([{ date: '1994-05-09' }]);
  });

  it('kind accepts only together_since, anniversary, birthday; a birthday needs user_id, the others must not have one', async () => {
    const badKind = await as('maya')
      .from('key_dates')
      .insert({ couple_id: couple, kind: 'wedding' as never, date: '2020-01-01' });
    expect(badKind.error?.code).toBe('22P02');
    const noOwner = await as('maya')
      .from('key_dates')
      .insert({ couple_id: couple, kind: 'birthday', date: '2000-01-01' });
    expect(noOwner.error?.code).toBe('23514');
    const owned = await as('maya')
      .from('key_dates')
      .insert({ couple_id: couple, kind: 'anniversary', user_id: ID.maya, date: '2000-01-01' });
    expect(owned.error?.code).toBe('23514');
  });

  it('a second together_since for the couple is a duplicate (23505), not a second row', async () => {
    const dup = await as('maya')
      .from('key_dates')
      .insert({ couple_id: couple, kind: 'together_since', date: '2020-01-01' });
    expect(dup.error?.code).toBe('23505');
  });

  it('the outsider sees nothing and writes nothing; anon is denied', async () => {
    expect(
      must(await as('eve').from('key_dates').select('id').eq('couple_id', couple), 'eve'),
    ).toEqual([]);
    const write = await upsert('eve', {
      couple_id: couple,
      kind: 'anniversary',
      user_id: null,
      date: '2000-01-01',
    });
    expect(write.error?.code).toBe('42501');
    const del = must(
      await as('eve').from('key_dates').delete().eq('couple_id', couple).select('id'),
      'eve delete',
    );
    expect(del).toEqual([]);
    expectPermissionDenied(await anon.from('key_dates').select('id'));
    const mayaStill = must(
      await as('maya').from('key_dates').select('id').eq('couple_id', couple),
      'maya',
    );
    expect(mayaStill.length).toBeGreaterThanOrEqual(4);
  });
});

describe('the reveal rule (release blocker)', () => {
  it("the partner's answer is absent until I answer; answer_count shows progress without text", async () => {
    must(await upsertAnswer('sam', 'FIXTURE-CONTRACT-SAM-1'), 'sam answers');

    const before = must(await detail('maya'), 'maya before')!;
    expect(before.answers.map((a) => a.user_id)).not.toContain(ID.sam);
    expect(before.answer_count).toBe(1);
    expect(
      must(
        await as('maya').from('answers').select('user_id').eq('couple_question_id', cqId),
        'flat',
      ),
    ).toEqual([]);

    must(await upsertAnswer('maya', 'FIXTURE-CONTRACT-MAYA-1'), 'maya answers');
    const after = must(await detail('maya'), 'maya after')!;
    expect(after.answers.map((a) => a.user_id).sort()).toEqual([ID.maya, ID.sam].sort());
    expect(after.answer_count).toBe(2);
  });

  it('an edit is an idempotent upsert: still one row per person', async () => {
    must(await upsertAnswer('maya', 'FIXTURE-CONTRACT-MAYA-2'), 'edit');
    must(await upsertAnswer('maya', 'FIXTURE-CONTRACT-MAYA-2'), 'retry');
    const rows = must(
      await as('sam').from('answers').select('user_id, body').eq('couple_question_id', cqId),
      'rows',
    );
    expect(rows.filter((r) => r.user_id === ID.maya)).toEqual([
      { user_id: ID.maya, body: 'FIXTURE-CONTRACT-MAYA-2' },
    ]);
  });

  it('the outsider and anon read nothing and the outsider cannot answer', async () => {
    const eveDetail = await detail('eve');
    expect(eveDetail.error).toBeNull();
    expect(eveDetail.data).toBeNull();
    expect(
      must(await as('eve').from('answers').select('id').eq('couple_question_id', cqId), 'eve'),
    ).toEqual([]);
    expect(must(await anon.from('answers').select('id'), 'anon')).toEqual([]);
    const write = await upsertAnswer('eve', 'FIXTURE-CONTRACT-EVE');
    expect(write.error?.code).toBe('42501');
  });

  it('nobody can write an answer as their partner', async () => {
    const res = await as('maya')
      .from('answers')
      .insert({ couple_question_id: cqId, user_id: ID.sam, body: 'FIXTURE-CONTRACT-FORGED' });
    expect(res.error?.code).toBe('42501');
  });
});

describe('thread', () => {
  it('stays closed until both answered', async () => {
    const cq = must(
      await as('maya').rpc('start_pack_question', { p_question: (await ensureContent()).free }),
      'pack',
    );
    ok(
      await as('maya')
        .from('answers')
        .insert({ couple_question_id: cq.id, user_id: ID.maya, body: 'FIXTURE-CONTRACT-PACK' }),
      'maya answers pack',
    );
    const res = await as('maya').from('thread_messages').insert({
      client_id: randomUUID(),
      couple_question_id: cq.id,
      user_id: ID.maya,
      body: 'FIXTURE-CONTRACT-EARLY',
    });
    expect(res.error?.code).toBe('42501');
  });

  it('opens after both answered; a resend with the same client_id is a duplicate', async () => {
    const clientId = randomUUID();
    const send = () =>
      as('sam').from('thread_messages').insert({
        client_id: clientId,
        couple_question_id: cqId,
        user_id: ID.sam,
        body: 'FIXTURE-CONTRACT-MSG',
      });
    ok(await send(), 'send');
    expect((await send()).error?.code).toBe('23505');
    const seen = must(
      await as('maya')
        .from('thread_messages')
        .select('client_id')
        .eq('couple_question_id', cqId)
        .order('created_at'),
      'maya reads',
    );
    expect(seen.map((m) => m.client_id)).toEqual([clientId]);
  });

  it('the outsider can neither read nor post', async () => {
    expect(
      must(
        await as('eve').from('thread_messages').select('id').eq('couple_question_id', cqId),
        'eve',
      ),
    ).toEqual([]);
    const res = await as('eve').from('thread_messages').insert({
      client_id: randomUUID(),
      couple_question_id: cqId,
      user_id: ID.eve,
      body: 'FIXTURE-CONTRACT-EVE',
    });
    expect(res.error?.code).toBe('42501');
  });

  it('read markers: mine only, and only in my couple', async () => {
    ok(
      await as('maya').from('thread_reads').upsert({
        couple_question_id: cqId,
        user_id: ID.maya,
        last_read_at: '2026-11-02T10:00:00Z',
      }),
      'mark read',
    );
    const forged = await as('maya')
      .from('thread_reads')
      .upsert({ couple_question_id: cqId, user_id: ID.sam, last_read_at: '2026-11-02T10:00:00Z' });
    expect(forged.error?.code).toBe('42501');
    const outsider = await as('eve')
      .from('thread_reads')
      .upsert({ couple_question_id: cqId, user_id: ID.eve, last_read_at: '2026-11-02T10:00:00Z' });
    expect(outsider.error?.code).toBe('42501');
  });
});

describe('catalogue, entitlements, push tokens', () => {
  it('packs with their questions are readable by a signed-in user, not by anon', async () => {
    const packs = must(
      await as('maya')
        .from('question_packs')
        .select('*, pack_questions(position, question:questions(*))')
        .order('sort_order'),
      'packs',
    );
    expect(packs.map((p) => p.slug)).toEqual(
      expect.arrayContaining(['fixture-contract-free', 'fixture-contract-premium']),
    );
    expect(must(await anon.from('question_packs').select('id'), 'anon')).toEqual([]);
  });

  it("entitlements: I see mine and my partner's, the outsider sees neither, users cannot write", async () => {
    ok(await admin.from('entitlements').upsert({ user_id: ID.sam, is_active: true }), 'entitle');
    const rows = must(await as('maya').from('entitlements').select('user_id, is_active'), 'maya');
    expect(rows).toEqual([{ user_id: ID.sam, is_active: true }]);
    expect(must(await as('eve').from('entitlements').select('user_id'), 'eve')).toEqual([]);
    const write = await as('maya')
      .from('entitlements')
      .upsert({ user_id: ID.maya, is_active: true });
    expect(write.error?.code).toBe('42501');
  });

  it('push tokens: register my own; never for someone else, never visible to the partner', async () => {
    const token = `FIXTURE-CONTRACT-TOKEN-${randomUUID()}`;
    ok(
      await as('maya').from('push_tokens').upsert({ token, user_id: ID.maya, platform: 'ios' }),
      'register',
    );
    const forged = await as('maya')
      .from('push_tokens')
      .upsert({ token: `${token}-sam`, user_id: ID.sam, platform: 'android' });
    expect(forged.error?.code).toBe('42501');
    expect(must(await as('sam').from('push_tokens').select('token'), 'sam')).toEqual([]);
  });
});
