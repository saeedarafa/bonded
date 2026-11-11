// QA-38 (MOB-72): a custom ritual time. N "other" and the 40 sheet's "Pick another time" save
// `notification_prefs.ritual_time` as any `HH:MM` (the picker moves in 5-minute steps), and the
// service-only `due_reminders(p_now)` must fire the ritual reminder at THAT time in the
// recipient's profile timezone, not at the presets (08:00, 12:30, 21:00). The cron ticks every
// 15 minutes and catches the first 15 minutes after the scheduled time (CONTRACTS §3, BE-19).
// The clock is pinned through p_now; each person sets their own time through their own client
// (RLS), as the app does. The DB level (DST, caps, midnight windows) is pinned by
// supabase/tests/reminders.test.mjs; this is the boundary for a non-preset time.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  sql,
} from './helpers';
import type { PersonaName } from './personas';

const MAYA = ID.maya; // Europe/Berlin
const SAM = ID.sam; // America/New_York
const PERSONA_IDS = Object.values(ID);
const PRESETS = ['08:00', '12:30', '21:00'];
const DEFAULTS = { ritual_time: '21:00', daily_reminder: true, last_call: true, quiet_start: '23:00', quiet_end: '07:00' };

let couple: string;
/** A future local date (the ledgers key on it, so no test inherits a claim from real time). */
let DAY: string;

/** The UTC instant of `time` (HH:MM[:SS]) on DAY in `tz`, computed by Postgres (DST-correct). */
async function at(tz: string, time: string, day = DAY): Promise<Date> {
  const r = await sql<{ t: Date }>(`select ($1::date + $2::time) at time zone $3 as t`, [day, time, tz]);
  return new Date(r[0].t);
}

/** One cron tick at `when`: the personas' rows only (other data on the stack is ignored). */
async function tick(when: Date) {
  const rows = must(await admin.rpc('due_reminders', { p_now: when.toISOString() }), 'due_reminders');
  return rows
    .filter((r) => PERSONA_IDS.includes(r.user_id))
    .map((r) => ({ user_id: r.user_id, type: r.type }))
    .sort((a, b) => a.user_id.localeCompare(b.user_id));
}

async function clearLedgers() {
  ok(await admin.from('push_log').delete().in('user_id', PERSONA_IDS), 'clear push_log');
  await sql('delete from public.reminder_log where user_id = any($1::uuid[])', [PERSONA_IDS]);
}

/** A person picks their ritual time in the app (own row, through RLS). */
async function setRitual(who: PersonaName, time: string) {
  const rows = must(
    await as(who)
      .from('notification_prefs')
      .update({ ritual_time: time })
      .eq('user_id', ID[who])
      .select('ritual_time'),
    `${who} ritual_time`,
  );
  expect(rows.map((r) => r.ritual_time.slice(0, 5))).toEqual([time.slice(0, 5)]);
}

async function restoreDefaults() {
  for (const id of [MAYA, SAM]) {
    ok(await admin.from('notification_prefs').update(DEFAULTS).eq('user_id', id), 'prefs defaults');
  }
}

beforeAll(async () => {
  const tz = must(await admin.from('profiles').select('id, timezone').in('id', [MAYA, SAM]), 'profiles');
  expect(Object.fromEntries(tz.map((p) => [p.id, p.timezone]))).toEqual({
    [MAYA]: 'Europe/Berlin',
    [SAM]: 'America/New_York',
  });
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 3);
  DAY = d.toISOString().slice(0, 10);
  await ensureContent();
}, 60_000);
afterAll(async () => {
  await restoreDefaults();
  await clearLedgers();
  await resetWorld();
});

describe('a custom ritual time drives due_reminders (MOB-72, BE-19, QA-38)', () => {
  beforeEach(async () => {
    await resetWorld();
    await restoreDefaults();
    await clearLedgers();
    couple = await pair('maya', 'sam');
  });

  it('19:35 (not a preset): nothing at 08:00, 12:30 or 21:00; the reminder comes at 19:35 Berlin', async () => {
    await setRitual('maya', '19:35');
    await setRitual('sam', '07:05');
    for (const p of PRESETS) {
      const mine = (await tick(await at('Europe/Berlin', p))).filter((r) => r.user_id === MAYA);
      expect(mine, `Maya at preset ${p}`).toEqual([]);
    }
    const rows = must(await admin.from('reminder_log').select('user_id').eq('user_id', MAYA), 'ledger');
    expect(rows).toEqual([]);
    expect(await tick(await at('Europe/Berlin', '19:35'))).toEqual([{ user_id: MAYA, type: 'ritual_reminder' }]);
    // Claimed once per scheduled date: the next ticks inside the window are quiet.
    expect(await tick(await at('Europe/Berlin', '19:45'))).toEqual([]);
  });

  it('the window is [19:35, 19:50): 19:34:59 no, the 19:45 quarter-hour tick yes, 19:50 no', async () => {
    await setRitual('maya', '19:35');
    expect(await tick(await at('Europe/Berlin', '19:30'))).toEqual([]);
    expect(await tick(await at('Europe/Berlin', '19:34:59'))).toEqual([]);
    expect(await tick(await at('Europe/Berlin', '19:50'))).toEqual([]);
    // The real cron only runs at :00/:15/:30/:45, so 19:45 is where a 19:35 time is delivered.
    expect(await tick(await at('Europe/Berlin', '19:45'))).toEqual([{ user_id: MAYA, type: 'ritual_reminder' }]);
  });

  it("each partner's custom time runs in their own timezone (Sam 07:05 New York)", async () => {
    await setRitual('maya', '19:35');
    await setRitual('sam', '07:05');
    // Sam's preset-free morning: not at Maya's 19:35 Berlin, not at his default 21:00.
    expect(await tick(await at('America/New_York', '21:00'))).toEqual([]);
    expect(await tick(await at('America/New_York', '07:15'))).toEqual([{ user_id: SAM, type: 'ritual_reminder' }]);
    expect(await tick(await at('Europe/Berlin', '19:45'))).toEqual([{ user_id: MAYA, type: 'ritual_reminder' }]);
  });

  it('a custom time changed later moves the reminder (the old time no longer fires)', async () => {
    await setRitual('maya', '19:35');
    await setRitual('maya', '10:10');
    expect(await tick(await at('Europe/Berlin', '19:45'))).toEqual([]);
    expect(await tick(await at('Europe/Berlin', '10:15'))).toEqual([{ user_id: MAYA, type: 'ritual_reminder' }]);
  });

  it('a custom time inside quiet hours (06:40, quiet 23:00-07:00) is skipped, with no catch-up', async () => {
    await setRitual('maya', '06:40');
    for (const t of ['06:40', '06:45', '07:00', '07:15', ...PRESETS]) {
      expect(await tick(await at('Europe/Berlin', t)), `Maya at ${t}`).toEqual([]);
    }
  });

  it('no reminder at the custom time once I answered today', async () => {
    await setRitual('maya', '19:35');
    // Today's question, answered through the app path; the tick is pinned to today's date
    // (the question's assigned_for, couple timezone Berlin).
    const q = must(await as('maya').rpc('get_daily_question'), 'get_daily_question') as unknown as {
      id: string;
      assigned_for: string;
    };
    must(
      await as('maya')
        .from('answers')
        .insert({ couple_question_id: q.id, user_id: MAYA, body: 'FIXTURE-REMINDER-ANSWER' })
        .select('id'),
      'answer',
    );
    const today = q.assigned_for;
    expect(await tick(await at('Europe/Berlin', '19:45', today))).toEqual([]);
    // Sam has not answered: his custom time still fires that day.
    await setRitual('sam', '13:20');
    expect(await tick(await at('America/New_York', '13:30', today))).toEqual([
      { user_id: SAM, type: 'ritual_reminder' },
    ]);
  });

  it('daily_reminder off: the custom time sends nothing', async () => {
    await setRitual('maya', '19:35');
    ok(await as('maya').from('notification_prefs').update({ daily_reminder: false }).eq('user_id', MAYA), 'off');
    expect(await tick(await at('Europe/Berlin', '19:45'))).toEqual([]);
  });

  it('users and anon cannot call due_reminders', async () => {
    const args = { p_now: new Date().toISOString() };
    expectPermissionDenied(await as('maya').rpc('due_reminders', args));
    expectPermissionDenied(await anon.rpc('due_reminders', args));
    expect(couple).toBeTruthy();
  });
});
