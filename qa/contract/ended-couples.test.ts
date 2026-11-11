// QA-03e: BE-09 ended couples (D08, D09; CONTRACTS §2 `unpair`, Couple row). unpair() ends the
// couple instead of deleting it: `couples.status = 'ended'`, `ended_at` and both `left_at` are
// server-set. Both former members keep a read-only archive (couple, members, key dates, questions,
// answers, threads, reactions, streak, partner profile) for 30 days; nobody can write to it; each
// can pair again at once; the archive is purged after 30 days. Bodies are FIXTURE- text.
//
// Time: the 30-day window is computed from now() in the read policies, so these tests move the
// archive into the past (backdate `ended_at` / `left_at` over direct SQL) instead of waiting.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { applyScenario } from '../scripts/seed-scenario';
import {
  ID,
  admin,
  anon,
  as,
  createInvite,
  ensureContent,
  expectCode,
  loose,
  must,
  ok,
  pair,
  resetWorld,
  sql,
} from './helpers';
import type { PersonaName } from './personas';

let Q: Awaited<ReturnType<typeof ensureContent>>;

beforeAll(async () => {
  Q = await ensureContent();
});

type Archive = {
  couple: string;
  cq: string;
  answers: { maya: string; sam: string };
  message: string;
  reaction: string;
};

/**
 * Maya and Sam pair, both answer the daily question, Maya posts in the thread, Sam reacts to
 * Maya's answer and they add a key date. Then `who` unpairs. Returns the ids of the archive.
 */
async function endedArchive(who: PersonaName = 'maya'): Promise<Archive> {
  await resetWorld();
  const couple = await pair('maya', 'sam');
  const cq = must(await as('maya').rpc('get_daily_question'), 'daily').id;
  const answer = async (p: 'maya' | 'sam') =>
    must(
      await as(p)
        .from('answers')
        .insert({ couple_question_id: cq, user_id: ID[p], body: `FIXTURE-CONTRACT-ENDED-${p}` })
        .select('id')
        .single(),
      `${p} answers`,
    ).id;
  const answers = { maya: await answer('maya'), sam: await answer('sam') };
  const message = must(
    await as('maya')
      .from('thread_messages')
      .insert({
        client_id: randomUUID(),
        couple_question_id: cq,
        user_id: ID.maya,
        body: 'FIXTURE-CONTRACT-ENDED-THREAD',
      })
      .select('id')
      .single(),
    'thread',
  ).id;
  const reaction = must(
    await as('sam')
      .from('reactions')
      .insert({ user_id: ID.sam, answer_id: answers.maya, kind: '❤️' })
      .select('id')
      .single(),
    'react',
  ).id;
  ok(
    await as('maya')
      .from('key_dates')
      .upsert(
        { couple_id: couple, kind: 'together_since', user_id: null, date: '2024-05-01' },
        { onConflict: 'couple_id,kind,user_id' },
      ),
    'key date',
  );
  ok(await as(who).rpc('unpair'), `${who} unpair`);
  return { couple, cq, answers, message, reaction };
}

/** What a persona can read of the archive, table by table (row counts). */
async function visible(who: PersonaName, a: Archive) {
  const db = as(who);
  const n = async (p: PromiseLike<{ data: unknown[] | null; error: unknown }>, what: string) =>
    must((await p) as never, `${who} ${what}`) as unknown[];
  return {
    couple: (await n(db.from('couples').select('id').eq('id', a.couple), 'couple')).length,
    members: (
      await n(db.from('couple_members').select('user_id').eq('couple_id', a.couple), 'members')
    ).length,
    keyDates: (await n(db.from('key_dates').select('id').eq('couple_id', a.couple), 'dates'))
      .length,
    questions: (await n(db.from('couple_questions').select('id').eq('couple_id', a.couple), 'cq'))
      .length,
    answers: (await n(db.from('answers').select('id').eq('couple_question_id', a.cq), 'answers'))
      .length,
    messages: (
      await n(db.from('thread_messages').select('id').eq('couple_question_id', a.cq), 'thread')
    ).length,
    reactions: (await n(db.from('reactions').select('id').eq('id', a.reaction), 'reactions'))
      .length,
    streak: (await n(db.from('couple_streaks').select('couple_id').eq('couple_id', a.couple), 's'))
      .length,
  };
}

const FULL = {
  couple: 1,
  members: 2,
  keyDates: 1,
  questions: 1,
  answers: 2,
  messages: 1,
  reactions: 1,
  streak: 1,
};
const NOTHING = {
  couple: 0,
  members: 0,
  keyDates: 0,
  questions: 0,
  answers: 0,
  messages: 0,
  reactions: 0,
  streak: 0,
};

/** Moves the archive `age` into the past (ended_at and both left_at). */
const backdate = (a: Archive, age: string) =>
  sql(
    `with c as (update couples set ended_at = now() - $2::interval where id = $1 returning id)
     update couple_members set left_at = now() - $2::interval where couple_id in (select id from c)`,
    [a.couple, age],
  );

/** RLS rejected a write: PostgREST 42501 ("new row violates row-level security policy"). */
const expectRlsDenied = (res: { error: { code: string } | null }, what: string) => {
  expect(res.error, `${what}: expected an RLS error`).not.toBeNull();
  expect(res.error!.code, what).toBe('42501');
};

describe('unpair ends the couple (D08)', () => {
  let a: Archive;
  beforeAll(async () => {
    a = await endedArchive('maya');
  });

  it('the couple is ended, not deleted: status, ended_at and both left_at are set', async () => {
    const rows = await sql<{ status: string; ended: boolean; left: number; total: number }>(
      `select c.status, c.ended_at is not null and c.ended_at > now() - interval '5 minutes' ended,
              count(m.left_at)::int "left", count(*)::int total
         from couples c join couple_members m on m.couple_id = c.id
        where c.id = $1 group by c.id`,
      [a.couple],
    );
    expect(rows).toEqual([{ status: 'ended', ended: true, left: 2, total: 2 }]);
    // left_at equals ended_at: one end time for both.
    const same = await sql<{ n: number }>(
      `select count(*)::int n from couple_members m join couples c on c.id = m.couple_id
        where c.id = $1 and m.left_at = c.ended_at`,
      [a.couple],
    );
    expect(same[0].n).toBe(2);
  });

  it('a retry gets NOT_PAIRED for both (treat as done), and nothing changes', async () => {
    const before = await sql(`select ended_at from couples where id = $1`, [a.couple]);
    expectCode(await as('maya').rpc('unpair'), 'NOT_PAIRED');
    expectCode(await as('sam').rpc('unpair'), 'NOT_PAIRED');
    expect(await sql(`select ended_at from couples where id = $1`, [a.couple])).toEqual(before);
  });

  it('as the app reads it: no active couple, the ended one via status=ended (CONTRACTS Couple row)', async () => {
    for (const who of ['maya', 'sam'] as const) {
      const active = await as(who)
        .from('couples')
        .select('*, couple_members(user_id, left_at)')
        .eq('status', 'active')
        .maybeSingle();
      ok(active, `${who} active`);
      expect(active.data).toBeNull();
      const ended = must(
        await as(who)
          .from('couples')
          .select('id, status, ended_at, couple_members(user_id, left_at)')
          .eq('status', 'ended')
          .maybeSingle(),
        `${who} ended`,
      );
      expect(ended).toMatchObject({ id: a.couple, status: 'ended' });
      expect(ended.ended_at).not.toBeNull();
      expect(ended.couple_members.map((m) => m.user_id).sort()).toEqual([ID.maya, ID.sam].sort());
      expect(ended.couple_members.every((m) => m.left_at !== null)).toBe(true);
    }
  });

  it('the RPCs that need a couple get NOT_PAIRED for both former members', async () => {
    for (const who of ['maya', 'sam'] as const) {
      expectCode(await as(who).rpc('get_daily_question'), 'NOT_PAIRED');
      expectCode(await as(who).rpc('create_invite'), 'NOT_PAIRED');
      expectCode(await as(who).rpc('start_pack_question', { p_question: Q.free }), 'NOT_PAIRED');
    }
  });

  it('the partner can unpair too: Sam ends it, Maya then gets NOT_PAIRED', async () => {
    const b = await endedArchive('sam');
    expectCode(await as('maya').rpc('unpair'), 'NOT_PAIRED');
    expect(await sql(`select status from couples where id = $1`, [b.couple])).toEqual([
      { status: 'ended' },
    ]);
  });

  it('both call unpair at once: one ends it, the other gets NOT_PAIRED', async () => {
    await resetWorld();
    const couple = await pair('maya', 'sam');
    const res = await Promise.all([as('maya').rpc('unpair'), as('sam').rpc('unpair')]);
    const errors = res.map((r) => r.error?.message ?? null).sort();
    expect(errors).toEqual(['NOT_PAIRED', null].sort());
    expect(await sql(`select status from couples where id = $1`, [couple])).toEqual([
      { status: 'ended' },
    ]);
  });
});

describe('the ended couple is a read-only archive for both former members (D08)', () => {
  let a: Archive;
  beforeAll(async () => {
    a = await endedArchive('maya');
  });

  it('both read couple, members, key dates, questions, answers, thread, reactions and streak', async () => {
    expect(await visible('maya', a)).toEqual(FULL);
    expect(await visible('sam', a)).toEqual(FULL);
  });

  it('the answers and thread are the same text as before the unpair', async () => {
    const rows = must(
      await as('sam')
        .from('couple_questions')
        .select('id, answers(user_id, body)')
        .eq('id', a.cq)
        .single(),
      'detail',
    );
    expect(rows.answers.map((x) => x.body).sort()).toEqual([
      'FIXTURE-CONTRACT-ENDED-maya',
      'FIXTURE-CONTRACT-ENDED-sam',
    ]);
    const thread = must(
      await as('sam').from('thread_messages').select('body').eq('couple_question_id', a.cq),
      'thread',
    );
    expect(thread).toEqual([{ body: 'FIXTURE-CONTRACT-ENDED-THREAD' }]);
  });

  it("each still reads the former partner's profile", async () => {
    const ids = must(await as('maya').from('profiles').select('id'), 'profiles').map((p) => p.id);
    expect(ids.sort()).toEqual([ID.maya, ID.sam].sort());
  });

  it('the outsider and anon read nothing of it', async () => {
    expect(await visible('eve', a)).toEqual(NOTHING);
    expect(must(await as('eve').from('profiles').select('id'), 'eve').map((p) => p.id)).toEqual([
      ID.eve,
    ]);
    const res = await anon.from('couples').select('id').eq('id', a.couple);
    expect(res.data ?? []).toEqual([]);
  });

  it('nobody can answer or edit an answer (upsert as the app does: 42501)', async () => {
    for (const who of ['maya', 'sam'] as const) {
      expectRlsDenied(
        await as(who)
          .from('answers')
          .upsert(
            { couple_question_id: a.cq, user_id: ID[who], body: 'FIXTURE-CONTRACT-ENDED-LATE' },
            { onConflict: 'couple_question_id,user_id' },
          ),
        `${who} upsert answer`,
      );
      const edit = must(
        await as(who)
          .from('answers')
          .update({ body: 'FIXTURE-CONTRACT-ENDED-LATE' })
          .eq('id', a.answers[who])
          .select('id'),
        `${who} edit answer`,
      );
      expect(edit).toEqual([]);
    }
    const bodies = await sql<{ body: string }>(
      `select body from answers where couple_question_id = $1 order by body`,
      [a.cq],
    );
    expect(bodies.map((b) => b.body)).toEqual([
      'FIXTURE-CONTRACT-ENDED-maya',
      'FIXTURE-CONTRACT-ENDED-sam',
    ]);
  });

  it('nobody can post to or edit the thread', async () => {
    for (const who of ['maya', 'sam'] as const) {
      expectRlsDenied(
        await as(who).from('thread_messages').insert({
          client_id: randomUUID(),
          couple_question_id: a.cq,
          user_id: ID[who],
          body: 'FIXTURE-CONTRACT-ENDED-LATE',
        }),
        `${who} post`,
      );
    }
    const edit = must(
      await as('maya')
        .from('thread_messages')
        .update({ body: 'FIXTURE-CONTRACT-ENDED-LATE' })
        .eq('id', a.message)
        .select('id'),
      'edit message',
    );
    expect(edit).toEqual([]);
    expect(await sql(`select body from thread_messages where id = $1`, [a.message])).toEqual([
      { body: 'FIXTURE-CONTRACT-ENDED-THREAD' },
    ]);
  });

  it('nobody can react, change or remove a reaction', async () => {
    expectRlsDenied(
      await as('maya')
        .from('reactions')
        .upsert(
          { user_id: ID.maya, answer_id: a.answers.sam, kind: '🔥' },
          { onConflict: 'answer_id,user_id' },
        ),
      'maya react to answer',
    );
    expectRlsDenied(
      await as('sam')
        .from('reactions')
        .upsert(
          { user_id: ID.sam, message_id: a.message, kind: '😂' },
          { onConflict: 'message_id,user_id' },
        ),
      'sam react to message',
    );
    // Sam's existing reaction: re-react (upsert = change kind) and remove are both refused.
    expectRlsDenied(
      await as('sam')
        .from('reactions')
        .upsert(
          { user_id: ID.sam, answer_id: a.answers.maya, kind: '😮' },
          { onConflict: 'answer_id,user_id' },
        ),
      'sam change reaction',
    );
    expect(
      must(await as('sam').from('reactions').delete().eq('id', a.reaction).select('id'), 'rm'),
    ).toEqual([]);
    expect(await sql(`select kind from reactions where id = $1`, [a.reaction])).toEqual([
      { kind: '❤️' },
    ]);
  });

  it('nobody can write read markers, key dates or couple settings', async () => {
    expectRlsDenied(
      await as('maya')
        .from('thread_reads')
        .upsert(
          { couple_question_id: a.cq, user_id: ID.maya, last_read_at: new Date().toISOString() },
          { onConflict: 'couple_question_id,user_id' },
        ),
      'read marker',
    );
    expectRlsDenied(
      await as('maya')
        .from('key_dates')
        .upsert(
          { couple_id: a.couple, kind: 'anniversary', user_id: null, date: '2025-06-01' },
          { onConflict: 'couple_id,kind,user_id' },
        ),
      'key date',
    );
    const settings = must(
      await as('sam')
        .from('couples')
        .update({ partner_name: 'Changed' })
        .eq('id', a.couple)
        .select('id'),
      'settings',
    );
    expect(settings).toEqual([]);
    expect(await sql(`select partner_name from couples where id = $1`, [a.couple])).not.toEqual([
      { partner_name: 'Changed' },
    ]);
    expect(
      await sql(`select count(*)::int n from key_dates where couple_id = $1`, [a.couple]),
    ).toEqual([{ n: 1 }]);
  });

  it('the new private helpers are not reachable through the API', async () => {
    const calls: Array<[string, Record<string, string>]> = [
      ['can_read_couple', { p_couple: a.couple }],
      ['is_active_cq_member', { p_cq: a.cq }],
      ['can_read_profile', { p_profile: ID.sam }],
      ['purge_ended_couples', {}],
    ];
    for (const [fn, args] of calls) {
      for (const [who, db] of Object.entries({ maya: as('maya'), anon, admin })) {
        const res = await loose(db).rpc(fn, args);
        expect(res.error?.code, `${fn} as ${who}`).toBe('PGRST202');
      }
    }
    expect(await sql(`select status from couples where id = $1`, [a.couple])).toEqual([
      { status: 'ended' },
    ]);
  });
});

describe('both former members can pair again at once (D08)', () => {
  let a: Archive;
  beforeEach(async () => {
    a = await endedArchive('maya');
  });

  it('each creates a new couple; new partners do not see the archive; the archive stays readable', async () => {
    const mayaNew = await pair('maya', 'finn');
    const samNew = await pair('sam', 'lea');
    expect(new Set([mayaNew, samNew, a.couple]).size).toBe(3);

    const active = (who: PersonaName) =>
      as(who).from('couples').select('id').eq('status', 'active').maybeSingle();
    expect(must(await active('maya'), 'maya').id).toBe(mayaNew);
    expect(must(await active('sam'), 'sam').id).toBe(samNew);
    // The daily loop works in the new couple.
    expect(must(await as('maya').rpc('get_daily_question'), 'daily').couple_id).toBe(mayaNew);

    expect(await visible('maya', a)).toEqual(FULL);
    expect(await visible('sam', a)).toEqual(FULL);
    expect(await visible('finn', a)).toEqual(NOTHING);
    expect(await visible('lea', a)).toEqual(NOTHING);
    // Finn reads Maya (his partner), not Sam (her former partner).
    const finnSees = must(await as('finn').from('profiles').select('id'), 'finn').map((p) => p.id);
    expect(finnSees.sort()).toEqual([ID.finn, ID.maya].sort());
  });

  it("the same two can pair again: Sam joins Maya's new invite from his own solo couple (D04 keeps the archive)", async () => {
    must(await as('sam').rpc('create_couple', { p_stage: 'dating' }), 'sam solo');
    const again = await pair('maya', 'sam', 'code', { archiveOwn: true }); // BE-35: D37 consent
    expect(again).not.toBe(a.couple);
    expect(await sql(`select status from couples where id = $1`, [a.couple])).toEqual([
      { status: 'ended' },
    ]);
    expect(await visible('sam', a)).toEqual(FULL);
    const members = must(
      await as('sam').from('couple_members').select('user_id, left_at').eq('couple_id', again),
      'members',
    );
    expect(members).toHaveLength(2);
    expect(members.every((m) => m.left_at === null)).toBe(true);
  });

  it("a former member's old invites cannot be used to join the ended couple", async () => {
    const code = await sql<{ n: number }>(
      `select count(*)::int n from pair_invites
        where couple_id = $1 and accepted_at is null and revoked_at is null`,
      [a.couple],
    );
    expect(code[0].n).toBe(0);
    // A new invite from Maya points at her new couple, never at the ended one.
    must(await as('maya').rpc('create_couple', { p_stage: 'dating' }), 'maya solo');
    const inv = await createInvite('maya');
    const rows = await sql<{ couple_id: string }>(
      `select couple_id from pair_invites where code = $1 and revoked_at is null`,
      [inv.code],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].couple_id).not.toBe(a.couple);
  });
});

describe('after 30 days the archive is gone (D08)', () => {
  let a: Archive;
  beforeEach(async () => {
    a = await endedArchive('maya');
  });

  it('29 days after the end: still readable by both', async () => {
    await backdate(a, '29 days 23 hours');
    expect(await visible('maya', a)).toEqual(FULL);
    expect(await visible('sam', a)).toEqual(FULL);
  });

  it('30 days and a minute after the end: neither reads anything, not even the partner profile', async () => {
    await backdate(a, '30 days 1 minute');
    expect(await visible('maya', a)).toEqual(NOTHING);
    expect(await visible('sam', a)).toEqual(NOTHING);
    expect(must(await as('maya').from('profiles').select('id'), 'p').map((p) => p.id)).toEqual([
      ID.maya,
    ]);
    // unpair stays NOT_PAIRED; a new couple still works.
    expectCode(await as('maya').rpc('unpair'), 'NOT_PAIRED');
    must(await as('maya').rpc('create_couple', { p_stage: 'dating' }), 'maya solo');
  });

  it('the purge deletes an archive older than 30 days with its history, and keeps a younger one', async () => {
    await backdate(a, '30 days 1 minute');
    const young = await (async () => {
      await pair('eve', 'finn');
      const id = must(
        await as('eve').from('couples').select('id').eq('status', 'active').single(),
        'e',
      ).id;
      ok(await as('eve').rpc('unpair'), 'eve unpair');
      return id;
    })();
    const purged = await sql<{ n: number }>(`select private.purge_ended_couples() n`);
    expect(purged[0].n).toBeGreaterThanOrEqual(1);
    const left = await sql<{ id: string }>(`select id from couples where id = any($1::uuid[])`, [
      [a.couple, young],
    ]);
    expect(left.map((r) => r.id)).toEqual([young]);
    for (const [table, col, id] of [
      ['couple_members', 'couple_id', a.couple],
      ['couple_questions', 'couple_id', a.couple],
      ['answers', 'couple_question_id', a.cq],
      ['thread_messages', 'couple_question_id', a.cq],
      ['reactions', 'id', a.reaction],
    ] as const) {
      const rows = await sql<{ n: number }>(
        `select count(*)::int n from ${table} where ${col} = $1`,
        [id],
      );
      expect(rows[0].n, table).toBe(0);
    }
  });

  it('the purge uses a pinned clock: kept at exactly 30 days, removed a second later', async () => {
    const [{ ended_at }] = await sql<{ ended_at: Date }>(
      `select ended_at from couples where id = $1`,
      [a.couple],
    );
    const at = (ms: number) => new Date(ended_at.getTime() + ms).toISOString();
    const DAY = 24 * 3600 * 1000;
    await sql(`select private.purge_ended_couples($1::timestamptz)`, [at(30 * DAY)]);
    expect(await sql(`select id from couples where id = $1`, [a.couple])).toHaveLength(1);
    await sql(`select private.purge_ended_couples($1::timestamptz)`, [at(30 * DAY + 1000)]);
    expect(await sql(`select id from couples where id = $1`, [a.couple])).toHaveLength(0);
  });

  it('the purge never touches an active couple, however old', async () => {
    await resetWorld();
    const couple = await pair('maya', 'sam');
    await sql(`update couples set created_at = now() - interval '400 days' where id = $1`, [
      couple,
    ]);
    await sql(`select private.purge_ended_couples(now() + interval '400 days')`);
    expect(await sql(`select status from couples where id = $1`, [couple])).toEqual([
      { status: 'active' },
    ]);
  });
});

// The dev seed's ended scenarios, read as the personas through the API (what screens 58 and 42
// show). scenarios.test.ts checks the rows; this checks what RLS lets each persona see.
describe('seeded ended scenarios, as the app sees them', () => {
  const client = new pg.Client({ connectionString: inject('stack').dbUrl });
  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    // Leave the stack as `supabase db reset` does (and Sam's account back after delete-account).
    await applyScenario(client, 'streak-11-both-answered');
    await client.end();
  });

  it('partner-left: Maya and Sam both read the 12 days of history; both can pair again', async () => {
    await applyScenario(client, 'partner-left');
    for (const who of ['maya', 'sam'] as const) {
      const c = must(
        await as(who).from('couples').select('id, status').eq('status', 'ended').maybeSingle(),
        `${who} couple`,
      );
      expect(c.status).toBe('ended');
      const days = must(
        await as(who).from('couple_questions').select('id').eq('couple_id', c.id),
        `${who} history`,
      );
      const [{ n }] = await sql<{ n: number }>(
        `select count(*)::int n from couple_questions where couple_id = $1`,
        [c.id],
      );
      expect(n).toBeGreaterThan(0);
      expect(days.length).toBe(n);
      expectCode(await as(who).rpc('unpair'), 'NOT_PAIRED');
    }
    must(await as('maya').rpc('create_couple', { p_stage: 'dating' }), 'maya solo');
    await createInvite('maya');
  });

  // QA-BUG-4 (issue #9), fixed in BE-16: the seed sets Maya's left_at when it ends the couple.
  it('delete-account (D09): Maya keeps reading her own answers in the ended couple and can pair again', async () => {
    await applyScenario(client, 'delete-account');
    const c = must(
      await as('maya').from('couples').select('id, status').eq('status', 'ended').maybeSingle(),
      'maya couple',
    );
    expect(c.status).toBe('ended');
    const readMine = async () =>
      must(
        await as('maya')
          .from('answers')
          .select('id, couple_questions!inner(couple_id)')
          .eq('user_id', ID.maya)
          .eq('couple_questions.couple_id', c.id),
        'maya answers',
      );
    const [{ n, open }] = await sql<{ n: number; open: number }>(
      `select count(*)::int n,
              (count(*) filter (where q.assigned_for >= (now() at time zone cp.timezone)::date - 1))::int open
         from answers a join couple_questions q on q.id = a.couple_question_id join couples cp on cp.id = q.couple_id
        where q.couple_id = $1 and a.user_id = $2`,
      [c.id, ID.maya],
    );
    expect(n).toBe(28);
    // BE-55 (D55): the archive follows the reader's own entitlement. Free: today and yesterday only;
    // with her own Premium, all 28 (nothing was deleted).
    expect((await readMine()).length).toBe(open);
    const [{ had }] = await sql<{ had: boolean }>(
      'select exists (select 1 from private.premium_history where user_id = $1) had',
      [ID.maya],
    );
    await sql(
      `insert into entitlements (user_id, is_active, expires_at) values ($1, true, '2999-01-01T00:00:00Z')`,
      [ID.maya],
    );
    try {
      expect((await readMine()).length).toBe(n);
    } finally {
      await sql('delete from entitlements where user_id = $1', [ID.maya]);
      if (!had) await sql('delete from private.premium_history where user_id = $1', [ID.maya]);
    }
    expectCode(await as('maya').rpc('unpair'), 'NOT_PAIRED');
    must(await as('maya').rpc('create_couple', { p_stage: 'dating' }), 'maya solo');
  });
});
