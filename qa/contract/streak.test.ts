// QA-03: BE-06 streak v2 (D17, CONTRACTS §2): get_streak, answers.client_written_at and
// counts_for_streak. Time is never slept for: history is built with explicit timestamps through the
// service role (no JWT user, so the server trusts the row's own times, as the seed does), and
// get_streak is read through private.get_streak_at(now) with the clock pinned.
// Couple timezone is set to UTC so every boundary below is a plain UTC instant.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ID,
  admin,
  anon,
  as,
  callAs,
  canForgeJwt,
  ensureContent,
  expectCode,
  expectPermissionDenied,
  must,
  noSubject,
  ok,
  pair,
  loose,
  resetWorld,
  sql,
} from './helpers';
import type { PersonaName } from './personas';

type Streak = {
  current: number;
  longest: number;
  last_completed_on: string | null;
  completed_today: boolean;
  at_risk: boolean;
  saver_available: boolean;
  // BE-11 / #123 (screen 28 context): additive, nullable.
  saver_reason: 'used_this_month' | 'too_many_missed' | null;
  previous_streak: number | null;
};

/** The full get_streak key list (CONTRACTS §2). The response must not grow or shrink unnoticed. */
const STREAK_KEYS = [
  'at_risk',
  'completed_today',
  'current',
  'last_completed_on',
  'longest',
  'previous_streak',
  'saver_available',
  'saver_reason',
];

let Q: Awaited<ReturnType<typeof ensureContent>>;
let couple: string;
// Fixed days in the future of any seed history; the couple's local day is the UTC day.
const D = (n: number) => `2031-03-${String(9 + n).padStart(2, '0')}`; // D(1) = 2031-03-10
const at = (day: string, time: string) => `${day}T${time}Z`;

beforeEach(async () => {
  Q ??= await ensureContent();
  await resetWorld();
  couple = await pair('maya', 'sam');
  ok(await admin.from('couples').update({ timezone: 'UTC' }).eq('id', couple), 'couple tz');
});

/** get_streak as a persona with the clock pinned to `now`. */
async function streakAt(who: PersonaName, now: string): Promise<Streak> {
  const res = await callAs<Streak>(
    who,
    `select current, longest, last_completed_on::text as last_completed_on, completed_today,
            at_risk, saver_available, saver_reason::text as saver_reason, previous_streak
       from private.get_streak_at($1::timestamptz)`,
    [now],
  );
  if (res.raised) throw new Error(res.raised);
  return res.rows![0];
}

const QUESTION_IDS = () => [Q.daily, Q.stage, Q.loose, Q.premium, Q.free];
let nextQuestion = 0;
/** A daily couple_question for local day `day` (service role: assigned_for set explicitly). */
async function dailyFor(day: string): Promise<string> {
  const row = must(
    await admin
      .from('couple_questions')
      .insert({
        couple_id: couple,
        question_id: QUESTION_IDS()[nextQuestion++ % 5],
        source: 'daily',
        assigned_for: day,
      })
      .select('id')
      .single(),
    `daily ${day}`,
  );
  return row.id;
}

/** An answer with explicit device and arrival times (service role: both are trusted as given). */
async function answerAt(cq: string, who: PersonaName, written: string, arrived: string) {
  const row = must(
    await admin
      .from('answers')
      .insert({
        couple_question_id: cq,
        user_id: ID[who],
        body: `FIXTURE-STREAK-${who}`,
        client_written_at: written,
        created_at: arrived,
      })
      .select('counts_for_streak, client_written_at, created_at')
      .single(),
    `${who} answers`,
  );
  return row;
}

/** Both partners answer on the day itself. */
async function completeOnTime(day: string) {
  const cq = await dailyFor(day);
  await answerAt(cq, 'maya', at(day, '09:00:00'), at(day, '09:00:00'));
  await answerAt(cq, 'sam', at(day, '10:00:00'), at(day, '10:00:00'));
  return cq;
}

beforeEach(() => {
  nextQuestion = 0;
});

describe('get_streak (BE-06)', () => {
  it('returns { current, longest, last_completed_on, completed_today, at_risk, saver_available, saver_reason, previous_streak } for a couple with no history', async () => {
    const res = must(await as('maya').rpc('get_streak'), 'get_streak');
    expect(Object.keys(res).sort()).toEqual(STREAK_KEYS);
    expect(res).toEqual({
      current: 0,
      longest: 0,
      last_completed_on: null,
      at_risk: false,
      saver_available: false,
      completed_today: false,
      saver_reason: null,
      previous_streak: null,
    });
  });

  // QA-BUG-3 regression (fixed in BE-06, #34): with no completed day, last_completed_on is NULL;
  // completed_today must still be the boolean false (CONTRACTS §2), never null.
  it('completed_today is a boolean (never null) for a couple with no history (QA-BUG-3)', async () => {
    const res = must(await as('maya').rpc('get_streak'), 'get_streak');
    expect(res.completed_today).toBe(false);
  });

  it('both partners read the same streak', async () => {
    await completeOnTime(D(1));
    expect(await streakAt('maya', at(D(1), '20:00:00'))).toEqual(
      await streakAt('sam', at(D(1), '20:00:00')),
    );
  });

  it('NOT_PAIRED for an unpaired user; anon is denied; no-subject JWT is NOT_AUTHENTICATED', async () => {
    expectCode(await as('eve').rpc('get_streak'), 'NOT_PAIRED');
    expectPermissionDenied(await anon.rpc('get_streak'));
    if (canForgeJwt) expectCode(await noSubject().rpc('get_streak'), 'NOT_AUTHENTICATED');
  });

  it('consecutive completed days extend the streak; completed_today follows the couple-local date', async () => {
    for (const n of [1, 2, 3]) await completeOnTime(D(n));
    expect(await streakAt('maya', at(D(3), '20:00:00'))).toMatchObject({
      current: 3,
      longest: 3,
      last_completed_on: D(3),
      completed_today: true,
      at_risk: false,
    });
  });

  it('a streak of 3+ is at_risk until today is completed; a shorter one is not', async () => {
    for (const n of [1, 2]) await completeOnTime(D(n));
    expect(await streakAt('maya', at(D(3), '08:00:00'))).toMatchObject({
      current: 2,
      completed_today: false,
      at_risk: false,
    });
    await completeOnTime(D(3));
    expect(await streakAt('maya', at(D(4), '08:00:00'))).toMatchObject({
      current: 3,
      completed_today: false,
      at_risk: true,
    });
  });

  it('current is already 0 after a missed day (clock pinned), longest is kept', async () => {
    for (const n of [1, 2, 3]) await completeOnTime(D(n));
    // D(4) is missed. Still alive during D(4) (today can be completed), gone from the start of D(5).
    expect((await streakAt('maya', at(D(4), '23:59:59'))).current).toBe(3);
    expect(await streakAt('maya', at(D(5), '00:00:00'))).toMatchObject({
      current: 0,
      longest: 3,
      last_completed_on: D(3),
      completed_today: false,
      at_risk: false,
    });
  });

  it('the day boundary is the COUPLE timezone, not UTC', async () => {
    ok(await admin.from('couples').update({ timezone: 'Pacific/Auckland' }).eq('id', couple), 'tz');
    // 2031-03-10 is NZDT (UTC+13): local day 2031-03-11 started at 2031-03-10T11:00:00Z.
    const cq = await dailyFor('2031-03-11');
    await answerAt(cq, 'maya', '2031-03-10T12:00:00Z', '2031-03-10T12:00:00Z');
    await answerAt(cq, 'sam', '2031-03-10T13:00:00Z', '2031-03-10T13:00:00Z');
    const s = await streakAt('maya', '2031-03-10T14:00:00Z'); // 03-11 03:00 local
    expect(s).toMatchObject({ current: 1, last_completed_on: '2031-03-11', completed_today: true });
  });
});

describe('answers.client_written_at / counts_for_streak (BE-06, D17)', () => {
  const rule = async (assigned: string | null, tz: string, written: string, arrived: string) =>
    (
      await sql<{ r: boolean }>(
        'select private.answer_counts_for_day($1::date, $2, $3::timestamptz, $4::timestamptz) r',
        [assigned, tz, written, arrived],
      )
    )[0].r;

  it('written on the day and arrived before the end of the next day counts; every boundary', async () => {
    const day = D(1);
    // On the day itself.
    expect(await rule(day, 'UTC', at(day, '00:00:00'), at(day, '00:00:01'))).toBe(true);
    expect(await rule(day, 'UTC', at(day, '23:59:59'), at(day, '23:59:59'))).toBe(true);
    // Written on the day, synced the next day (offline queue): last counting instant.
    expect(await rule(day, 'UTC', at(day, '23:00:00'), at(D(2), '23:59:59'))).toBe(true);
    // ...and the first instant that is too late.
    expect(await rule(day, 'UTC', at(day, '23:00:00'), at(D(3), '00:00:00'))).toBe(false);
    // Written the day before or after the question's day: saved, doesn't count.
    expect(await rule(day, 'UTC', at(D(0), '23:59:59'), at(day, '00:00:10'))).toBe(false);
    expect(await rule(day, 'UTC', at(D(2), '00:00:00'), at(D(2), '00:00:01'))).toBe(false);
  });

  it('uses the couple timezone for both the written day and the cut-off', async () => {
    // Berlin is UTC+1 in March: 23:30Z on 03-10 is 00:30 local on 03-11.
    expect(await rule(D(1), 'Europe/Berlin', at(D(1), '23:30:00'), at(D(1), '23:31:00'))).toBe(
      false,
    );
    // Cut-off is 00:00 Berlin on 03-12 = 23:00Z on 03-11.
    expect(await rule(D(1), 'Europe/Berlin', at(D(1), '12:00:00'), at(D(2), '22:59:59'))).toBe(
      true,
    );
    expect(await rule(D(1), 'Europe/Berlin', at(D(1), '12:00:00'), at(D(2), '23:00:00'))).toBe(
      false,
    );
  });

  it('a pack question has no day: always counts (no streak effect)', async () => {
    expect(await rule(null, 'UTC', at(D(1), '00:00:00'), at(D(9), '00:00:00'))).toBe(true);
  });

  it('a late-arriving answer is stored but does not count; the streak is not extended by it', async () => {
    const cq = await dailyFor(D(1));
    const late = await answerAt(cq, 'maya', at(D(1), '09:00:00'), at(D(3), '09:00:00'));
    expect(late.counts_for_streak).toBe(false);
    const onTime = await answerAt(cq, 'sam', at(D(1), '10:00:00'), at(D(1), '10:00:00'));
    expect(onTime.counts_for_streak).toBe(true);
    // Only one answer counts: the day is not complete.
    expect(await streakAt('maya', at(D(1), '12:00:00'))).toMatchObject({
      current: 0,
      last_completed_on: null,
    });
    // Both answers are stored, and answer_count (reveal progress) counts both.
    const row = must(
      await admin.from('couple_questions').select('answer_count').eq('id', cq).single(),
      'cq',
    );
    expect(row.answer_count).toBe(2);
  });

  it('an offline answer written on day D and synced on D+1 completes day D', async () => {
    const cq = await dailyFor(D(1));
    await answerAt(cq, 'maya', at(D(1), '21:00:00'), at(D(1), '21:00:00'));
    const synced = await answerAt(cq, 'sam', at(D(1), '22:00:00'), at(D(2), '08:00:00'));
    expect(synced.counts_for_streak).toBe(true);
    expect(await streakAt('maya', at(D(2), '09:00:00'))).toMatchObject({
      current: 1,
      last_completed_on: D(1),
    });
  });

  it('a late completion that fills a gap merges the streak', async () => {
    await completeOnTime(D(1));
    await completeOnTime(D(3)); // D(2) was open; the streak restarted at 1
    expect(await streakAt('maya', at(D(3), '20:00:00'))).toMatchObject({ current: 1 });
    // D(2) answers were written on D(2) and reach the server on D(3): they count and merge 1+1+1.
    const cq = await dailyFor(D(2));
    await answerAt(cq, 'maya', at(D(2), '20:00:00'), at(D(3), '11:00:00'));
    await answerAt(cq, 'sam', at(D(2), '21:00:00'), at(D(3), '11:05:00'));
    expect(await streakAt('maya', at(D(3), '20:00:00'))).toMatchObject({
      current: 3,
      longest: 3,
      last_completed_on: D(3),
    });
  });

  it('answers that arrive too late do not merge the streak', async () => {
    await completeOnTime(D(1));
    await completeOnTime(D(3));
    const cq = await dailyFor(D(2));
    const a = await answerAt(cq, 'maya', at(D(2), '20:00:00'), at(D(4), '00:00:00'));
    const b = await answerAt(cq, 'sam', at(D(2), '21:00:00'), at(D(4), '00:00:01'));
    expect([a.counts_for_streak, b.counts_for_streak]).toEqual([false, false]);
    expect(await streakAt('maya', at(D(3), '20:00:00'))).toMatchObject({ current: 1, longest: 1 });
  });

  describe('as the app writes it (PostgREST, server clock)', () => {
    const todaysDaily = async () => must(await as('maya').rpc('get_daily_question'), 'daily').id;

    it('no client_written_at: defaults to arrival, counts, and created_at is the server time', async () => {
      const cq = await todaysDaily();
      const row = must(
        await as('sam')
          .from('answers')
          .insert({ couple_question_id: cq, user_id: ID.sam, body: 'FIXTURE-STREAK-APP' })
          .select('counts_for_streak, client_written_at, created_at')
          .single(),
        'sam answers',
      );
      expect(row.counts_for_streak).toBe(true);
      expect(Date.parse(row.client_written_at!)).toBe(Date.parse(row.created_at));
    });

    it('a device time in the future is clamped to arrival', async () => {
      const cq = await todaysDaily();
      const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
      const row = must(
        await as('sam')
          .from('answers')
          .insert({
            couple_question_id: cq,
            user_id: ID.sam,
            body: 'FIXTURE-STREAK-FUTURE',
            client_written_at: future,
          })
          .select('counts_for_streak, client_written_at, created_at')
          .single(),
        'sam answers',
      );
      expect(Date.parse(row.client_written_at!)).toBeLessThanOrEqual(Date.parse(row.created_at));
      expect(row.counts_for_streak).toBe(true);
    });

    it("a device time on another day is saved but doesn't count; the partner's on-time answer alone does not complete the day", async () => {
      const cq = await todaysDaily();
      const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
      const maya = must(
        await as('maya')
          .from('answers')
          .insert({
            couple_question_id: cq,
            user_id: ID.maya,
            body: 'FIXTURE-STREAK-OLD',
            client_written_at: old,
          })
          .select('counts_for_streak')
          .single(),
        'maya answers',
      );
      expect(maya.counts_for_streak).toBe(false);
      ok(
        await as('sam')
          .from('answers')
          .insert({ couple_question_id: cq, user_id: ID.sam, body: 'FIXTURE-STREAK-SAM' }),
        'sam answers',
      );
      const s = must(await as('maya').rpc('get_streak'), 'streak');
      expect(s.current).toBe(0);
      expect(s.completed_today ?? false).toBe(false); // null: QA-BUG-3
    });

    it('the client cannot set counts_for_streak or created_at (column grants: 42501)', async () => {
      const cq = await todaysDaily();
      const base = { couple_question_id: cq, user_id: ID.sam, body: 'FIXTURE-STREAK-FORGE' };
      const flag = await as('sam')
        .from('answers')
        .insert({ ...base, counts_for_streak: false });
      expect(flag.error?.code).toBe('42501');
      const created = await as('sam')
        .from('answers')
        .insert({ ...base, created_at: '2001-01-01T00:00:00Z' });
      expect(created.error?.code).toBe('42501');
      expect(
        must(await as('sam').from('answers').select('id').eq('couple_question_id', cq), 'sam'),
      ).toEqual([]);
    });

    it('editing an answer keeps the original device time, arrival time and flag', async () => {
      const cq = await todaysDaily();
      const first = must(
        await as('sam')
          .from('answers')
          .insert({ couple_question_id: cq, user_id: ID.sam, body: 'FIXTURE-STREAK-V1' })
          .select('counts_for_streak, client_written_at, created_at')
          .single(),
        'insert',
      );
      const edited = must(
        await as('sam')
          .from('answers')
          .update({ body: 'FIXTURE-STREAK-V2', client_written_at: '2001-01-01T00:00:00Z' })
          .eq('couple_question_id', cq)
          .eq('user_id', ID.sam)
          .select('body, counts_for_streak, client_written_at, created_at')
          .single(),
        'update',
      );
      expect(edited.body).toBe('FIXTURE-STREAK-V2');
      expect(edited).toMatchObject({
        counts_for_streak: first.counts_for_streak,
        client_written_at: first.client_written_at,
        created_at: first.created_at,
      });
    });
  });
});

// QA-17: BE-11 / #123 screen 28 context (CONTRACTS §2 "Screen 28 context"). Over the real API the
// clock is the server's, so the state is set relative to the couple's local today (UTC here):
// the streak cache, the D18 monthly ledger and entitlements through SQL/service role, then every
// read is get_streak / use_streak_saver as a signed-in persona over HTTP.
describe('get_streak saver_reason and previous_streak over HTTP (BE-11, #123)', () => {
  const TODAY = `((now() at time zone 'UTC')::date)`;

  /** Streak cache: a run of `current` whose last completed day is `daysAgo` local days back. */
  async function setRun(coupleId: string, current: number, daysAgo: number) {
    await sql(
      `update couple_streaks set current = $2, longest = greatest(longest, $2),
              last_completed_on = ${TODAY} - $3::int where couple_id = $1`,
      [coupleId, current, daysAgo],
    );
  }

  async function entitle(who: PersonaName) {
    ok(
      await admin
        .from('entitlements')
        .upsert({ user_id: ID[who], is_active: true, expires_at: null }),
      `${who} entitled`,
    );
  }

  /** This local month's D18 claim, spent earlier on another day (private ledger, SQL only). */
  async function spendThisMonthsSaver(coupleId: string) {
    await sql(
      `insert into private.streak_savers (couple_id, used_month, saved_day, saved_current)
       values ($1, date_trunc('month', ${TODAY})::date, ${TODAY} - 5, 4)`,
      [coupleId],
    );
  }

  const ledger = async (coupleId: string) =>
    (
      await sql<{ n: number }>(
        'select count(*)::int n from private.streak_savers where couple_id = $1',
        [coupleId],
      )
    )[0].n;

  async function get(who: PersonaName): Promise<Streak> {
    const res = must(await as(who).rpc('get_streak'), `${who} get_streak`) as Streak;
    expect(Object.keys(res).sort()).toEqual(STREAK_KEYS);
    return res;
  }

  const localDay = async (daysAgo: number) =>
    (await sql<{ d: string }>(`select (${TODAY} - $1::int)::text d`, [daysAgo]))[0].d;

  it('fresh couple: both null', async () => {
    expect(await get('maya')).toMatchObject({ saver_reason: null, previous_streak: null });
    expect(await get('sam')).toMatchObject({ saver_reason: null, previous_streak: null });
  });

  it("an ongoing run (last completed yesterday): both null, even with this month's saver spent", async () => {
    await setRun(couple, 5, 1);
    await spendThisMonthsSaver(couple);
    expect(await get('maya')).toMatchObject({
      current: 5,
      saver_reason: null,
      previous_streak: null,
    });
  });

  it('free couple, yesterday missed: previous_streak is the run that just expired, no reason (no premium is not a reason)', async () => {
    await setRun(couple, 11, 2);
    expect(await get('maya')).toMatchObject({
      current: 0,
      previous_streak: 11,
      saver_reason: null,
      saver_available: false,
    });
  });

  it('premium, yesterday missed, saver unused: available, previous_streak 11, no reason; using it clears the context', async () => {
    await setRun(couple, 11, 2);
    await entitle('maya');
    const before = await get('sam'); // either partner; Maya's entitlement covers both
    expect(before).toMatchObject({
      current: 0,
      previous_streak: 11,
      saver_reason: null,
      saver_available: true,
    });
    expect(await get('maya')).toEqual(before);
    expect(await ledger(couple)).toBe(0); // reading never claims

    const saved = must(await as('sam').rpc('use_streak_saver'), 'use_streak_saver') as Streak;
    expect(Object.keys(saved).sort()).toEqual(STREAK_KEYS);
    expect(saved).toMatchObject({
      current: 11,
      previous_streak: null,
      saver_reason: null,
      saver_available: false,
    });
    expect(await ledger(couple)).toBe(1);
    expect(await get('maya')).toEqual(saved);
  });

  it("saver_reason = 'used_this_month' when yesterday alone is missed and this month's saver is spent", async () => {
    await setRun(couple, 11, 2);
    await entitle('maya');
    await spendThisMonthsSaver(couple);
    const s = await get('maya');
    expect(s).toMatchObject({
      current: 0,
      previous_streak: 11,
      saver_reason: 'used_this_month',
      saver_available: false,
    });
    expect(await get('sam')).toEqual(s);
    expectCode(await as('maya').rpc('use_streak_saver'), 'SAVER_UNAVAILABLE');
    expect(await ledger(couple)).toBe(1);
  });

  it("'used_this_month' also after today is completed (the run restarted at 1, yesterday still repairable)", async () => {
    await entitle('maya');
    await spendThisMonthsSaver(couple);
    const [twoAgo, today] = [await localDay(2), await localDay(0)];
    // Times early in the day so they are never in the server's future.
    for (const day of [twoAgo, today]) {
      const cq = await dailyFor(day);
      await answerAt(cq, 'maya', at(day, '00:00:01'), at(day, '00:00:01'));
      await answerAt(cq, 'sam', at(day, '00:00:02'), at(day, '00:00:02'));
    }
    expect(await get('maya')).toMatchObject({
      current: 1,
      completed_today: true,
      last_completed_on: today,
      previous_streak: null,
      saver_reason: 'used_this_month',
      saver_available: false,
    });
  });

  it("saver_reason = 'too_many_missed' when two days are missed: free or premium, and ahead of a spent month", async () => {
    await setRun(couple, 11, 3);
    const free = await get('maya');
    expect(free).toMatchObject({
      current: 0,
      previous_streak: 11,
      saver_reason: 'too_many_missed',
      saver_available: false,
    });

    await entitle('sam');
    expect(await get('maya')).toMatchObject({
      previous_streak: 11,
      saver_reason: 'too_many_missed',
      saver_available: false,
    });
    expectCode(await as('maya').rpc('use_streak_saver'), 'SAVER_UNAVAILABLE');

    await spendThisMonthsSaver(couple);
    expect(await get('sam')).toMatchObject({
      previous_streak: 11,
      saver_reason: 'too_many_missed',
    });
  });

  it('previous_streak is the run before the break, not longest', async () => {
    await setRun(couple, 41, 1);
    await setRun(couple, 7, 2); // longest stays 41
    expect(await get('maya')).toMatchObject({ longest: 41, current: 0, previous_streak: 7 });
  });

  describe('boundary', () => {
    let other: string;
    beforeEach(async () => {
      other = await pair('eve', 'finn');
      ok(await admin.from('couples').update({ timezone: 'UTC' }).eq('id', other), 'other tz');
      await setRun(couple, 11, 2);
      await setRun(other, 77, 3);
      await entitle('eve');
      await spendThisMonthsSaver(other);
    });

    it("each member reads only their own couple's context", async () => {
      expect(await get('maya')).toMatchObject({ previous_streak: 11, saver_reason: null });
      expect(await get('sam')).toMatchObject({ previous_streak: 11, saver_reason: null });
      expect(await get('eve')).toMatchObject({
        previous_streak: 77,
        saver_reason: 'too_many_missed',
      });
      expect(await get('finn')).toEqual(await get('eve'));
      // Eve's premium does not leak into Maya's couple.
      expect((await get('maya')).saver_available).toBe(false);
    });

    it("a non-member cannot reach another couple's values", async () => {
      // No couple or clock argument exists on the RPC.
      const byId = await loose(as('eve')).rpc('get_streak', { p_couple: couple });
      expect(byId.error).not.toBeNull();
      expect(byId.data).toBeNull();
      // The cache row is not readable across couples; the ledger is not exposed at all.
      expect(
        must(await as('eve').from('couple_streaks').select('*').eq('couple_id', couple), 'read'),
      ).toEqual([]);
      const led = await loose(as('eve')).schema('private').from('streak_savers').select('*');
      expect(led.error).not.toBeNull();
      expect(led.data ?? []).toEqual([]);
      // An unpaired persona gets NOT_PAIRED, not someone's context; anon is denied.
      expectCode(await as('lea').rpc('get_streak'), 'NOT_PAIRED');
      expectPermissionDenied(await anon.rpc('get_streak'));
    });

    it('after unpairing, a new couple does not inherit the old previous_streak', async () => {
      ok(await as('maya').rpc('unpair'), 'maya unpair');
      expectCode(await as('maya').rpc('get_streak'), 'NOT_PAIRED');
      must(await as('maya').rpc('create_couple', { p_stage: 'dating' }), 'maya create_couple');
      expect(await get('maya')).toMatchObject({
        current: 0,
        previous_streak: null,
        saver_reason: null,
      });
    });
  });
});
