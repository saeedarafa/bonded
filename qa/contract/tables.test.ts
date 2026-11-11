// QA-03: CONTRACTS §2 "Direct table access" rows that are live on main, as the app calls them.
// Maya and Sam are a couple, Eve is the outsider (other couple), anon is signed out.
// Answer and message bodies are FIXTURE- text (privacy tests grep for it).
import { randomUUID } from 'node:crypto';
import type { PostgrestError } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ID,
  admin,
  anon,
  as,
  ensureContent,
  expectCode,
  expectPermissionDenied,
  must,
  ok,
  pair,
  preStartedPackRow,
  resetWorld,
} from './helpers';

let couple: string;
let cqId: string;

beforeAll(async () => {
  await ensureContent();
  await resetWorld();
  couple = await pair('maya', 'sam');
  await pair('eve', 'finn', 'link'); // the other path: the invite link pairs at once
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
    // BE-04: anon has no grant on pair_invites at all.
    expect((await anon.from('pair_invites').select('code')).error?.code).toBe('42501');
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
    // D51: a free couple cannot start a pack question; use a pre-started (D43-era) row.
    const cq = await preStartedPackRow(couple, (await ensureContent()).free);
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

/** BE-41: too long is ANSWER_TOO_LONG (P0001) with details = the JSON string {"max":n}. */
function expectTooLong(res: { error: PostgrestError | null }, max: 500 | 2000) {
  expectCode(res, 'ANSWER_TOO_LONG');
  expect(typeof res.error!.details).toBe('string');
  expect(JSON.parse(res.error!.details)).toEqual({ max });
}
/** FIXTURE- text of exactly n characters, so privacy greps still find it. */
const fixtureBody = (n: number, tag = 'LEN') => `FIXTURE-CONTRACT-${tag}-`.padEnd(n, 'x');

describe('answers are 1–500 characters for a free couple (BE-05, D11; BE-41/D46)', () => {
  it('500 is accepted, 501 is ANSWER_TOO_LONG {max:500}, empty stays 23514; threads stay at 2000', async () => {
    must(await upsertAnswer('maya', 'x'.repeat(500)), '500');
    expectTooLong(await upsertAnswer('maya', 'x'.repeat(501)), 500);
    expect((await upsertAnswer('maya', '')).error?.code).toBe('23514');
    const stored = must(
      await as('maya')
        .from('answers')
        .select('body')
        .eq('couple_question_id', cqId)
        .eq('user_id', ID.maya),
      'stored',
    );
    expect(stored[0].body).toHaveLength(500);
    must(await upsertAnswer('maya', 'FIXTURE-CONTRACT-MAYA-2'), 'restore');
    const msg = (body: string) =>
      as('sam')
        .from('thread_messages')
        .insert({ client_id: randomUUID(), couple_question_id: cqId, user_id: ID.sam, body });
    ok(await msg('y'.repeat(2000)), '2000-character message');
    expect((await msg('y'.repeat(2001))).error?.code).toBe('23514');
  });
});

describe('answer length follows Premium at write time; a lapse keeps long answers (BE-41, D46)', () => {
  const entitle = async (who: 'maya' | 'sam', row: { is_active: boolean; expires_at: string | null }) =>
    ok(await admin.from('entitlements').upsert({ user_id: ID[who], ...row }), `entitle ${who}`);
  const noEntitlements = async () =>
    ok(
      await admin.from('entitlements').delete().in('user_id', [ID.maya, ID.sam]),
      'drop entitlements',
    );
  const myBody = async (who: 'maya' | 'sam', owner: 'maya' | 'sam') =>
    must(
      await as(who)
        .from('answers')
        .select('body')
        .eq('couple_question_id', cqId)
        .eq('user_id', ID[owner]),
      `${who} reads ${owner}`,
    )[0]?.body;

  afterAll(async () => {
    await noEntitlements();
    must(await upsertAnswer('maya', 'FIXTURE-CONTRACT-MAYA-2'), 'restore');
  });

  it('a Premium couple (the partner holds the entitlement) writes 2000; 2001 is ANSWER_TOO_LONG {max:2000}', async () => {
    await entitle('sam', { is_active: true, expires_at: null });
    must(await upsertAnswer('maya', fixtureBody(2000)), '2000');
    expect(await myBody('maya', 'maya')).toHaveLength(2000);
    expectTooLong(await upsertAnswer('maya', fixtureBody(2001)), 2000);
    expect(await myBody('maya', 'maya')).toHaveLength(2000);
    expect((await upsertAnswer('maya', '')).error?.code).toBe('23514');
  });

  it('an inactive or expired entitlement is not Premium: 501 is {max:500}', async () => {
    await entitle('sam', { is_active: false, expires_at: null });
    expectTooLong(await upsertAnswer('maya', fixtureBody(501)), 500);
    await entitle('sam', { is_active: true, expires_at: '2020-01-01T00:00:00Z' });
    expectTooLong(await upsertAnswer('maya', fixtureBody(501)), 500);
  });

  it('after a lapse an 1800-character answer stays readable; unchanged re-sends pass; edits only down to 500', async () => {
    await entitle('maya', { is_active: true, expires_at: null });
    await entitle('sam', { is_active: false, expires_at: null });
    const long = fixtureBody(1800, 'LAPSE');
    must(await upsertAnswer('maya', long), '1800 while Premium');
    // Lapse: Maya's entitlement expires.
    await entitle('maya', { is_active: true, expires_at: '2020-01-01T00:00:00Z' });
    expect(await myBody('maya', 'maya')).toBe(long);
    expect(await myBody('sam', 'maya')).toBe(long); // revealed: the partner still reads it
    // Retry / offline queue re-sends the stored text: upsert and plain update both pass.
    must(await upsertAnswer('maya', long), 'unchanged upsert');
    ok(
      await as('maya')
        .from('answers')
        .update({ body: long })
        .eq('couple_question_id', cqId)
        .eq('user_id', ID.maya),
      'unchanged update',
    );
    // An update that does not touch body passes.
    ok(
      await as('maya')
        .from('answers')
        .update({ client_written_at: new Date().toISOString() })
        .eq('couple_question_id', cqId)
        .eq('user_id', ID.maya),
      'client_written_at only',
    );
    expect(await myBody('maya', 'maya')).toBe(long);
    // A changed text over 500 is refused (also shorter than the stored 1800), the row is kept.
    expectTooLong(await upsertAnswer('maya', fixtureBody(1799, 'LAPSE')), 500);
    expectTooLong(await upsertAnswer('maya', fixtureBody(501, 'LAPSE')), 500);
    expect(await myBody('maya', 'maya')).toBe(long);
    // Editing down to 500 works; after that 501 is refused like any free answer.
    must(await upsertAnswer('maya', fixtureBody(500, 'LAPSE')), 'edit down to 500');
    expect(await myBody('maya', 'maya')).toHaveLength(500);
    expect(await myBody('sam', 'maya')).toHaveLength(500);
    expectTooLong(await upsertAnswer('maya', long), 500);
  });

  it('the outsider gets RLS 42501, never ANSWER_TOO_LONG (no hint of the couple Premium state)', async () => {
    for (const premium of [false, true]) {
      await noEntitlements();
      if (premium) await entitle('sam', { is_active: true, expires_at: null });
      const res = await upsertAnswer('eve', fixtureBody(600, 'EVE'));
      expect(res.error?.code, `premium=${premium}`).toBe('42501');
    }
  });

  it('pack-question answers follow the same rule (same table)', async () => {
    const q = (await ensureContent()).premiumFirst;
    const cq = await preStartedPackRow(couple, q);
    const packAnswer = (body: string) =>
      as('maya')
        .from('answers')
        .upsert(
          { couple_question_id: cq.id, user_id: ID.maya, body },
          { onConflict: 'couple_question_id,user_id' },
        )
        .select('id');
    try {
      await noEntitlements();
      expectTooLong(await packAnswer(fixtureBody(501, 'PACK')), 500);
      await entitle('maya', { is_active: true, expires_at: null });
      must(await packAnswer(fixtureBody(2000, 'PACK')), 'pack 2000');
      expectTooLong(await packAnswer(fixtureBody(2001, 'PACK')), 2000);
    } finally {
      ok(await admin.from('couple_questions').delete().eq('id', cq.id), 'drop pack row');
    }
  });
});

describe('reactions are one system emoji (BE-40, D45; was BE-05/D14 kinds)', () => {
  const react = (who: 'maya' | 'sam' | 'eve', answerId: string, kind: string) =>
    as(who)
      .from('reactions')
      .upsert({ user_id: ID[who], answer_id: answerId, kind }, { onConflict: 'answer_id,user_id' })
      .select('answer_id, user_id, kind');

  const samAnswerId = async () =>
    must(
      await as('maya')
        .from('answers')
        .select('id')
        .eq('couple_question_id', cqId)
        .eq('user_id', ID.sam),
      'sam answer',
    )[0].id;

  const mine = async (answerId: string) =>
    must(
      await as('maya')
        .from('reactions')
        .select('kind')
        .eq('answer_id', answerId)
        .eq('user_id', ID.maya),
      'my reaction',
    );

  const removeMine = async (answerId: string) =>
    must(
      await as('maya')
        .from('reactions')
        .delete()
        .eq('answer_id', answerId)
        .eq('user_id', ID.maya)
        .select('id'),
      'remove mine',
    );

  // Valid: what a phone's emoji keyboard can send as one character (CONTRACTS §2 React row).
  const VALID: [string, string][] = [
    ['❤️', 'red heart (U+2764 U+FE0F)'],
    ['😂', 'single SMP emoji'],
    ['😮', 'single SMP emoji'],
    ['🔥', 'single SMP emoji'],
    ['☺️', 'BMP emoji with VS16'],
    ['👍🏽', 'skin tone modifier'],
    ['🇯🇵', 'flag (two regional indicators)'],
    ['1️⃣', 'keycap'],
    ['🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'tag flag (Scotland)'],
    ['🏳️‍🌈', 'ZWJ sequence with VS16'],
    ['👩‍❤️‍👨', 'ZWJ couple'],
    ['👨‍👩‍👧‍👦', 'ZWJ family (4 parts)'],
    ['🧑🏽‍🤝‍🧑🏻', 'ZWJ with two skin tones'],
  ];
  // Invalid: text, the old kind words, two emoji, empty, presentation and joiner tricks.
  const INVALID: [string, string][] = [
    ['love', 'old D14 kind word'],
    ['spark', 'old D14 kind word'],
    ['hi', 'text'],
    ['a', 'one letter'],
    ['1', 'digit without keycap'],
    ['', 'empty'],
    [' ', 'space'],
    ['❤️❤️', 'two emoji'],
    ['😂👍', 'two different emoji'],
    ['😂 ', 'emoji plus a space'],
    ['❤︎', 'text presentation (U+FE0E)'],
    ['‍', 'lone joiner'],
    ['😂‍', 'trailing joiner'],
    ['🏽', 'lone skin tone'],
    ['🇯', 'lone regional indicator'],
    ['👍🏽🏽', 'two skin tones'],
    ['👨‍👩‍👧‍👦‍👦‍👦', 'ZWJ sequence of 6 parts'],
    ['<b>', 'markup'],
  ];

  it('a partner who answered reacts to the other answer; another emoji replaces it (one row)', async () => {
    const answerId = await samAnswerId();
    expect(must(await react('maya', answerId, '❤️'), '❤️')).toEqual([
      { answer_id: answerId, user_id: ID.maya, kind: '❤️' },
    ]);
    expect(must(await react('maya', answerId, '😂'), '😂')).toHaveLength(1);
    const seen = must(
      await as('sam').from('reactions').select('user_id, kind').eq('answer_id', answerId),
      'sam reads',
    );
    expect(seen).toEqual([{ user_id: ID.maya, kind: '😂' }]);
  });

  it('the same emoji again is a remove: the app deletes its own row (no toggle in the DB)', async () => {
    const answerId = await samAnswerId();
    must(await react('maya', answerId, '🔥'), 'react');
    // Upserting the same emoji is idempotent: still one row, still 🔥.
    must(await react('maya', answerId, '🔥'), 'same again');
    expect(await mine(answerId)).toEqual([{ kind: '🔥' }]);
    expect(await removeMine(answerId)).toHaveLength(1);
    expect(await mine(answerId)).toEqual([]);
  });

  it.each(VALID)('accepts %s (%s) and stores it exactly', async (emoji) => {
    const answerId = await samAnswerId();
    expect(must(await react('maya', answerId, emoji), emoji)[0].kind).toBe(emoji);
    expect(await mine(answerId)).toEqual([{ kind: emoji }]);
  });

  it.each(INVALID)('rejects %j (%s) with INVALID_REACTION, on insert and on update', async (bad) => {
    const answerId = await samAnswerId();
    await removeMine(answerId);
    expectCode(await react('maya', answerId, bad), 'INVALID_REACTION');
    expect(await mine(answerId)).toEqual([]);
    must(await react('maya', answerId, '😮'), 'valid first');
    expectCode(
      await as('maya')
        .from('reactions')
        .update({ kind: bad })
        .eq('answer_id', answerId)
        .eq('user_id', ID.maya)
        .select('kind'),
      'INVALID_REACTION',
    );
    expect(await mine(answerId)).toEqual([{ kind: '😮' }]);
  });

  it('a bare ❤ (U+2764) is stored as ❤️ (U+2764 U+FE0F), on insert and on update', async () => {
    const answerId = await samAnswerId();
    await removeMine(answerId);
    expect(must(await react('maya', answerId, '❤'), 'bare')[0].kind).toBe('❤️');
    must(await react('maya', answerId, '😂'), 'other');
    const updated = must(
      await as('maya')
        .from('reactions')
        .update({ kind: '❤' })
        .eq('answer_id', answerId)
        .eq('user_id', ID.maya)
        .select('kind'),
      'update to bare',
    );
    expect(updated).toEqual([{ kind: '❤️' }]);
  });

  it('the old kind enum and the emoji column are gone', async () => {
    const answerId = await samAnswerId();
    const legacy = await as('maya')
      .from('reactions')
      .insert({ user_id: ID.maya, answer_id: answerId, emoji: '❤️' } as never);
    expect(legacy.error).not.toBeNull();
    must(await react('maya', answerId, '❤️'), 'react');
    const row = must(await as('maya').from('reactions').select('*').limit(1), 'cols')[0];
    expect(row).not.toHaveProperty('emoji');
    expect(typeof row.kind).toBe('string');
  });

  it('a reaction on a thread message uses onConflict message_id,user_id, same emoji rule', async () => {
    const messageId = must(
      await as('maya').from('thread_messages').select('id').eq('couple_question_id', cqId).limit(1),
      'message',
    )[0].id;
    const upsert = (kind: string) =>
      as('maya')
        .from('reactions')
        .upsert(
          { user_id: ID.maya, message_id: messageId, kind },
          { onConflict: 'message_id,user_id' },
        )
        .select('kind');
    expect(must(await upsert('😂'), '😂')).toEqual([{ kind: '😂' }]);
    expect(must(await upsert('🔥'), '🔥')).toEqual([{ kind: '🔥' }]);
    expectCode(await upsert('laugh'), 'INVALID_REACTION');
    const rows = must(
      await as('maya').from('reactions').select('kind').eq('message_id', messageId),
      'rows',
    );
    expect(rows).toEqual([{ kind: '🔥' }]);
  });

  it('nobody reacts as their partner; the outsider neither reacts nor reads', async () => {
    const answerId = await samAnswerId();
    const forged = await as('maya')
      .from('reactions')
      .insert({ user_id: ID.sam, answer_id: answerId, kind: '❤️' });
    expect(forged.error?.code).toBe('42501');
    expect((await react('eve', answerId, '❤️')).error?.code).toBe('42501');
    expect(
      must(await as('eve').from('reactions').select('id').eq('answer_id', answerId), 'eve reads'),
    ).toEqual([]);
    expect(must(await anon.from('reactions').select('id'), 'anon')).toEqual([]);
  });

  it('the reveal rule holds: no reaction to an answer I cannot see yet', async () => {
    // D51: a free couple cannot start a pack question; use a pre-started (D43-era) row.
    const cq = await preStartedPackRow(couple, (await ensureContent()).free);
    ok(
      await as('maya')
        .from('answers')
        .upsert(
          { couple_question_id: cq.id, user_id: ID.maya, body: 'FIXTURE-CONTRACT-PACK' },
          { onConflict: 'couple_question_id,user_id' },
        ),
      'maya answers',
    );
    const mayaAnswer = must(
      await admin
        .from('answers')
        .select('id')
        .eq('couple_question_id', cq.id)
        .eq('user_id', ID.maya),
      'maya answer id',
    )[0].id;
    // Sam has not answered this question, so he may not react to Maya's answer.
    expect((await react('sam', mayaAnswer, '❤️')).error?.code).toBe('42501');
  });

  it("I can remove my own reaction, not my partner's", async () => {
    const answerId = await samAnswerId();
    must(await react('maya', answerId, '❤️'), 'react');
    const other = must(
      await as('sam')
        .from('reactions')
        .delete()
        .eq('answer_id', answerId)
        .eq('user_id', ID.maya)
        .select('id'),
      'sam deletes',
    );
    expect(other).toEqual([]);
    expect(await removeMine(answerId)).toHaveLength(1);
  });

  it('Hearts given: awarded once at 25 held ❤️ (❤ counts, 😂 does not, re-adding does not inflate, never revoked)', async () => {
    const badge = must(
      await as('maya').from('badges').select('slug, threshold, owner').eq('slug', 'hearts-given'),
      'catalogue',
    );
    expect(badge).toEqual([{ slug: 'hearts-given', threshold: 25, owner: 'personal' }]);
    // A clean slate for Maya: no reactions, no award (setup only, service role).
    ok(await admin.from('reactions').delete().eq('user_id', ID.maya), 'clear reactions');
    ok(
      await admin.from('badge_awards').delete().eq('user_id', ID.maya).eq('badge_slug', 'hearts-given'),
      'clear award',
    );
    const messages = must(
      await as('sam')
        .from('thread_messages')
        .insert(
          Array.from({ length: 25 }, (_, i) => ({
            client_id: randomUUID(),
            couple_question_id: cqId,
            user_id: ID.sam,
            body: `FIXTURE-CONTRACT-HEART-${i}`,
          })),
        )
        .select('id'),
      'sam writes 25 messages',
    ).map((m) => m.id);
    const heart = (messageId: string, kind: string) =>
      as('maya')
        .from('reactions')
        .upsert({ user_id: ID.maya, message_id: messageId, kind }, { onConflict: 'message_id,user_id' });
    const award = async () =>
      must(
        await as('maya')
          .from('badge_awards')
          .select('badge_slug, user_id, couple_id')
          .eq('badge_slug', 'hearts-given'),
        'award',
      );

    // 24 hearts (half of them bare ❤) and one 😂: not yet.
    for (const [i, id] of messages.slice(0, 24).entries()) ok(await heart(id, i % 2 ? '❤' : '❤️'), `heart ${i}`);
    ok(await heart(messages[24]!, '😂'), 'laugh');
    expect(await award()).toEqual([]);
    // Removing and re-adding a heart keeps the count at 24.
    for (let n = 0; n < 3; n++) {
      ok(await as('maya').from('reactions').delete().eq('message_id', messages[0]!).eq('user_id', ID.maya), 'rm');
      ok(await heart(messages[0]!, '❤️'), 're-add');
    }
    expect(await award()).toEqual([]);
    // The 25th: changing 😂 to ❤️ (an update of kind) crosses the threshold.
    ok(await heart(messages[24]!, '❤️'), '25th');
    expect(await award()).toEqual([{ badge_slug: 'hearts-given', user_id: ID.maya, couple_id: null }]);
    // Once only, and never taken back when a heart goes.
    ok(await as('maya').from('reactions').delete().eq('message_id', messages[1]!).eq('user_id', ID.maya), 'rm');
    ok(await heart(messages[1]!, '❤️'), 're-add');
    ok(await as('maya').from('reactions').delete().eq('message_id', messages[2]!).eq('user_id', ID.maya), 'rm');
    expect(await award()).toHaveLength(1);
    // The partner's reactions are not mine: Sam got no award from Maya's hearts.
    expect(
      must(
        await admin.from('badge_awards').select('id').eq('user_id', ID.sam).eq('badge_slug', 'hearts-given'),
        'sam award',
      ),
    ).toEqual([]);
    // Leave no stray hearts for later files (setup only).
    ok(await admin.from('reactions').delete().eq('user_id', ID.maya), 'cleanup');
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
