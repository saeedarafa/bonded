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
};

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
  const res = await callAs<Streak>(who, 'select * from private.get_streak_at($1::timestamptz)', [
    now,
  ]);
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
  it('returns { current, longest, last_completed_on, completed_today, at_risk, saver_available } for a couple with no history', async () => {
    const res = must(await as('maya').rpc('get_streak'), 'get_streak');
    expect(res).toEqual({
      current: 0,
      longest: 0,
      last_completed_on: null,
      completed_today: false,
      at_risk: false,
      saver_available: false,
    });
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
      expect(s.completed_today).toBe(false);
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
