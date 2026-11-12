// QA-05: BE-08 notifications across the boundary (CONTRACTS §3 `notify`, §4, §5; notifications.json;
// D23-D24). The database's own AFTER INSERT triggers and RPCs dispatch through pg_net to the real
// `notify` handler (qa/functions/purchase_harness.ts), which reads and writes the real push_log on
// this local stack; only Expo delivery is captured. The handler's clock is pinned per case (the
// harness clock), so quiet hours and local days hold at any UTC hour of the run.
// Little things (D48), partner_premium, reminders, trial/offer endings and voice copy have their
// own suites (little-things, purchases, reminders, purchases-be48, offers, voice).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  ID,
  PERSONAS,
  admin,
  as,
  ensureContent,
  expectCode,
  must,
  ok,
  pair,
  resetWorld,
  sql,
} from './helpers';
import type { PersonaName } from './personas';
import { startHarness, type Harness } from './purchase-harness';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stack = inject('stack');
const INTERNAL_SECRET = 'FIXTURE-internal-function-secret';

const MAYA = ID.maya;
const SAM = ID.sam;
const PERSONA_IDS = Object.values(ID);
const TOKEN: Record<string, string> = {
  maya: 'ExponentPushToken[FIXTURE-qa05-maya]',
  sam: 'ExponentPushToken[FIXTURE-qa05-sam]',
  lea: 'ExponentPushToken[FIXTURE-qa05-lea]',
  noor: 'ExponentPushToken[FIXTURE-qa05-noor]',
};
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Pinned notify clock: Monday 2031-03-10 12:00 UTC (no DST change near it in the zones used). */
const T0 = new Date('2031-03-10T12:00:00Z');
const at = (iso: string) => new Date(iso);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

type Sent = {
  to: string;
  title: string;
  body: string;
  sound?: string;
  channelId: string;
  data: { type: string; url: string };
};
type Dispatch = Record<string, unknown>;

let h: Harness;
let couple: string;

// ───────────────────────────── helpers ─────────────────────────────

/** Runs `fn`, then waits until every pg_net request it caused has been answered by notify. */
async function deliver<T>(fn: () => Promise<T>): Promise<T> {
  const mark = await h.mark();
  const out = await fn();
  await h.drain(mark);
  return out;
}
const sentTo = async (who: string, type?: string): Promise<Sent[]> =>
  ((await h.state()).sent as Sent[]).filter(
    (m) => m.to === TOKEN[who] && (!type || m.data.type === type),
  );
const allSent = async (): Promise<Sent[]> => (await h.state()).sent as Sent[];
const dispatches = async (type?: string): Promise<Dispatch[]> =>
  (await h.state()).dispatches.filter((d) => !type || d.type === type) as Dispatch[];
const ledger = (user: string) =>
  sql<{
    type: string;
    record_id: string;
    couple_question_id: string | null;
    local_date: string;
    status: string;
  }>(
    `select type::text, record_id::text, couple_question_id::text, local_date::text, status
       from public.push_log where user_id = $1 order by created_at, id`,
    [user],
  );
/** A notify event the way the database sends it (CONTRACTS §4), through notify's HTTP route. */
const replay = (event: Dispatch) => h.replay(event);
const SENT = { status: 200, body: { sent: 1, suppressed: 0 } };
const SUPPRESSED = { status: 200, body: { sent: 0, suppressed: 1 } };

const usedQuestions = new Set<string>();
/** A new question row of the couple (pack source), so each case has its own answers. */
async function freshCq(c: string = couple): Promise<string> {
  const qs = must(
    await admin.from('questions').select('id').eq('active', true).order('id').limit(1000),
    'questions',
  );
  const taken = new Set(
    must(await admin.from('couple_questions').select('question_id').eq('couple_id', c), 'rows').map(
      (r) => r.question_id,
    ),
  );
  for (const q of qs) {
    if (usedQuestions.has(q.id) || taken.has(q.id)) continue;
    usedQuestions.add(q.id);
    const res = await admin
      .from('couple_questions')
      .insert({ couple_id: c, question_id: q.id, source: 'pack' })
      .select('id')
      .single();
    if (res.error?.code === '23505') continue;
    return must(res, 'fresh cq').id;
  }
  throw new Error('freshCq: no question left');
}
async function answer(who: PersonaName, cq: string, body = `FIXTURE-QA05-ANSWER-${who}`) {
  return must(
    await as(who)
      .from('answers')
      .insert({ couple_question_id: cq, user_id: ID[who], body })
      .select('id')
      .single(),
    `${who} answers`,
  ).id;
}
async function message(who: PersonaName, cq: string, body: string) {
  return must(
    await as(who)
      .from('thread_messages')
      .insert({ client_id: randomUUID(), couple_question_id: cq, user_id: ID[who], body })
      .select('id')
      .single(),
    `${who} posts`,
  ).id;
}
const DEFAULT_PREFS = {
  partner_answered: true,
  replies: true,
  nudges: true,
  daily_reminder: true,
  last_call: true,
  quiet_start: '23:00',
  quiet_end: '07:00',
};
async function prefs(who: PersonaName, over: Partial<typeof DEFAULT_PREFS> = {}) {
  ok(
    await admin
      .from('notification_prefs')
      .update({ ...DEFAULT_PREFS, ...over })
      .eq('user_id', ID[who]),
    `${who} prefs`,
  );
}
async function zone(who: PersonaName, tz: string) {
  ok(await admin.from('profiles').update({ timezone: tz }).eq('id', ID[who]), `${who} timezone`);
}
async function seedLog(
  who: PersonaName,
  rows: { type: string; status: string; local_date: string }[],
) {
  for (const r of rows) {
    await sql(
      `insert into public.push_log (user_id, type, record_id, local_date, status, created_at)
       values ($1, $2::public.push_type, gen_random_uuid(), $3::date, $4, $5::timestamptz)`,
      [ID[who], r.type, r.local_date, r.status, T0.toISOString()],
    );
  }
}
const event = (type: string, over: Dispatch = {}): Dispatch => ({
  type,
  record_id: randomUUID(),
  couple_id: couple,
  couple_question_id: null,
  actor_user_id: MAYA,
  ...over,
});
/** Local wall time of `d` in `tz`, `YYYY-MM-DD HH:MM` (sanity check of the chosen instants). */
const wall = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);

async function clean() {
  ok(await admin.from('push_log').delete().in('user_id', PERSONA_IDS), 'clear push_log');
  await sql('delete from private.nudge_log where sender_id = any($1::uuid[])', [PERSONA_IDS]);
  await h.reset();
  await h.setClock(T0);
  for (const who of ['maya', 'sam'] as const) {
    await zone(who, 'UTC');
    await prefs(who);
  }
}

// ───────────────────────────── world ─────────────────────────────

beforeAll(async () => {
  await ensureContent();
  await resetWorld();
  h = await startHarness();
  await h.setClock(T0);
  // Warm the handler (first request loads the service-role client) through the HTTP route, so the
  // database's first pg_net call is not the cold one: pg_net gives up after 5 s.
  await h.replay({
    type: 'nudge',
    record_id: randomUUID(),
    couple_id: randomUUID(),
    couple_question_id: null,
    actor_user_id: MAYA,
  });
  // Wait for its partner_joined dispatch, so it never lands inside a later case.
  couple = await deliver(() => pair('maya', 'sam'));
  for (const who of ['maya', 'sam'] as const) {
    ok(
      await admin
        .from('push_tokens')
        .insert({ user_id: ID[who], token: TOKEN[who], platform: 'ios' }),
      `${who} token`,
    );
  }
}, 120_000);

afterAll(async () => {
  await h?.stop();
  ok(await admin.from('push_log').delete().in('user_id', PERSONA_IDS), 'clear push_log');
  await sql('delete from private.nudge_log where sender_id = any($1::uuid[])', [PERSONA_IDS]);
  for (const who of Object.keys(PERSONAS) as PersonaName[]) {
    await zone(who, PERSONAS[who].timezone);
    await prefs(who);
    ok(
      await admin
        .from('notification_prefs')
        .update({ tips: false, little_things: true, little_things_sound: true })
        .eq('user_id', ID[who]),
      `${who} default toggles`,
    );
  }
  await resetWorld();
});

// ───────────────────────────── answers (G1, G7, G10) ─────────────────────────────

describe('answers push the partner (BE-08, CONTRACTS §4/§5)', () => {
  beforeEach(clean);

  it('first answer: partner_answered to the partner only, §5 shape, question link, ledger row on the local date', async () => {
    const cq = await freshCq();
    const id = await deliver(() => answer('maya', cq));
    expect(await dispatches('partner_answered')).toEqual([
      expect.objectContaining({
        type: 'partner_answered',
        record_id: id,
        couple_id: couple,
        couple_question_id: cq,
        actor_user_id: MAYA,
      }),
    ]);
    const [m, ...rest] = await allSent();
    expect(rest).toEqual([]);
    expect(Object.keys(m).sort()).toEqual(['body', 'channelId', 'data', 'sound', 'title', 'to']);
    expect(m).toMatchObject({
      to: TOKEN.sam,
      sound: 'default',
      channelId: 'partner_answered',
      data: { type: 'partner_answered', url: `bonded://question/${cq}` },
    });
    expect(Object.keys(m.data).sort()).toEqual(['type', 'url']);
    expect(m.title.length).toBeGreaterThan(0);
    expect(m.body.length).toBeGreaterThan(0);
    // Never the answer itself (the reveal rule: Sam has not answered).
    expect(JSON.stringify(m)).not.toContain('FIXTURE-QA05-ANSWER');
    expect(await ledger(SAM)).toEqual([
      {
        type: 'partner_answered',
        record_id: id,
        couple_question_id: cq,
        local_date: '2031-03-10',
        status: 'sent',
      },
    ]);
    expect(await ledger(MAYA)).toEqual([]);
  });

  it('second answer: both_answered to the first answerer only, same question link', async () => {
    const cq = await freshCq();
    await deliver(() => answer('maya', cq));
    const id = await deliver(() => answer('sam', cq));
    expect((await dispatches()).map((d) => d.type)).toEqual(['partner_answered', 'both_answered']);
    expect(await sentTo('maya')).toEqual([
      expect.objectContaining({
        channelId: 'both_answered',
        data: { type: 'both_answered', url: `bonded://question/${cq}` },
      }),
    ]);
    expect(await sentTo('sam', 'both_answered')).toEqual([]);
    expect((await ledger(MAYA)).map((r) => [r.type, r.record_id, r.status])).toEqual([
      ['both_answered', id, 'sent'],
    ]);
  });

  it('a redelivered dispatch is claimed once: no second push, no second ledger row', async () => {
    const cq = await freshCq();
    await deliver(() => answer('maya', cq));
    await deliver(() => answer('sam', cq));
    for (const d of await dispatches()) {
      const { _transport: _, ...body } = d;
      expect(await replay(body)).toEqual(SUPPRESSED);
    }
    expect(await allSent()).toHaveLength(2);
    expect(await ledger(SAM)).toHaveLength(1);
    expect(await ledger(MAYA)).toHaveLength(1);
  });

  it('editing an answer (update, not insert) dispatches nothing', async () => {
    const cq = await freshCq();
    const id = await deliver(() => answer('maya', cq));
    const before = (await dispatches()).length;
    await deliver(() =>
      sql(`update public.answers set body = 'FIXTURE-QA05-EDITED' where id = $1`, [id]),
    );
    expect(await dispatches()).toHaveLength(before);
    expect(await allSent()).toHaveLength(1);
  });
});

// ───────────────────────────── caps (G3, G4) ─────────────────────────────

describe('one push per type per local day (notifications.json cap_per_day)', () => {
  beforeEach(clean);

  it('partner_answered and both_answered: once a day each, across questions', async () => {
    const [a, b] = [await freshCq(), await freshCq()];
    await deliver(() => answer('maya', a));
    await deliver(() => answer('maya', b));
    await deliver(() => answer('sam', a));
    await deliver(() => answer('sam', b));
    expect(await dispatches()).toHaveLength(4);
    expect(await sentTo('sam', 'partner_answered')).toHaveLength(1);
    expect(await sentTo('maya', 'both_answered')).toHaveLength(1);
    expect((await ledger(SAM)).map((r) => r.couple_question_id)).toEqual([a]);
    expect((await ledger(MAYA)).map((r) => r.couple_question_id)).toEqual([a]);
  });

  it('the next local day the type is allowed again', async () => {
    const a = await freshCq();
    await deliver(() => answer('maya', a));
    await h.setClock(plus(T0, DAY));
    const b = await freshCq();
    await deliver(() => answer('maya', b));
    expect(await sentTo('sam', 'partner_answered')).toHaveLength(2);
    expect((await ledger(SAM)).map((r) => r.local_date)).toEqual(['2031-03-10', '2031-03-11']);
  });

  it('nudge, partner_joined: a second event (new record) the same day is suppressed', async () => {
    for (const type of ['nudge', 'partner_joined']) {
      expect(await replay(event(type)), type).toEqual(SENT);
      expect(await replay(event(type)), `${type} again`).toEqual(SUPPRESSED);
    }
    expect((await ledger(SAM)).map((r) => r.type).sort()).toEqual(['nudge', 'partner_joined']);
  });

  it('thread_activity has no type cap: two questions, two pushes', async () => {
    const [a, b] = [await freshCq(), await freshCq()];
    expect(await replay(event('thread_activity', { couple_question_id: a }))).toEqual(SENT);
    expect(await replay(event('thread_activity', { couple_question_id: b }))).toEqual(SENT);
    expect(await sentTo('sam', 'thread_activity')).toHaveLength(2);
  });
});

describe('four pushes per person per local day, all types together (D24)', () => {
  beforeEach(clean);

  it('three sent or claimed today (other types): the fourth goes, the fifth is dropped without a ledger row; suppressed rows do not count', async () => {
    await seedLog('sam', [
      { type: 'ritual_reminder', status: 'sent', local_date: '2031-03-10' },
      { type: 'last_call', status: 'sent', local_date: '2031-03-10' },
      { type: 'weekly_recap', status: 'claimed', local_date: '2031-03-10' },
      { type: 'tips', status: 'suppressed', local_date: '2031-03-10' },
      { type: 'celebration', status: 'suppressed', local_date: '2031-03-10' },
    ]);
    expect(await replay(event('partner_joined'))).toEqual(SENT);
    expect(await replay(event('nudge'))).toEqual(SUPPRESSED);
    const cq = await freshCq();
    expect(await replay(event('thread_activity', { couple_question_id: cq }))).toEqual(SUPPRESSED);
    expect(await sentTo('sam')).toHaveLength(1);
    const live = (await ledger(SAM)).filter((r) => r.status !== 'suppressed');
    expect(live).toHaveLength(4);
    expect((await ledger(SAM)).map((r) => r.type)).not.toContain('nudge');
  });

  it('the cap is per recipient: Maya still gets hers while Sam is capped', async () => {
    await seedLog('sam', [
      { type: 'ritual_reminder', status: 'sent', local_date: '2031-03-10' },
      { type: 'last_call', status: 'sent', local_date: '2031-03-10' },
      { type: 'weekly_recap', status: 'sent', local_date: '2031-03-10' },
      { type: 'tips', status: 'sent', local_date: '2031-03-10' },
    ]);
    expect(await replay(event('nudge'))).toEqual(SUPPRESSED);
    expect(await replay(event('nudge', { actor_user_id: SAM }))).toEqual(SENT);
    expect(await sentTo('maya', 'nudge')).toHaveLength(1);
  });

  it("the day is the recipient's: east of UTC (Pacific/Kiritimati, +14)", async () => {
    await zone('sam', 'Pacific/Kiritimati');
    expect(wall(T0, 'Pacific/Kiritimati')).toBe('2031-03-11 02:00');
    await prefs('sam', { quiet_start: '08:00', quiet_end: '09:00' });
    // Four on the UTC date do not block: Sam's day is already the 11th.
    await seedLog(
      'sam',
      ['ritual_reminder', 'last_call', 'weekly_recap', 'tips'].map((type) => ({
        type,
        status: 'sent',
        local_date: '2031-03-10',
      })),
    );
    expect(await replay(event('partner_joined'))).toEqual(SENT);
    const rows = await ledger(SAM);
    expect(rows.filter((r) => r.type === 'partner_joined').map((r) => r.local_date)).toEqual([
      '2031-03-11',
    ]);
    // Three more on the 11th: the next one is over the cap.
    await seedLog(
      'sam',
      ['ritual_reminder', 'last_call', 'weekly_recap'].map((type) => ({
        type,
        status: 'sent',
        local_date: '2031-03-11',
      })),
    );
    expect(await replay(event('nudge'))).toEqual(SUPPRESSED);
  });

  it("the day is the recipient's: west of UTC (Pacific/Pago_Pago, -11)", async () => {
    const t = at('2031-03-10T05:00:00Z');
    await h.setClock(t);
    await zone('sam', 'Pacific/Pago_Pago');
    expect(wall(t, 'Pacific/Pago_Pago')).toBe('2031-03-09 18:00');
    await seedLog(
      'sam',
      ['ritual_reminder', 'last_call', 'weekly_recap', 'tips'].map((type) => ({
        type,
        status: 'sent',
        local_date: '2031-03-10',
      })),
    );
    expect(await replay(event('partner_joined'))).toEqual(SENT);
    expect(
      (await ledger(SAM)).filter((r) => r.type === 'partner_joined').map((r) => r.local_date),
    ).toEqual(['2031-03-09']);
  });
});

// ───────────────────────────── quiet hours (G5) ─────────────────────────────

describe("quiet hours in the recipient's zone: dropped, not queued (D23, notifications.json)", () => {
  beforeEach(async () => {
    await clean();
    await zone('sam', 'Europe/Berlin'); // UTC+1 on these dates (DST starts 2031-03-30)
  });

  // Default window 23:00-07:00: start inclusive, end exclusive.
  it.each([
    ['2031-03-10T21:59:00Z', '2031-03-10 22:59', true],
    ['2031-03-10T22:00:00Z', '2031-03-10 23:00', false],
    ['2031-03-10T22:30:00Z', '2031-03-10 23:30', false],
    ['2031-03-10T23:30:00Z', '2031-03-11 00:30', false],
    ['2031-03-11T05:59:00Z', '2031-03-11 06:59', false],
    ['2031-03-11T06:00:00Z', '2031-03-11 07:00', true],
  ])('partner_answered at %s (Berlin %s): sent=%s', async (iso, local, sends) => {
    const t = at(iso);
    expect(wall(t, 'Europe/Berlin')).toBe(local);
    await h.setClock(t);
    const cq = await freshCq();
    const res = await replay(event('partner_answered', { couple_question_id: cq }));
    expect(res).toEqual(sends ? SENT : SUPPRESSED);
    expect(await sentTo('sam')).toHaveLength(sends ? 1 : 0);
    // A quiet-hours drop leaves no ledger row (nothing is queued for later).
    expect(await ledger(SAM)).toHaveLength(sends ? 1 : 0);
  });

  it('a dropped push is not delivered later when the window ends', async () => {
    await h.setClock(at('2031-03-10T22:30:00Z'));
    const e = event('partner_joined');
    expect(await replay(e)).toEqual(SUPPRESSED);
    await h.setClock(at('2031-03-11T06:00:00Z'));
    expect(await sentTo('sam')).toEqual([]);
    // The same event redelivered after the window is a normal first delivery (no claim was kept).
    expect(await replay(e)).toEqual(SENT);
  });

  it('transactional types (partner_joined, no toggle) and nudges are dropped too', async () => {
    await h.setClock(at('2031-03-10T23:30:00Z'));
    for (const type of ['partner_joined', 'nudge', 'both_answered']) {
      expect(await replay(event(type)), type).toEqual(SUPPRESSED);
    }
    const cq = await freshCq();
    expect(await replay(event('thread_activity', { couple_question_id: cq }))).toEqual(SUPPRESSED);
    expect(await ledger(SAM)).toEqual([]);
  });

  it('a custom same-day window (13:00-15:00 local)', async () => {
    await prefs('sam', { quiet_start: '13:00', quiet_end: '15:00' });
    await h.setClock(at('2031-03-10T12:00:00Z')); // 13:00 Berlin
    expect(await replay(event('partner_joined'))).toEqual(SUPPRESSED);
    await h.setClock(at('2031-03-10T13:59:00Z')); // 14:59
    expect(await replay(event('nudge'))).toEqual(SUPPRESSED);
    await h.setClock(at('2031-03-10T14:00:00Z')); // 15:00
    expect(await replay(event('nudge'))).toEqual(SENT);
    // 23:30 is outside a custom 13-15 window.
    await h.setClock(at('2031-03-10T22:30:00Z'));
    expect(await replay(event('partner_joined'))).toEqual(SENT);
  });

  it('a set by Sam through RLS window applies (custom wrap 20:00-02:00)', async () => {
    ok(
      await as('sam')
        .from('notification_prefs')
        .update({ quiet_start: '20:00', quiet_end: '02:00' })
        .eq('user_id', SAM),
      'sam sets quiet hours',
    );
    await h.setClock(at('2031-03-11T00:30:00Z')); // 01:30 Berlin
    expect(await replay(event('partner_joined'))).toEqual(SUPPRESSED);
    await h.setClock(at('2031-03-11T01:00:00Z')); // 02:00 Berlin
    expect(await replay(event('partner_joined'))).toEqual(SENT);
  });
});

// ───────────────────────────── toggles (G6) ─────────────────────────────

describe('each type can be switched off by its pref (D23); partner_joined has none', () => {
  beforeEach(clean);

  const setAs = async (
    over: Partial<
      Record<
        | 'partner_answered'
        | 'replies'
        | 'nudges'
        | 'daily_reminder'
        | 'last_call'
        | 'tips'
        | 'little_things',
        boolean
      >
    >,
  ) =>
    ok(await as('sam').from('notification_prefs').update(over).eq('user_id', SAM), 'sam toggles');

  it('partner_answered off: partner_answered and both_answered are dropped; nudges and replies still go', async () => {
    await setAs({ partner_answered: false });
    const cq = await freshCq();
    expect(await replay(event('partner_answered', { couple_question_id: cq }))).toEqual(SUPPRESSED);
    expect(await replay(event('both_answered', { couple_question_id: cq }))).toEqual(SUPPRESSED);
    expect(await replay(event('nudge'))).toEqual(SENT);
    expect(await replay(event('thread_activity', { couple_question_id: cq }))).toEqual(SENT);
    expect((await ledger(SAM)).map((r) => r.type).sort()).toEqual(['nudge', 'thread_activity']);
  });

  it('replies off: thread_activity dropped; nudges off: nudge dropped', async () => {
    await setAs({ replies: false, nudges: false });
    const cq = await freshCq();
    expect(await replay(event('thread_activity', { couple_question_id: cq }))).toEqual(SUPPRESSED);
    expect(await replay(event('nudge'))).toEqual(SUPPRESSED);
    expect(await replay(event('partner_answered', { couple_question_id: cq }))).toEqual(SENT);
  });

  it('every toggle off: partner_joined (transactional) is still sent', async () => {
    await setAs({
      partner_answered: false,
      replies: false,
      nudges: false,
      daily_reminder: false,
      last_call: false,
      tips: false,
      little_things: false,
    });
    expect(await replay(event('partner_joined'))).toEqual(SENT);
    expect(await sentTo('sam')).toEqual([
      expect.objectContaining({
        channelId: 'partner_joined',
        data: { type: 'partner_joined', url: 'bonded://today' },
      }),
    ]);
  });
});

// ───────────────────────────── thread grouping (G2) ─────────────────────────────

describe('thread replies and reactions are grouped within 5 minutes, per question and recipient', () => {
  let cq: string;
  let mayaAnswer: string;
  beforeEach(async () => {
    await clean();
    cq = await freshCq();
    mayaAnswer = await deliver(() => answer('maya', cq));
    await deliver(() => answer('sam', cq));
    ok(await admin.from('push_log').delete().in('user_id', PERSONA_IDS), 'clear answer pushes');
    await h.reset();
    await h.setClock(T0);
  });

  const LONG = `FIXTURE-QA05-THREAD-${'x'.repeat(120)}`;

  it('first message pushes the partner (thread link, no message text); more within 5:00 do not; after 5:00 the next does', async () => {
    await deliver(() => message('sam', cq, LONG));
    let toMaya = await sentTo('maya', 'thread_activity');
    expect(toMaya).toEqual([
      expect.objectContaining({
        channelId: 'thread_activity',
        sound: 'default',
        data: { type: 'thread_activity', url: `bonded://question/${cq}/thread` },
      }),
    ]);
    // No message text beyond an 80-character preview (CONTRACTS §5).
    expect(JSON.stringify(toMaya)).not.toContain(LONG.slice(0, 81));

    await h.setClock(plus(T0, 4 * MIN + 59_000));
    await deliver(() => message('sam', cq, 'FIXTURE-QA05-THREAD-2'));
    await deliver(async () =>
      must(
        await as('sam')
          .from('reactions')
          .insert({ user_id: SAM, answer_id: mayaAnswer, kind: '🔥' })
          .select('id'),
        'reaction',
      ),
    );
    await h.setClock(plus(T0, 5 * MIN)); // the window includes its end
    await deliver(() => message('sam', cq, 'FIXTURE-QA05-THREAD-3'));
    expect(await sentTo('maya', 'thread_activity')).toHaveLength(1);

    await h.setClock(plus(T0, 5 * MIN + 1_000));
    await deliver(() => message('sam', cq, 'FIXTURE-QA05-THREAD-4'));
    toMaya = await sentTo('maya', 'thread_activity');
    expect(toMaya).toHaveLength(2);
    expect(await dispatches('thread_activity')).toHaveLength(5);
    // Only the pushes that went out have ledger rows.
    expect((await ledger(MAYA)).map((r) => r.status)).toEqual(['sent', 'sent']);
    // The reaction emoji never reaches a push or the ledger (D45).
    expect(JSON.stringify(await allSent())).not.toContain('🔥');
  });

  it('the window is per recipient and per question', async () => {
    await deliver(() => message('sam', cq, 'FIXTURE-QA05-THREAD-A'));
    await h.setClock(plus(T0, MIN));
    // Maya replies: Sam's first thread push on this question.
    await deliver(() => message('maya', cq, 'FIXTURE-QA05-THREAD-B'));
    // Sam on another (revealed) question inside Maya's window: a separate group.
    const other = await freshCq();
    await deliver(() => answer('maya', other));
    await deliver(() => answer('sam', other));
    await deliver(() => message('sam', other, 'FIXTURE-QA05-THREAD-C'));
    expect((await sentTo('maya', 'thread_activity')).map((m) => m.data.url)).toEqual([
      `bonded://question/${cq}/thread`,
      `bonded://question/${other}/thread`,
    ]);
    expect((await sentTo('sam', 'thread_activity')).map((m) => m.data.url)).toEqual([
      `bonded://question/${cq}/thread`,
    ]);
  });
});

// ───────────────────────────── nudge and pairing through the real RPCs (G8, send_nudge) ─────────────────────────────

describe('send_nudge dispatches one nudge; pairing dispatches partner_joined', () => {
  beforeEach(clean);

  it('send_nudge: Sam gets a nudge that opens Today; a second call is NUDGE_LIMIT with no push', async () => {
    await deliver(async () => ok(await as('maya').rpc('send_nudge'), 'nudge'));
    expect(await dispatches('nudge')).toEqual([
      expect.objectContaining({ couple_id: couple, couple_question_id: null, actor_user_id: MAYA }),
    ]);
    expect(await sentTo('sam')).toEqual([
      expect.objectContaining({
        channelId: 'nudge',
        data: { type: 'nudge', url: 'bonded://today' },
      }),
    ]);
    await deliver(async () => expectCode(await as('maya').rpc('send_nudge'), 'NUDGE_LIMIT'));
    expect(await dispatches('nudge')).toHaveLength(1);
    expect(await allSent()).toHaveLength(1);
  });

  it('pairing: the inviter gets partner_joined (Today), the joiner nothing', async () => {
    for (const who of ['lea', 'noor'] as const) {
      await zone(who, 'UTC');
      await prefs(who);
      ok(
        await admin
          .from('push_tokens')
          .upsert({ user_id: ID[who], token: TOKEN[who], platform: 'android' }),
        `${who} token`,
      );
    }
    const leaNoor = await deliver(() => pair('lea', 'noor'));
    expect(await dispatches('partner_joined')).toEqual([
      expect.objectContaining({
        couple_id: leaNoor,
        couple_question_id: null,
        actor_user_id: ID.noor,
      }),
    ]);
    expect(await sentTo('lea')).toEqual([
      {
        to: TOKEN.lea,
        title: expect.any(String),
        body: expect.any(String),
        sound: 'default',
        channelId: 'partner_joined',
        data: { type: 'partner_joined', url: 'bonded://today' },
      },
    ]);
    expect(await sentTo('noor')).toEqual([]);
  });
});

// ───────────────────────────── malformed events (G12) ─────────────────────────────

describe('notify rejects what is not a §4 event', () => {
  beforeEach(clean);

  it.each([
    ['an unknown type (CONTRACTS §4 name)', { type: 'answer_created' }],
    ['a cron-only type', { type: 'ritual_reminder' }],
    ['no record id', { type: 'nudge', record_id: undefined }],
    ['no actor', { type: 'nudge', actor_user_id: undefined }],
  ])('%s: 400 BAD_REQUEST, nothing sent', async (_name, over) => {
    const res = await replay(event('nudge', over as Dispatch));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'BAD_REQUEST' });
    expect(await allSent()).toEqual([]);
  });
});

// ───────────────────────────── DeviceNotRegistered (G9) ─────────────────────────────

/** The real notify handler once (qa/functions/notify_little_things.ts) with Expo answering
 * DeviceNotRegistered for the listed tokens. Real clock: the recipient's window is moved away. */
function notifyOnce(event: Dispatch, invalid: string[]) {
  const out = execFileSync(
    process.env.DENO ?? 'deno',
    [
      'run',
      '--allow-net',
      '--allow-env',
      '--allow-read',
      '--config',
      'supabase/functions/deno.json',
      'qa/functions/notify_little_things.ts',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: stack.url,
        SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
        INTERNAL_FUNCTION_SECRET: INTERNAL_SECRET,
        NOTIFY_BEARER: INTERNAL_SECRET,
        NOTIFY_BODY: JSON.stringify(event),
        NOTIFY_INVALID: invalid.join(','),
      },
      timeout: 120_000,
    },
  );
  const line = out
    .trim()
    .split('\n')
    .reverse()
    .find((l) => l.startsWith('{"status"'));
  if (!line) throw new Error(`no result from notify: ${out}`);
  return JSON.parse(line) as { status: number; body: unknown; messages: Sent[] };
}

describe('Expo DeviceNotRegistered removes the token (push-payloads.json suppression case)', () => {
  beforeEach(clean);

  it('a BE-08 push to a dead token deletes only that token; the claim counts as sent', async () => {
    const dead = 'ExponentPushToken[FIXTURE-qa05-sam-dead]';
    ok(
      await admin.from('push_tokens').insert({ user_id: SAM, token: dead, platform: 'android' }),
      'dead token',
    );
    // Quiet hours 11-13 h after the database clock: never now.
    const [{ s, e }] = await sql<{ s: string; e: string }>(
      `select to_char((now() at time zone 'UTC') + interval '11 hours', 'HH24:MI') s,
              to_char((now() at time zone 'UTC') + interval '13 hours', 'HH24:MI') e`,
    );
    await prefs('sam', { quiet_start: s, quiet_end: e });
    const res = notifyOnce(event('partner_joined'), [dead]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 1, suppressed: 0 });
    expect(res.messages.map((m) => m.to).sort()).toEqual([dead, TOKEN.sam].sort());
    const left = must(await admin.from('push_tokens').select('token').eq('user_id', SAM), 'tokens');
    expect(left.map((r) => r.token)).toEqual([TOKEN.sam]);
    expect((await ledger(SAM)).map((r) => r.status)).toEqual(['sent']);
  });
});
