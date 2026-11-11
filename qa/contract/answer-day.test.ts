// QA-40: D56 a daily question can be answered only on its own day (BE-57; CONTRACTS §2 `answers`,
// error `DAY_ENDED`). Free and Premium couples alike; no paywall for a missed day.
//
// Every write a user makes goes through supabase-js as the app sends it (PostgREST upsert / insert /
// update) with real persona sessions. `admin` (service role) and `sql` only build the days, seed the
// answers a user gave on a past day (server writes are not limited), set entitlements and read back
// what is stored.
//
// Days are couple-local (`couples.timezone`): the couple gets a zone whose local hour is 02–21 at
// setup, so "today" and "yesterday" cannot move while the file runs. The 15-minute grace after local
// midnight runs on the database clock (arrival time), which a client cannot pin: the boundary is
// checked here with a pinned `p_now` on the same function the trigger calls
// (`private.answer_day_open_at`, through the direct DB connection) on this couple's real rows; the
// trigger at the boundary itself is pinned in supabase/tests/answer-day.test.mjs (BE-57).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ID, admin, anon, as, expectCode, must, ok, pair, resetWorld, sql } from './helpers';
import type { PersonaName } from './personas';

const QBODY = (n: number) => `FIXTURE-CONTRACT-DAY-${String(n).padStart(2, '0')}`;
const QCOUNT = 20;

/** Questions only this file uses (not daily-eligible), so every day gets its own question. */
async function ensureQuestions(): Promise<string[]> {
  const bodies = Array.from({ length: QCOUNT }, (_, i) => QBODY(i + 1));
  let rows = must(await admin.from('questions').select('id, body').in('body', bodies), 'read');
  const missing = bodies.filter((b) => !rows.some((r) => r.body === b));
  if (missing.length) {
    ok(
      await admin.from('questions').insert(missing.map((body) => ({ body, daily_eligible: false, sort_order: 0, stages: [] }))),
      'insert questions',
    );
    rows = must(await admin.from('questions').select('id, body').in('body', bodies), 'read');
  }
  ok(await admin.from('questions').update({ active: true }).in('body', bodies), 'activate');
  return bodies.map((b) => rows.find((r) => r.body === b)!.id);
}

/** A zone whose local hour is 02–21 now: a whole-hours margin to local midnight for the run. */
async function safeZone(): Promise<string> {
  const zones = ['Pacific/Kiritimati', 'Asia/Tokyo', 'Europe/Berlin', 'America/New_York', 'Pacific/Honolulu', 'Pacific/Pago_Pago'];
  for (const tz of zones) {
    const [{ h }] = await sql<{ h: number }>(`select extract(hour from now() at time zone $1)::int h`, [tz]);
    if (h >= 2 && h <= 21) return tz;
  }
  throw new Error('no zone with a safe local hour');
}

const localDate = async (tz: string, offset: number) =>
  (await sql<{ d: string }>(`select ((now() at time zone $1)::date + $2::int)::text d`, [tz, offset]))[0].d;

let TZ = '';
let couple = ''; // maya + sam: the free run, the pack and grace cases
let premiumCouple = ''; // eve + finn: the Premium run
let questions: string[] = [];
let nextQ = 0;

/** A couple question k local days ago: daily (assigned_for) or pack (started k days ago). */
async function day(c: string, k: number, source: 'daily' | 'pack' = 'daily'): Promise<string> {
  const d = await localDate(TZ, -k);
  const [{ id }] = await sql<{ id: string }>(
    `insert into couple_questions (couple_id, question_id, source, assigned_for, created_at)
     values ($1, $2, $3, $4::date, now() - make_interval(days => $5)) returning id`,
    [c, questions[nextQ++], source, source === 'daily' ? d : null, k],
  );
  return id;
}

/** The answer a user gave on its day, written by the server (no user: D56 does not limit it). */
const seed = async (cq: string, who: PersonaName, body: string) =>
  must(await admin.from('answers').insert({ couple_question_id: cq, user_id: ID[who], body }).select('id').single(), 'seed').id;

/** The app's write: an upsert on (couple_question_id, user_id), text. */
const upsert = (who: PersonaName, cq: string, body: string | null, extra: Record<string, unknown> = {}) =>
  as(who)
    .from('answers')
    .upsert({ couple_question_id: cq, user_id: ID[who], body, ...extra }, { onConflict: 'couple_question_id,user_id' });

const stored = async (cq: string, who: PersonaName) =>
  (await sql<{ body: string | null; updated_at: string }>('select body, updated_at::text from answers where couple_question_id = $1 and user_id = $2', [cq, ID[who]]))[0];

/** Everything the D56 re-send no-op must leave untouched, read as the server. */
const row = async (cq: string, who: PersonaName) =>
  (
    await sql<{ kind: string; body: string | null; voice_path: string | null; voice_duration_ms: number | null; updated_at: string }>(
      'select kind, body, voice_path, voice_duration_ms, updated_at::text from answers where couple_question_id = $1 and user_id = $2',
      [cq, ID[who]],
    )
  )[0];

const readable = async (reader: PersonaName, cq: string, author: PersonaName) =>
  must(await as(reader).from('answers').select('id').eq('couple_question_id', cq).eq('user_id', ID[author]), 'read').length;

const entitle = async (who: PersonaName) =>
  ok(await admin.from('entitlements').upsert({ user_id: ID[who], is_active: true, expires_at: null }), 'entitle');
const dropEntitlements = async () =>
  ok(await admin.from('entitlements').delete().in('user_id', [ID.maya, ID.sam, ID.eve, ID.finn]), 'drop entitlements');

beforeAll(async () => {
  await resetWorld();
  questions = await ensureQuestions();
  TZ = await safeZone();
  couple = await pair('maya', 'sam', 'link');
  premiumCouple = await pair('eve', 'finn', 'link');
  for (const c of [couple, premiumCouple])
    await sql(`update couples set timezone = $2, paired_at = now() - interval '20 days' where id = $1`, [c, TZ]);
  await dropEntitlements();
});

afterAll(async () => {
  await resetWorld();
});

// One couple per plan (one daily row per couple and day); `x` is the other couple's member.
const RUNS = [
  { plan: 'free', a: 'maya', b: 'sam', x: 'eve' },
  { plan: 'Premium', a: 'eve', b: 'finn', x: 'maya' },
] as const;

for (const { plan, a, b, x } of RUNS) {
  describe(`${plan} couple: answers only on the question's day (D56)`, () => {
    const cq = { today: '', yday: '', old: '' };

    beforeAll(async () => {
      const c = plan === 'free' ? couple : premiumCouple;
      if (plan === 'Premium') await entitle('finn');
      const [{ premium }] = await sql<{ premium: boolean }>('select private.is_couple_premium($1) premium', [c]);
      expect(premium).toBe(plan === 'Premium');
      // Oldest first: today's row is the couple's newest daily row (the trigger's "current" day).
      cq.old = await day(c, 5);
      cq.yday = await day(c, 1);
      cq.today = await day(c, 0);
    });

    it('answer to today\'s question accepted; an edit of it too', async () => {
      ok(await upsert(a, cq.today, `FIXTURE-DAY-${plan}-A-today`), 'today');
      expect((await stored(cq.today, a)).body).toBe(`FIXTURE-DAY-${plan}-A-today`);
      ok(await upsert(a, cq.today, `FIXTURE-DAY-${plan}-A-today-edited`), 'edit today');
      expect((await stored(cq.today, a)).body).toBe(`FIXTURE-DAY-${plan}-A-today-edited`);
    });

    it('reveal rule (D13) still holds today: the partner reads the answer only after answering', async () => {
      expect(await readable(b, cq.today, a)).toBe(0);
      ok(await upsert(b, cq.today, `FIXTURE-DAY-${plan}-B-today`), 'sam today');
      expect(await readable(b, cq.today, a)).toBe(1);
      expect(await readable(a, cq.today, b)).toBe(1);
    });

    it('answer to yesterday after the grace → DAY_ENDED, nothing stored', async () => {
      expectCode(await upsert(b, cq.yday, 'FIXTURE-DAY-LATE'), 'DAY_ENDED');
      expectCode(
        await as(b).from('answers').insert({ couple_question_id: cq.yday, user_id: ID[b], body: 'FIXTURE-DAY-LATE' }).select('id'),
        'DAY_ENDED',
      );
      expect(await stored(cq.yday, b)).toBeUndefined();
    });

    it('an offline-queued answer written yesterday (client_written_at) → DAY_ENDED: client time is ignored', async () => {
      const written = new Date(Date.now() - 24 * 3600_000).toISOString();
      expectCode(await upsert(b, cq.yday, 'FIXTURE-DAY-QUEUED', { client_written_at: written }), 'DAY_ENDED');
      expect(await stored(cq.yday, b)).toBeUndefined();
    });

    it('answer to day −5 → DAY_ENDED, never PREMIUM_REQUIRED (no paywall for a missed day)', async () => {
      expectCode(await upsert(b, cq.old, 'FIXTURE-DAY-LATE'), 'DAY_ENDED');
      expect(await stored(cq.old, b)).toBeUndefined();
    });

    it('a voice answer to yesterday → DAY_ENDED before any voice or Premium check', async () => {
      const res = await as(b)
        .from('answers')
        .upsert(
          {
            couple_question_id: cq.yday,
            user_id: ID[b],
            kind: 'voice',
            body: null,
            voice_path: `${couple}/${ID[b]}/${randomUUID()}.m4a`,
            voice_duration_ms: 4_000,
          },
          { onConflict: 'couple_question_id,user_id' },
        );
      expectCode(res, 'DAY_ENDED');
    });

    describe('own answers of past days (written on their day)', () => {
      beforeAll(async () => {
        await seed(cq.yday, a, `FIXTURE-DAY-${plan}-A-yday`);
        await seed(cq.old, a, `FIXTURE-DAY-${plan}-A-old`);
      });

      it('edit of yesterday\'s answer (upsert and update) → DAY_ENDED, body unchanged', async () => {
        const before = await stored(cq.yday, a);
        expectCode(await upsert(a, cq.yday, 'FIXTURE-DAY-CHANGED').select('id'), 'DAY_ENDED');
        expectCode(
          await as(a).from('answers').update({ body: 'FIXTURE-DAY-CHANGED' }).eq('couple_question_id', cq.yday).eq('user_id', ID[a]).select('id'),
          'DAY_ENDED',
        );
        expect(await stored(cq.yday, a)).toEqual(before);
      });

      it('edit of day −5\'s answer → DAY_ENDED (no paywall), body unchanged', async () => {
        expectCode(await upsert(a, cq.old, 'FIXTURE-DAY-CHANGED'), 'DAY_ENDED');
        expect((await stored(cq.old, a)).body).toBe(`FIXTURE-DAY-${plan}-A-old`);
      });

      // BE-57 follow-up (SEC-13 Info 1, migration 20261111280000): an UNCHANGED own re-send on an
      // ended day (D56) or a D55-locked day is a skipped no-op: no error, 0 rows, nothing written
      // (no new row version, no Realtime, `updated_at` unchanged). A real change stays DAY_ENDED.
      it('unchanged re-send of yesterday\'s own answer (retry / offline queue): no error, 0 rows, nothing changes', async () => {
        const before = await row(cq.yday, a);
        expect(before).toBeDefined();
        const res = await upsert(a, cq.yday, `FIXTURE-DAY-${plan}-A-yday`).select('id');
        expect(res.error, JSON.stringify(res.error)).toBeNull();
        expect(res.data).toHaveLength(0);
        const plain = await upsert(a, cq.yday, `FIXTURE-DAY-${plan}-A-yday`); // as the app sends it
        expect(plain.error, JSON.stringify(plain.error)).toBeNull();
        expect(await row(cq.yday, a)).toEqual(before);
      });

      it('unchanged re-send of yesterday\'s own answer as an update: no error, 0 rows, nothing changes', async () => {
        const before = await row(cq.yday, a);
        const res = await as(a)
          .from('answers')
          .update({ body: `FIXTURE-DAY-${plan}-A-yday` })
          .eq('couple_question_id', cq.yday)
          .eq('user_id', ID[a])
          .select('id');
        expect(res.error, JSON.stringify(res.error)).toBeNull();
        expect(res.data).toHaveLength(0);
        expect(await row(cq.yday, a)).toEqual(before);
      });

      // A free user's day −2+ is also history-locked (D55) and hidden from them: the re-send must
      // still be a no-op (not PREMIUM_REQUIRED, not DAY_ENDED) so a queued write never errors.
      it('unchanged re-send of day −5\'s own answer: no error (not PREMIUM_REQUIRED, not DAY_ENDED), 0 rows, nothing changes', async () => {
        const before = await row(cq.old, a);
        expect(before).toBeDefined();
        const res = await upsert(a, cq.old, `FIXTURE-DAY-${plan}-A-old`).select('id');
        expect(res.error, JSON.stringify(res.error)).toBeNull();
        expect(res.data).toHaveLength(0);
        const plain = await upsert(a, cq.old, `FIXTURE-DAY-${plan}-A-old`);
        expect(plain.error, JSON.stringify(plain.error)).toBeNull();
        expect(await row(cq.old, a)).toEqual(before);
      });

      it('a re-send that changes only the kind (text -> voice) is not unchanged: DAY_ENDED, nothing changes', async () => {
        const before = await row(cq.yday, a);
        const res = await upsert(a, cq.yday, null, {
          kind: 'voice',
          voice_path: `${plan === 'free' ? couple : premiumCouple}/${ID[a]}/${randomUUID()}.m4a`,
          voice_duration_ms: 4_000,
        });
        expectCode(res, 'DAY_ENDED');
        expect(await row(cq.yday, a)).toEqual(before);
      });

      it('reveal rule: the partner who missed yesterday never reads the answer of that day; the author reads their own', async () => {
        expect(await readable(b, cq.yday, a)).toBe(0);
        expect(await readable(a, cq.yday, a)).toBe(1);
      });
    });

    // SEC-13 Info 4: the day guard keys on the `role` GUC. On the PostgREST path a user session
    // (role authenticated) is refused above; the service role (role service_role) is exempt.
    it('service role through PostgREST may write and edit an answer on an ended day (role GUC exemption)', async () => {
      const c = plan === 'free' ? couple : premiumCouple;
      const past = await day(c, 3);
      expectCode(await upsert(b, past, `FIXTURE-DAY-${plan}-B-svc`), 'DAY_ENDED');
      await seed(past, b, `FIXTURE-DAY-${plan}-B-svc`);
      ok(
        await admin.from('answers').update({ body: `FIXTURE-DAY-${plan}-B-svc-edited` }).eq('couple_question_id', past).eq('user_id', ID[b]),
        'service edit',
      );
      expect((await row(past, b)).body).toBe(`FIXTURE-DAY-${plan}-B-svc-edited`);
    });

    it('the other couple writing into this couple\'s past day gets the RLS error, not DAY_ENDED (no date oracle)', async () => {
      for (const target of [cq.yday, cq.old]) {
        const res = await as(x).from('answers').insert({ couple_question_id: target, user_id: ID[x], body: 'FIXTURE-DAY-X' }).select('id');
        expect(res.error?.code).toBe('42501');
        expect(res.error?.message).not.toBe('DAY_ENDED');
      }
    });

    it('writing the partner\'s user_id on a past day is refused, but not as DAY_ENDED', async () => {
      const res = await as(a).from('answers').insert({ couple_question_id: cq.yday, user_id: ID[b], body: 'FIXTURE-DAY-X' });
      expect(res.error).not.toBeNull();
      expect(res.error!.message).not.toBe('DAY_ENDED');
    });

    it('signed out: refused (42501)', async () => {
      const res = await anon.from('answers').insert({ couple_question_id: cq.today, user_id: ID[a], body: 'FIXTURE-DAY-X' });
      expect(res.error?.code).toBe('42501');
    });
  });
}

describe('pack questions have no day (D51 rules unchanged)', () => {
  it('Premium: answer and edit a pack question started 9 days ago', async () => {
    await dropEntitlements();
    await entitle('sam');
    const pack = await day(couple, 9, 'pack');
    ok(await upsert('sam', pack, 'FIXTURE-DAY-PACK-old'), 'pack old');
    ok(await upsert('sam', pack, 'FIXTURE-DAY-PACK-old-edited'), 'pack old edit');
    expect((await stored(pack, 'sam')).body).toBe('FIXTURE-DAY-PACK-old-edited');
  });

  it('free: a pack question started today (D43-era row) is answerable', async () => {
    await dropEntitlements();
    const pack = await day(couple, 0, 'pack');
    ok(await upsert('maya', pack, 'FIXTURE-DAY-PACK-today'), 'pack today');
    expect((await stored(pack, 'maya')).body).toBe('FIXTURE-DAY-PACK-today');
  });
});

describe('the 15-minute grace (database clock, pinned through private.answer_day_open_at)', () => {
  /** Couple-local `date` + `hhmm` as a timestamptz. */
  const at = async (offset: number, time: string) =>
    (await sql<{ t: string }>(`select ((($1::date + $2::int)::text || ' ' || $3)::timestamp at time zone $4)::text t`, [
      await localDate(TZ, 0),
      offset,
      time,
      TZ,
    ]))[0].t;
  const open = async (cq: string, when: string) =>
    (await sql<{ o: boolean }>('select private.answer_day_open_at($1, $2::timestamptz) o', [cq, when]))[0].o;

  it('a day stays open 15 minutes after local midnight (arrival time), even once the next day\'s row exists', async () => {
    // The newest daily rows of this couple: today and yesterday (rows above were added oldest first).
    const rows = await sql<{ id: string; d: string }>(
      `select id, assigned_for::text d from couple_questions where couple_id = $1 and source = 'daily' order by assigned_for desc, created_at desc`,
      [couple],
    );
    const today = await localDate(TZ, 0);
    const yday = await localDate(TZ, -1);
    const t = rows.find((r) => r.d === today)!.id;
    const y = rows.find((r) => r.d === yday)!.id;
    // (Yesterday at its own 23:59 is not asked here: today's row already exists, and a row that is
    // no longer the newest outside the grace is closed by design, the timezone-change guard.)
    expect(await open(y, await at(0, '00:09:00')), 'yesterday at 00:09 (grace)').toBe(true);
    expect(await open(y, await at(0, '00:14:59')), 'yesterday at 00:14:59').toBe(true);
    expect(await open(y, await at(0, '00:15:00')), 'yesterday at 00:15:00').toBe(false);
    expect(await open(t, await at(0, '00:09:00')), 'today during the grace').toBe(true);
    expect(await open(t, await at(0, '23:59:59')), 'today 23:59:59').toBe(true);
    // And the live clock agrees with the trigger cases above: now is hours past the grace.
    expect(await open(y, new Date().toISOString())).toBe(false);
    expect(await open(t, new Date().toISOString())).toBe(true);
  });

  it('the app cannot call the clock function (private schema is not exposed)', async () => {
    const res = await (as('maya') as unknown as { rpc: (f: string, a: object) => Promise<{ error: unknown }> }).rpc('answer_day_open_at', {
      p_cq: randomUUID(),
      p_now: new Date().toISOString(),
    });
    expect(res.error).toBeTruthy();
  });
});
