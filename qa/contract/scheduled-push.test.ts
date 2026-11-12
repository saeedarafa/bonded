// QA-05b: the scheduled pushes (BE-19 ritual reminder and last call, BE-14 weekly recap) end to end:
// real database selection and claims (`due_reminders`, `due_weekly_recaps`, push_log,
// reminder_log, weekly_recap_log) through the REAL daily-reminder handler
// (qa/functions/purchase_harness.ts `POST /__run/daily-reminder`, clock pinned), with only Expo
// delivery captured. What the DB alone cannot show: the Expo message itself (CONTRACTS §5 keys,
// channelId, url, filled copy = qa/fixtures/push-payloads.json), "running twice in a window sends
// once" at the handler, the shared four/day cap and quiet hours per recipient as seen by the user,
// and no answer text in any push. DST, midnight windows and the SQL rules themselves are pinned by
// supabase/tests/reminders.test.mjs and weekly-recap.test.mjs; trial/offer endings by
// purchases-be48 and offers; event-driven pushes by notify.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ID, PERSONAS, admin, ensureContent, must, ok, pair, resetWorld, sql } from './helpers';
import type { PersonaName } from './personas';
import { startHarness, type Harness } from './purchase-harness';

// Read, not imported: the contract suite never loads files under the app's tsconfig (qa/ci/contract.sh).
const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'push-payloads.json'),
    'utf8',
  ),
) as { messages: unknown[]; more_messages: unknown[] };

const MAYA = ID.maya;
const SAM = ID.sam;
const PERSONA_IDS = Object.values(ID);
const BERLIN = 'Europe/Berlin';
const TOKEN = {
  maya: 'ExponentPushToken[FIXTURE-qa05b-maya]',
  sam: 'ExponentPushToken[FIXTURE-qa05b-sam]',
} as const;
/** Pinned local days (no DST change near them in Berlin): Sunday and the Monday after. */
const SUNDAY = '2031-03-16';
const MONDAY = '2031-03-17';
const ANSWER_TEXT = 'FIXTURE-QA05B-ANSWER';
const PREFS = {
  ritual_time: '21:00',
  daily_reminder: true,
  last_call: true,
  replies: true,
  partner_answered: true,
  nudges: true,
  quiet_start: '23:00',
  quiet_end: '07:00',
};

type Sent = {
  to: string;
  title: string;
  body: string;
  sound?: string;
  channelId: string;
  data: { type: string; url: string };
};
type Expected = Omit<Sent, 'to'> & { case: string; type: string };
const FIXTURES = [...fixture.messages, ...fixture.more_messages] as unknown as Expected[];
/** The Expo message a fixture case describes, to `to` (sound/channel default as in §5). */
function expected(name: string, to: string): Sent {
  const f = FIXTURES.find((x) => x.case === name);
  if (!f) throw new Error(`push-payloads.json has no case "${name}"`);
  return {
    to,
    title: f.title,
    body: f.body,
    sound: f.sound ?? 'default',
    channelId: f.channelId ?? f.type,
    data: f.data,
  };
}

let h: Harness;
let couple: string;

/** UTC instant of local `time` on `day` in `tz`, computed by Postgres (DST-correct). */
async function at(day: string, time: string, tz = BERLIN): Promise<Date> {
  const r = await sql<{ t: Date }>(`select ($1::date + $2::time) at time zone $3 as t`, [day, time, tz]);
  return new Date(r[0].t);
}
/** One cron tick: the real daily-reminder handler at `when`. */
async function tick(when: Date) {
  await h.setClock(when);
  const res = await h.runDailyReminder();
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}
const ours = async (): Promise<Sent[]> =>
  ((await h.state()).sent as Sent[]).filter((m) => Object.values(TOKEN).includes(m.to as never));
const sentTo = async (who: keyof typeof TOKEN, type?: string) =>
  (await ours()).filter((m) => m.to === TOKEN[who] && (!type || m.data.type === type));
const ledger = (user: string) =>
  sql<{ type: string; local_date: string; status: string }>(
    `select type::text, local_date::text, status from public.push_log
      where user_id = $1 order by created_at, id`,
    [user],
  );

async function prefs(who: PersonaName, over: Partial<typeof PREFS> = {}) {
  ok(
    await admin
      .from('notification_prefs')
      .update({ ...PREFS, ...over })
      .eq('user_id', ID[who]),
    `${who} prefs`,
  );
}
async function clean() {
  ok(await admin.from('push_log').delete().in('user_id', PERSONA_IDS), 'clear push_log');
  await sql('delete from public.reminder_log where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql('delete from public.weekly_recap_log where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql(`delete from public.couple_questions where couple_id = $1 and source = 'daily'`, [couple]);
  await sql('update public.couple_streaks set current = 0, longest = 0, last_completed_on = null where couple_id = $1', [
    couple,
  ]);
  for (const who of ['maya', 'sam'] as const) {
    ok(await admin.from('profiles').update({ timezone: BERLIN }).eq('id', ID[who]), `${who} tz`);
    ok(
      await admin.from('push_tokens').upsert({ user_id: ID[who], token: TOKEN[who], platform: 'ios' }, { onConflict: 'token' }),
      `${who} token`,
    );
  }
  // Maya's ritual is at 21:00, Sam's in the morning, so a case at 21:00 reminds Maya only.
  await prefs('maya');
  await prefs('sam', { ritual_time: '08:00' });
  await h.reset();
}

/** A daily question of the couple for `day`, answered by `who` (service role: past/future days). */
async function dailyAnswered(day: string, who: PersonaName[]): Promise<string> {
  const q = must(
    await admin.from('questions').select('id').eq('active', true).is('special', null).order('id').limit(50),
    'questions',
  );
  const taken = new Set(
    must(await admin.from('couple_questions').select('question_id').eq('couple_id', couple), 'cq').map(
      (r) => r.question_id,
    ),
  );
  const qid = q.find((r) => !taken.has(r.id))?.id;
  if (!qid) throw new Error('no free question');
  const cq = must(
    await admin
      .from('couple_questions')
      .insert({ couple_id: couple, question_id: qid, source: 'daily', assigned_for: day })
      .select('id')
      .single(),
    'daily cq',
  ).id;
  // The answers' own partner_answered/both_answered dispatches are drained here, so they never land
  // inside a later tick (they are pushed at the harness clock; cases filter by type).
  const mark = await h.mark();
  for (const p of who) {
    ok(
      await admin.from('answers').insert({ couple_question_id: cq, user_id: ID[p], body: `${ANSWER_TEXT}-${p}` }),
      `${p} answers`,
    );
  }
  await h.drain(mark);
  return cq;
}
/** Four pushes Maya already got on `day` (event types), so the daily cap is reached. */
async function fourToday(day: string) {
  for (const type of ['partner_answered', 'both_answered', 'nudge', 'thread_activity']) {
    await sql(
      `insert into public.push_log (user_id, type, record_id, local_date, status)
       values ($1, $2::public.push_type, gen_random_uuid(), $3::date, 'sent')`,
      [MAYA, type, day],
    );
  }
}

// ───────────────────────────── world ─────────────────────────────

beforeAll(async () => {
  await ensureContent();
  await resetWorld();
  h = await startHarness();
  // Wait for pairing's partner_joined dispatch, so it never lands inside a case.
  const mark = await h.mark();
  couple = await pair('maya', 'sam');
  await h.drain(mark);
  ok(await admin.from('couples').update({ timezone: BERLIN }).eq('id', couple), 'couple tz');
}, 120_000);

afterAll(async () => {
  await h?.stop();
  ok(await admin.from('push_log').delete().in('user_id', PERSONA_IDS), 'clear push_log');
  await sql('delete from public.reminder_log where user_id = any($1::uuid[])', [PERSONA_IDS]);
  await sql('delete from public.weekly_recap_log where user_id = any($1::uuid[])', [PERSONA_IDS]);
  ok(await admin.from('push_tokens').delete().in('token', Object.values(TOKEN)), 'tokens');
  for (const who of Object.keys(PERSONAS) as PersonaName[]) {
    ok(await admin.from('profiles').update({ timezone: PERSONAS[who].timezone }).eq('id', ID[who]), 'tz');
    await prefs(who, { ritual_time: '21:00' });
  }
  await resetWorld();
});

beforeEach(clean);

// ───────────────────────────── ritual reminder ─────────────────────────────

describe('ritual reminder through daily-reminder (BE-19, CONTRACTS §3/§5)', () => {
  it('at 21:00 Berlin: Maya gets the fixture message (§5 keys, channel, today link); Sam nothing; ledger sent', async () => {
    const res = await tick(await at(MONDAY, '21:00'));
    const sent = await ours();
    expect(sent).toEqual([expected('ritual reminder default', TOKEN.maya)]);
    expect(Object.keys(sent[0]).sort()).toEqual(['body', 'channelId', 'data', 'sound', 'title', 'to']);
    expect((res.body as { sent: number }).sent).toBeGreaterThanOrEqual(1);
    expect(await ledger(MAYA)).toEqual([{ type: 'ritual_reminder', local_date: MONDAY, status: 'sent' }]);
    expect(await ledger(SAM)).toEqual([]);
  });

  it('running twice in a window sends once (same instant, then the next tick inside the window)', async () => {
    await tick(await at(MONDAY, '21:00'));
    await tick(await at(MONDAY, '21:00'));
    await tick(await at(MONDAY, '21:10'));
    expect(await sentTo('maya', 'ritual_reminder')).toHaveLength(1);
    expect(await ledger(MAYA)).toEqual([{ type: 'ritual_reminder', local_date: MONDAY, status: 'sent' }]);
  });

  it("partner already answered: the partner_answered variant with the partner's name, never the answer", async () => {
    await dailyAnswered(MONDAY, ['sam']);
    await tick(await at(MONDAY, '21:00'));
    const sent = await sentTo('maya', 'ritual_reminder');
    expect(sent).toEqual([expected('ritual reminder partner answered', TOKEN.maya)]);
    expect(JSON.stringify(await ours())).not.toContain(ANSWER_TEXT);
  });

  // #371 (fixed in BE-371): the reminder uses the partner's first name, like voice and
  // little-thing pushes, invite previews and join requests.
  it('#371 two-word display name: the reminder names the partner by first name', async () => {
    ok(await admin.from('profiles').update({ display_name: 'Sam Rivera' }).eq('id', SAM), 'name');
    try {
      await dailyAnswered(MONDAY, ['sam']);
      await tick(await at(MONDAY, '21:00'));
      expect((await sentTo('maya', 'ritual_reminder')).map((m) => m.body)).toEqual([
        'Sam already answered. Your turn.',
      ]);
    } finally {
      ok(
        await admin.from('profiles').update({ display_name: PERSONAS.sam.display_name }).eq('id', SAM),
        'name back',
      );
    }
  });

  it('Maya already answered today: no ritual reminder', async () => {
    await dailyAnswered(MONDAY, ['maya']);
    await tick(await at(MONDAY, '21:00'));
    expect(await sentTo('maya', 'ritual_reminder')).toEqual([]);
  });

  it('daily_reminder off: nothing, and no claim', async () => {
    await prefs('maya', { daily_reminder: false });
    await tick(await at(MONDAY, '21:00'));
    expect(await ours()).toEqual([]);
    expect(await ledger(MAYA)).toEqual([]);
  });

  it('four pushes already today (D24): no reminder, no claimed/sent row, and no catch-up later in the window', async () => {
    await fourToday(MONDAY);
    await tick(await at(MONDAY, '21:00'));
    await tick(await at(MONDAY, '21:10'));
    expect(await ours()).toEqual([]);
    expect((await ledger(MAYA)).filter((r) => r.type === 'ritual_reminder' && r.status !== 'suppressed')).toEqual([]);
  });

  it('three pushes today: the reminder is the fourth and is sent', async () => {
    await fourToday(MONDAY);
    await sql(`delete from public.push_log where user_id = $1 and type = 'thread_activity'`, [MAYA]);
    await tick(await at(MONDAY, '21:00'));
    expect(await sentTo('maya', 'ritual_reminder')).toHaveLength(1);
  });

  it('ritual time inside quiet hours (20:00-22:00): nothing, no queue after the window ends', async () => {
    await prefs('maya', { quiet_start: '20:00', quiet_end: '22:00' });
    await tick(await at(MONDAY, '21:00'));
    await tick(await at(MONDAY, '22:00'));
    expect(await ours()).toEqual([]);
  });

  it('no device: the claim is suppressed; a token registered later in the window gets no resend', async () => {
    ok(await admin.from('push_tokens').delete().eq('token', TOKEN.maya), 'drop token');
    await tick(await at(MONDAY, '21:00'));
    expect(await ours()).toEqual([]);
    expect(await ledger(MAYA)).toEqual([{ type: 'ritual_reminder', local_date: MONDAY, status: 'suppressed' }]);
    ok(await admin.from('push_tokens').insert({ user_id: MAYA, token: TOKEN.maya, platform: 'ios' }), 'token back');
    await tick(await at(MONDAY, '21:10'));
    expect(await ours()).toEqual([]);
  });
});

// ───────────────────────────── last call ─────────────────────────────

describe('last call through daily-reminder (BE-19: 22:30 couple time, streak >= 3 at risk)', () => {
  const streak = (current: number, lastCompleted: string | null) =>
    sql('update public.couple_streaks set current = $2, longest = $2, last_completed_on = $3::date where couple_id = $1', [
      couple,
      current,
      lastCompleted,
    ]);

  it('11-day streak, today not done: both partners get the fixture message once', async () => {
    await streak(11, SUNDAY);
    await tick(await at(MONDAY, '22:30'));
    await tick(await at(MONDAY, '22:40'));
    expect(await sentTo('maya', 'last_call')).toEqual([expected('last call', TOKEN.maya)]);
    expect(await sentTo('sam', 'last_call')).toEqual([expected('last call', TOKEN.sam)]);
    expect(await ledger(SAM)).toEqual([{ type: 'last_call', local_date: MONDAY, status: 'sent' }]);
  });

  it('streak 2: no last call', async () => {
    await streak(2, SUNDAY);
    await tick(await at(MONDAY, '22:30'));
    expect(await ours()).toEqual([]);
  });

  it('today already done by both: no last call', async () => {
    await dailyAnswered(MONDAY, ['maya', 'sam']);
    await streak(11, SUNDAY);
    await tick(await at(MONDAY, '22:30'));
    expect(await sentTo('maya', 'last_call')).toEqual([]);
    expect(await sentTo('sam', 'last_call')).toEqual([]);
  });

  it("quiet hours are each recipient's: Maya quiet from 22:00 gets nothing, Sam still gets it", async () => {
    await streak(11, SUNDAY);
    await prefs('maya', { quiet_start: '22:00', quiet_end: '07:00' });
    await tick(await at(MONDAY, '22:30'));
    expect(await sentTo('maya')).toEqual([]);
    expect(await sentTo('sam', 'last_call')).toHaveLength(1);
  });

  it('last_call off for Maya: only Sam gets it', async () => {
    await streak(11, SUNDAY);
    await prefs('maya', { last_call: false });
    await tick(await at(MONDAY, '22:30'));
    expect(await sentTo('maya')).toEqual([]);
    expect(await sentTo('sam', 'last_call')).toHaveLength(1);
  });
});

// ───────────────────────────── weekly recap ─────────────────────────────

describe('weekly recap through daily-reminder (BE-14: Sunday 18:00 couple time)', () => {
  it('two days together this week: both get the fixture message, recap link, no stats or text', async () => {
    await dailyAnswered('2031-03-10', ['maya', 'sam']);
    await dailyAnswered('2031-03-11', ['maya', 'sam']);
    ok(await admin.from('push_log').delete().in('user_id', PERSONA_IDS), 'drop answer pushes');
    await h.reset();
    await tick(await at(SUNDAY, '18:00'));
    await tick(await at(SUNDAY, '18:10'));
    expect(await sentTo('maya', 'weekly_recap')).toEqual([expected('weekly recap', TOKEN.maya)]);
    expect(await sentTo('sam', 'weekly_recap')).toEqual([expected('weekly recap', TOKEN.sam)]);
    expect(JSON.stringify(await ours())).not.toContain(ANSWER_TEXT);
  });

  it('Saturday 18:00 and Sunday 17:59 send nothing', async () => {
    await tick(await at('2031-03-15', '18:00'));
    await tick(await at(SUNDAY, '17:59'));
    expect(await ours()).toEqual([]);
  });

  it('replies off: no recap for that partner only', async () => {
    await prefs('sam', { ritual_time: '08:00', replies: false });
    await tick(await at(SUNDAY, '18:00'));
    expect(await sentTo('sam')).toEqual([]);
    expect(await sentTo('maya', 'weekly_recap')).toHaveLength(1);
  });
});
