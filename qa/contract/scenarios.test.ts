// QA-02: the dev seed engine builds every scenario in qa/fixtures/personas.json, and the seeder
// (qa/scripts/seed-scenario.ts, `npm run qa:scenario <id>`) reports what it built.
// This is the contract between the fixtures (QA's vocabulary), supabase/seed.sql (BE-05) and the
// seeder: a scenario renamed or dropped on either side fails here. Each scenario is applied for
// real on the local stack and checked over direct SQL (the state, not the app); the app-level
// behaviour of each scenario is covered by the contract and E2E tests that start from it.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  applyScenario,
  fixtureScenarioIds,
  seededScenarioIds,
  type Summary,
} from '../scripts/seed-scenario';

const client = new pg.Client({ connectionString: inject('stack').dbUrl });
const one = async (text: string, params: unknown[] = []) =>
  (await client.query(text, params)).rows[0];

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  // Leave the stack as `supabase db reset` does, for whoever uses it next.
  await applyScenario(client, 'streak-11-both-answered');
  await client.end();
});

const couple = (s: Summary, key: string) => s.couples.find((c) => c.key === key);
const mayaSam = (s: Summary) => couple(s, 'maya_sam')!;
const entitled = async (persona: string) =>
  (
    await one(
      `select count(*)::int n from entitlements e join dev_seed.persona p on p.id = e.user_id
        where p.key = $1 and e.is_active`,
      [persona],
    )
  ).n as number;

describe('scenario ids', () => {
  it('personas.json and dev_seed.scenarios() list exactly the same scenarios', async () => {
    expect((await seededScenarioIds(client)).sort()).toEqual(fixtureScenarioIds().sort());
  });

  it('an unknown scenario is refused and names the known ones', async () => {
    await expect(applyScenario(client, 'no-such-scenario')).rejects.toThrow(
      /Known: .*fresh-install/,
    );
  });
});

describe('every scenario applies, and builds the state personas.json describes', () => {
  // The always-there cast: Lea solo, Eve and Finn as the outsider couple (not in fresh-install).
  const alwaysThere = (s: Summary) => {
    expect(couple(s, 'lea_solo')?.members).toEqual(['lea']);
    expect(couple(s, 'eve_finn')).toMatchObject({ members: ['eve', 'finn'], status: 'active' });
    expect(couple(s, 'eve_finn')!.answers).toBe(6);
    expect(couple(s, 'eve_finn')!.threadMessages).toBe(6);
  };

  it('fresh-install: Noor has no account and nobody is paired', async () => {
    const s = await applyScenario(client, 'fresh-install');
    expect(s.couples).toEqual([]);
    expect(s.personasWithoutAccount).toEqual(['noor']);
  });

  it('solo-invite-pending: Maya solo, invite 4827 open, Maya answered day 1, Sam has no account', async () => {
    const s = await applyScenario(client, 'solo-invite-pending');
    alwaysThere(s);
    expect(mayaSam(s)).toMatchObject({ members: ['maya'], activeInvite: '4827', answers: 1 });
    expect(s.personasWithoutAccount).toContain('sam');
    const inv = await one(
      `select expires_at > now() as live, expires_at - created_at = interval '48 hours' as full_span
         from pair_invites where code = '4827'`,
    );
    expect(inv).toEqual({ live: true, full_span: true }); // created 1 h ago, 47 h left
  });

  it('the dev link token for invite 4827 is dev-seed-token-4827 (hashed in the DB)', async () => {
    await applyScenario(client, 'solo-invite-pending');
    const row = await one(
      `select t.token_hash = extensions.digest('dev-seed-token-4827', 'sha256') as ok
         from private.invite_tokens t join pair_invites i on i.id = t.invite_id where i.code = '4827'`,
    );
    expect(row.ok).toBe(true);
  });

  for (const id of ['paired-day1-partner-answered', 'couple-full'] as const) {
    it(`${id}: Sam joined through 4827 (used), only Maya answered day 1`, async () => {
      const s = await applyScenario(client, id);
      alwaysThere(s);
      expect(mayaSam(s)).toMatchObject({
        members: ['maya', 'sam'],
        activeInvite: null,
        answers: 1,
      });
      const inv = await one(
        `select accepted_by is not null as used from pair_invites where code = '4827'`,
      );
      expect(inv.used).toBe(true);
    });
  }

  it('invite-expired: invite 4827 is past expires_at', async () => {
    const s = await applyScenario(client, 'invite-expired');
    expect(mayaSam(s).members).toEqual(['maya']);
    const inv = await one(
      `select expires_at < now() as expired from pair_invites where code = '4827'`,
    );
    expect(inv.expired).toBe(true);
  });

  it('invite-wrong-code: Maya solo, no invite 1111', async () => {
    const s = await applyScenario(client, 'invite-wrong-code');
    expect(mayaSam(s)).toMatchObject({ members: ['maya'], activeInvite: null });
    expect((await one(`select count(*)::int n from pair_invites where code = '1111'`)).n).toBe(0);
  });

  it('streak-11-your-turn: streak 11, Sam answered today, Maya has not', async () => {
    const s = await applyScenario(client, 'streak-11-your-turn');
    alwaysThere(s);
    expect(mayaSam(s)).toMatchObject({
      members: ['maya', 'sam'],
      streak: { current: 11, longest: 11 },
    });
    const today = await one(
      `select count(*)::int n, bool_or(p.key = 'sam') as sam, bool_or(p.key = 'maya') as maya
         from answers a join dev_seed.persona p on p.id = a.user_id
         join couple_questions q on q.id = a.couple_question_id
         join couples c on c.id = q.couple_id
        where q.couple_id = dev_seed.cid('maya_sam')
          and q.assigned_for = (now() at time zone c.timezone)::date`,
    );
    expect(today).toEqual({ n: 1, sam: true, maya: false });
  });

  it('streak-11-both-answered (the state after supabase db reset): streak 12, thread of 4, a reaction', async () => {
    const s = await applyScenario(client, 'streak-11-both-answered');
    alwaysThere(s);
    expect(mayaSam(s)).toMatchObject({
      members: ['maya', 'sam'],
      streak: { current: 12, longest: 12 },
    });
    expect(mayaSam(s).threadMessages).toBeGreaterThanOrEqual(4);
    const reactions = await one(
      `select count(*)::int n from reactions r join answers a on a.id = r.answer_id
         join couple_questions q on q.id = a.couple_question_id
        where q.couple_id = dev_seed.cid('maya_sam')`,
    );
    expect(reactions.n).toBeGreaterThanOrEqual(1);
  });

  it('streak-6-milestone: streak 6, Sam answered today', async () => {
    const s = await applyScenario(client, 'streak-6-milestone');
    expect(mayaSam(s)).toMatchObject({
      members: ['maya', 'sam'],
      streak: { current: 6, longest: 6 },
    });
  });

  it('missed-day-napping: longest 41, current 11 as of two days ago, free', async () => {
    const s = await applyScenario(client, 'missed-day-napping');
    expect(mayaSam(s).streak).toEqual({ current: 11, longest: 41 });
    expect(await entitled('maya')).toBe(0);
    const last = await one(
      `select (s.last_completed_on = (now() at time zone c.timezone)::date - 2) as two_days_ago
         from couple_streaks s join couples c on c.id = s.couple_id where c.id = dev_seed.cid('maya_sam')`,
    );
    expect(last.two_days_ago).toBe(true);
  });

  it('missed-day-premium-saver: as napping, plus Maya has an active entitlement', async () => {
    const s = await applyScenario(client, 'missed-day-premium-saver');
    expect(mayaSam(s).streak).toEqual({ current: 11, longest: 41 });
    expect(await entitled('maya')).toBe(1);
    expect(await entitled('sam')).toBe(0);
  });

  it('premium-couple: Maya entitled, Sam has no row', async () => {
    const s = await applyScenario(client, 'premium-couple');
    expect(mayaSam(s).members).toEqual(['maya', 'sam']);
    expect(await entitled('maya')).toBe(1);
    expect(await entitled('sam')).toBe(0);
  });

  it('free-couple-packs: paired, no entitlements', async () => {
    const s = await applyScenario(client, 'free-couple-packs');
    expect(mayaSam(s).members).toEqual(['maya', 'sam']);
    expect(await entitled('maya')).toBe(0);
    expect(await entitled('sam')).toBe(0);
  });

  it('empty-history: paired today, nothing answered', async () => {
    const s = await applyScenario(client, 'empty-history');
    expect(mayaSam(s)).toMatchObject({ members: ['maya', 'sam'], answers: 0, threadMessages: 0 });
  });

  it('history-month: 24 days both, 4 days one, 2 missed; 18 replies and 11 reactions', async () => {
    const s = await applyScenario(client, 'history-month');
    expect(mayaSam(s)).toMatchObject({ members: ['maya', 'sam'], answers: 52, threadMessages: 18 });
    const days = await one(
      `select count(*)::int n from couple_questions where couple_id = dev_seed.cid('maya_sam')`,
    );
    expect(days.n).toBe(28);
    const reactions = await one(
      `select count(*)::int n from reactions r where r.user_id in (select id from dev_seed.persona where key in ('maya', 'sam'))`,
    );
    expect(reactions.n).toBe(11);
  });

  // BE-09: unpair() sets left_at on both memberships (whoever called it), so both have left.
  it('partner-left: the couple is ended 2 days ago and both memberships have left', async () => {
    const s = await applyScenario(client, 'partner-left');
    expect(mayaSam(s)).toMatchObject({ members: ['maya', 'sam'], status: 'ended' });
    const left = await one(
      `select count(*)::int n, bool_and(c.ended_at < now() - interval '47 hours') as old
         from couple_members m join couples c on c.id = m.couple_id
        where m.couple_id = dev_seed.cid('maya_sam') and m.left_at is not null`,
    );
    expect(left).toEqual({ n: 2, old: true });
  });

  it('delete-account: Sam is gone with his answers; Maya keeps hers; the couple is ended', async () => {
    const s = await applyScenario(client, 'delete-account');
    expect(s.personasWithoutAccount).toContain('sam');
    expect(mayaSam(s)).toMatchObject({ members: ['maya'], status: 'ended', answers: 28 });
  });

  it('outsider-couple: Eve and Finn answered and chatted next to the Maya and Sam couple', async () => {
    const s = await applyScenario(client, 'outsider-couple');
    alwaysThere(s);
    expect(mayaSam(s).members).toEqual(['maya', 'sam']);
  });

  it('anniversary-today: together_since is two years and six months before today', async () => {
    const s = await applyScenario(client, 'anniversary-today');
    expect(mayaSam(s).members).toEqual(['maya', 'sam']);
    const k = await one(
      `select k.date = ((now() at time zone c.timezone)::date - interval '2 years 6 months')::date as ok
         from key_dates k join couples c on c.id = k.couple_id
        where k.couple_id = dev_seed.cid('maya_sam') and k.kind = 'together_since'`,
    );
    expect(k.ok).toBe(true);
  });

  it('every id in personas.json is covered by a test above', () => {
    const covered = [
      'fresh-install',
      'solo-invite-pending',
      'paired-day1-partner-answered',
      'couple-full',
      'invite-expired',
      'invite-wrong-code',
      'streak-11-your-turn',
      'streak-11-both-answered',
      'streak-6-milestone',
      'missed-day-napping',
      'missed-day-premium-saver',
      'premium-couple',
      'free-couple-packs',
      'empty-history',
      'history-month',
      'partner-left',
      'delete-account',
      'outsider-couple',
      'anniversary-today',
    ];
    expect(covered.sort()).toEqual(fixtureScenarioIds().sort());
  });
});

describe('a pinned clock', () => {
  it('--now builds the scenario relative to that moment', async () => {
    await applyScenario(client, 'solo-invite-pending', '2026-12-01T09:00:00Z');
    const inv = await one(
      `select created_at = '2026-12-01T08:00:00Z' as created, expires_at = '2026-12-03T08:00:00Z' as expires
         from pair_invites where code = '4827'`,
    );
    expect(inv).toEqual({ created: true, expires: true });
  });

  it('applying a scenario twice gives the same state (idempotent)', async () => {
    const a = await applyScenario(client, 'streak-11-your-turn', '2026-12-01T09:00:00Z');
    const b = await applyScenario(client, 'streak-11-your-turn', '2026-12-01T09:00:00Z');
    expect(b).toEqual(a);
  });
});
