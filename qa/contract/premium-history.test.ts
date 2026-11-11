// QA-37: D55 History is Premium beyond yesterday (BE-55; CONTRACTS §2 "History lock", `history_days`,
// "Voice upload" read rule, Realtime). Release blocker next to the reveal rule.
//
// Everything a user does goes through supabase-js as the app calls it (PostgREST, Storage, Realtime)
// with real persona sessions. `admin` (service role: no user, so the server path the lock exempts)
// and `sql` only build the days, set entitlements and count what is stored.
//
// Days are couple-local (`couples.timezone`): the couple gets a timezone whose local hour is between
// 02 and 21 at setup, so no case can cross a local midnight while the file runs. The day boundary to
// the second is pinned with a fixed clock in supabase/tests/premium-history.test.mjs (BE-55).
//
// Bodies are FIXTURE text; each carries its day label so a leak of a locked day shows by name.
import { randomUUID } from 'node:crypto';
import { createClient, type PostgrestError, type RealtimeChannel } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Database } from '../../src/types/database';
import {
  ID,
  admin,
  anon,
  as,
  canForgeJwt,
  expectCode,
  expectPermissionDenied,
  must,
  noSubject,
  ok,
  pair,
  resetWorld,
  sql,
  tokenOf,
  type Db,
} from './helpers';
import type { PersonaName } from './personas';

const stack = inject('stack');
const KB = 1024;
const AUDIO = 'audio/mp4';

// ───────────────────────────── fixture helpers ─────────────────────────────

const QBODY = (n: number) => `FIXTURE-CONTRACT-HIST-${String(n).padStart(2, '0')}`;
const QCOUNT = 24;

/** Questions only this file uses (not daily-eligible), so every day gets its own question. */
async function ensureHistoryQuestions(): Promise<string[]> {
  const bodies = Array.from({ length: QCOUNT }, (_, i) => QBODY(i + 1));
  let rows = must(await admin.from('questions').select('id, body').in('body', bodies), 'read');
  const missing = bodies.filter((b) => !rows.some((r) => r.body === b));
  if (missing.length) {
    ok(
      await admin
        .from('questions')
        .insert(missing.map((body) => ({ body, daily_eligible: false, sort_order: 0, stages: [] }))),
      'insert history questions',
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

/** Pairs two personas, sets the couple's zone and backdates pairing 20 days (all test days in the pair period, D37). */
async function pairAt(a: PersonaName, b: PersonaName, tz: string): Promise<string> {
  const couple = await pair(a, b, 'link');
  await sql(`update couples set timezone = $2, paired_at = now() - interval '20 days' where id = $1`, [couple, tz]);
  return couple;
}

let questions: string[] = [];
let nextQ = 0;
/** A couple question k local days ago: daily (assigned_for) or pack (started k days ago). */
async function day(couple: string, tz: string, k: number, source: 'daily' | 'pack' = 'daily'): Promise<string> {
  const qid = questions[nextQ++];
  const d = await localDate(tz, -k);
  const [{ id }] = await sql<{ id: string }>(
    `insert into couple_questions (couple_id, question_id, source, assigned_for, created_at)
     values ($1, $2, $3, $4::date, now() - make_interval(days => $5)) returning id`,
    [couple, qid, source, source === 'daily' ? d : null, k],
  );
  return id;
}

/** Server-side content (no user: the lock does not apply to server writes). */
const answer = async (cq: string, who: PersonaName, body: string) =>
  must(await admin.from('answers').insert({ couple_question_id: cq, user_id: ID[who], body }).select('id').single(), 'answer').id;
const message = async (cq: string, who: PersonaName, body: string) =>
  must(
    await admin
      .from('thread_messages')
      .insert({ client_id: randomUUID(), couple_question_id: cq, user_id: ID[who], body })
      .select('id')
      .single(),
    'message',
  ).id;
const react = async (who: PersonaName, target: { answer_id: string } | { message_id: string }, kind = '❤️') =>
  must(await admin.from('reactions').insert({ user_id: ID[who], kind, ...target }).select('id').single(), 'reaction').id;

const entitle = async (who: PersonaName, expires_at: string | null = null, is_active = true) =>
  ok(await admin.from('entitlements').upsert({ user_id: ID[who], is_active, expires_at }), 'entitle');
const dropEntitlements = async (...who: PersonaName[]) =>
  ok(await admin.from('entitlements').delete().in('user_id', who.map((w) => ID[w])), 'drop entitlements');

const recording = (n: number, tag: string) => {
  const b = Buffer.alloc(n, 0x20);
  b.write(`FIXTURE-VOICE-${tag}`.slice(0, 16));
  return b;
};
/** A take through the real API: start_voice_upload names it, Storage stores it (needs Premium). */
async function take(who: PersonaName, tag: string): Promise<string> {
  const name = must(await as(who).rpc('start_voice_upload', { p_ext: 'm4a' }), 'slot') as string;
  const res = await as(who).storage.from('voice').upload(name, recording(8 * KB, tag), { contentType: AUDIO, upsert: false });
  if (res.error) throw new Error(`upload: ${JSON.stringify(res.error)}`);
  return name;
}

/** Download and a 60 s signed URL as `who`: both must agree. The bytes, or null when refused. */
async function fetchVoice(who: PersonaName, name: string): Promise<Buffer | null> {
  const client = as(who);
  const dl = await client.storage.from('voice').download(name);
  const signed = await client.storage.from('voice').createSignedUrl(name, 60);
  if (dl.error || !dl.data) {
    expect(signed.error, `signed URL must be refused too (${name})`).toBeTruthy();
    expect(signed.data?.signedUrl ?? null).toBeNull();
    return null;
  }
  expect(signed.error, 'download worked, so must a signed URL').toBeNull();
  const viaUrl = await fetch(signed.data!.signedUrl);
  expect(viaUrl.status).toBe(200);
  const bytes = Buffer.from(await dl.data.arrayBuffer());
  expect(Buffer.from(await viaUrl.arrayBuffer()).equals(bytes)).toBe(true);
  return bytes;
}

const answersOf = async (who: PersonaName, cq: string) =>
  must(await as(who).from('answers').select('id, user_id, body, kind, voice_path').eq('couple_question_id', cq), 'answers');
const messagesOf = async (who: PersonaName, cq: string) =>
  must(await as(who).from('thread_messages').select('id, body, voice_path').eq('couple_question_id', cq), 'messages');
const reactionsById = async (who: PersonaName, ids: string[]) =>
  must(await as(who).from('reactions').select('id, kind').in('id', ids), 'reactions');

type Day = { id: string; couple_question_id: string; locked: boolean } & Record<string, unknown>;
const historyDays = async (db: Db, args: Record<string, unknown> = {}) =>
  db.rpc('history_days', args as never) as unknown as Promise<{ data: Day[] | null; error: PostgrestError | null }>;

const HISTORY_KEYS = [
  'couple_question_id',
  'couple_id',
  'question_id',
  'question',
  'source',
  'day',
  'created_at',
  'my_answered',
  'partner_answered',
  'message_count',
  'locked',
].sort();

// ───────────────────────────── the free couple ─────────────────────────────

const OPEN = ['d0', 'd1', 'packToday'] as const;
const LOCKED = ['d2', 'd5', 'packOld'] as const;
type Label = (typeof OPEN)[number] | (typeof LOCKED)[number];
const LABELS: [Label, number, 'daily' | 'pack'][] = [
  ['d0', 0, 'daily'],
  ['d1', 1, 'daily'],
  ['d2', 2, 'daily'],
  ['d5', 5, 'daily'],
  ['packToday', 0, 'pack'],
  ['packOld', 3, 'pack'],
];
const PARTNERS = ['maya', 'sam'] as const;

let TZ = '';
let couple = '';
const cq = {} as Record<Label, string>;
const ans = {} as Record<Label, { maya: string; sam: string }>;
const msg = {} as Record<Label, { maya: string; sam: string }>;
const rx = {} as Record<Label, { onAnswer: string; onMessage: string }>;
const voice = {} as Record<'d1' | 'd2', { answer: string; message: string; messageId: string }>;
let looseTake = '';

const totals = async (c: string) =>
  (
    await sql<{ a: number; m: number; r: number; o: number }>(
      `select (select count(*) from answers a join couple_questions q on q.id = a.couple_question_id where q.couple_id = $1)::int a,
              (select count(*) from thread_messages m join couple_questions q on q.id = m.couple_question_id where q.couple_id = $1)::int m,
              (select count(*) from reactions r
                 left join answers a on a.id = r.answer_id left join thread_messages t on t.id = r.message_id
                 join couple_questions q on q.id = coalesce(a.couple_question_id, t.couple_question_id)
                where q.couple_id = $1)::int r,
              (select count(*) from storage.objects where bucket_id = 'voice' and name like $1::text || '/%')::int o`,
      [c],
    )
  )[0];
let before: Awaited<ReturnType<typeof totals>>;

beforeAll(async () => {
  await resetWorld();
  questions = await ensureHistoryQuestions();
  TZ = await safeZone();
  couple = await pairAt('maya', 'sam', TZ);
  for (const [label, k, source] of LABELS) {
    cq[label] = await day(couple, TZ, k, source);
    ans[label] = {
      maya: await answer(cq[label], 'maya', `FIXTURE-HIST-ANSWER-MAYA-${label}`),
      sam: await answer(cq[label], 'sam', `FIXTURE-HIST-ANSWER-SAM-${label}`),
    };
    msg[label] = {
      maya: await message(cq[label], 'maya', `FIXTURE-HIST-MSG-MAYA-${label}`),
      sam: await message(cq[label], 'sam', `FIXTURE-HIST-MSG-SAM-${label}`),
    };
    rx[label] = {
      onAnswer: await react('sam', { answer_id: ans[label].maya }),
      onMessage: await react('maya', { message_id: msg[label].sam }),
    };
  }
  // Voice on yesterday and day −2. The takes go through the app's path (start_voice_upload, upload);
  // a new voice reference needs Premium at write time (BE-42), so Maya is Premium meanwhile. The
  // answer rows are past days, which a client can no longer write (D56, BE-57: DAY_ENDED), so the
  // server turns Maya's text answers into the voice answers she gave on those days.
  await entitle('maya');
  for (const label of ['d1', 'd2'] as const) {
    const a = await take('maya', `A-${label}`);
    ok(
      await admin
        .from('answers')
        .update({ kind: 'voice', body: null, voice_path: a, voice_duration_ms: 4_000 })
        .eq('id', ans[label].maya),
      `maya voice answer ${label}`,
    );
    const m = await take('sam', `M-${label}`);
    const row = must(
      await as('sam')
        .from('thread_messages')
        .insert({ client_id: randomUUID(), couple_question_id: cq[label], user_id: ID.sam, kind: 'voice', body: null, voice_path: m, voice_duration_ms: 3_000 })
        .select('id')
        .single(),
      `sam voice message ${label}`,
    );
    voice[label] = { answer: a, message: m, messageId: row.id };
  }
  looseTake = await take('maya', 'LOOSE');
  await dropEntitlements('maya');
  before = await totals(couple);
});

afterAll(async () => {
  await resetWorld();
});

describe('free couple: today and yesterday are open, older days are locked (D55)', () => {
  it('fixture: the couple is free, the zone is safe, and every row exists in the database', async () => {
    const [{ premium }] = await sql<{ premium: boolean }>('select private.is_couple_premium($1) premium', [couple]);
    expect(premium).toBe(false);
    expect(before.a).toBe(12);
    expect(before.m).toBe(14); // 2 per day + 2 voice messages
    expect(before.r).toBe(12);
    expect(before.o).toBe(5); // 2 voice answers, 2 voice messages, 1 unattached take
  });

  for (const who of PARTNERS) {
    it(`${who}: both answers (own and partner, text) of today, yesterday and today's pack question`, async () => {
      for (const l of ['d0', 'packToday'] as const) {
        const rows = await answersOf(who, cq[l]);
        expect(rows.map((r) => r.body).sort(), l).toEqual([`FIXTURE-HIST-ANSWER-MAYA-${l}`, `FIXTURE-HIST-ANSWER-SAM-${l}`]);
      }
      const y = await answersOf(who, cq.d1);
      expect(y.map((r) => r.user_id).sort()).toEqual([ID.maya, ID.sam].sort());
      expect(y.find((r) => r.user_id === ID.maya)).toMatchObject({ kind: 'voice', body: null, voice_path: voice.d1.answer });
      expect(y.find((r) => r.user_id === ID.sam)?.body).toBe('FIXTURE-HIST-ANSWER-SAM-d1');
    });

    it(`${who}: threads and reactions of the open days`, async () => {
      for (const l of OPEN) {
        const m = await messagesOf(who, cq[l]);
        expect(m.length, l).toBeGreaterThanOrEqual(2);
        expect((await reactionsById(who, [rx[l].onAnswer, rx[l].onMessage])).length, l).toBe(2);
      }
      expect((await messagesOf(who, cq.d1)).some((m) => m.voice_path === voice.d1.message)).toBe(true);
    });

    it(`${who}: nothing of day −2, day −5 or an old pack question (own answer too)`, async () => {
      for (const l of LOCKED) {
        expect(await answersOf(who, cq[l]), `${l} answers`).toEqual([]);
        const byId = must(await as(who).from('answers').select('id').in('id', [ans[l].maya, ans[l].sam]), 'by id');
        expect(byId, `${l} answers by id`).toEqual([]);
        expect(await messagesOf(who, cq[l]), `${l} messages`).toEqual([]);
        expect(await reactionsById(who, [rx[l].onAnswer, rx[l].onMessage]), `${l} reactions`).toEqual([]);
      }
      const voiceMsg = must(await as(who).from('thread_messages').select('id').eq('id', voice.d2.messageId), 'voice msg');
      expect(voiceMsg).toEqual([]);
    });

    it(`${who}: an unfiltered read of the couple's content returns only open days`, async () => {
      const all = JSON.stringify([
        must(await as(who).from('answers').select('*'), 'answers'),
        must(await as(who).from('thread_messages').select('*'), 'messages'),
        must(await as(who).from('reactions').select('*'), 'reactions'),
      ]);
      for (const l of LOCKED) {
        expect(all).not.toContain(`-${l}"`);
        for (const id of [ans[l].maya, ans[l].sam, msg[l].maya, msg[l].sam, rx[l].onAnswer, rx[l].onMessage]) expect(all).not.toContain(id);
      }
      expect(all).not.toContain(voice.d2.answer);
      expect(all).not.toContain(voice.d2.message);
    });

    it(`${who}: the History select (couple_questions + embedded answers, messages, reactions) lists every day, content only for open days`, async () => {
      const rows = must(
        await as(who)
          .from('couple_questions')
          .select('id, source, assigned_for, answer_count, question:questions(body), answers(user_id, body, voice_path, reactions(kind)), thread_messages(body)')
          .eq('couple_id', couple),
        'history select',
      );
      expect(rows.length).toBe(LABELS.length);
      const by = Object.fromEntries(rows.map((r) => [r.id, r]));
      for (const l of OPEN) expect(by[cq[l]].answers.length, l).toBe(2);
      for (const l of LOCKED) {
        expect(by[cq[l]].answer_count, `${l} answer_count stays`).toBe(2);
        expect(by[cq[l]].question?.body, `${l} question stays`).toMatch(/^FIXTURE-CONTRACT-HIST-/);
        expect(by[cq[l]].answers, `${l} answers`).toEqual([]);
        expect(by[cq[l]].thread_messages, `${l} messages`).toEqual([]);
      }
    });

    it(`${who}: yesterday's voice objects play (download and signed URL); day −2's do not, not even for their owner`, async () => {
      expect((await fetchVoice(who, voice.d1.answer))?.subarray(0, 16).toString()).toBe('FIXTURE-VOICE-A-');
      expect(await fetchVoice(who, voice.d1.message)).not.toBeNull();
      expect(await fetchVoice(who, voice.d2.answer)).toBeNull();
      expect(await fetchVoice(who, voice.d2.message)).toBeNull();
    });
  }

  it('an unattached take stays readable by its owner only', async () => {
    expect(await fetchVoice('maya', looseTake)).not.toBeNull();
    expect(await fetchVoice('sam', looseTake)).toBeNull();
  });
});

describe('history_days (no content, locked per day)', () => {
  it('lists every day with the contract shape, newest first, and never any answer or message text', async () => {
    const rows = must(await historyDays(as('maya')), 'history_days');
    expect(rows.length).toBe(LABELS.length);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(HISTORY_KEYS);
    const times = rows.map((r) => new Date(r.created_at as string).getTime());
    expect(times.every((t, i) => i === 0 || times[i - 1] >= t)).toBe(true);
    const text = JSON.stringify(rows);
    expect(text).not.toContain('FIXTURE-HIST-');
    expect(text).not.toContain('voice');
  });

  it('locked = older than couple-local yesterday (daily: assigned_for; pack: local start date); who answered and message counts stay', async () => {
    for (const who of PARTNERS) {
      const by = Object.fromEntries(must(await historyDays(as(who)), 'history_days').map((r) => [r.couple_question_id, r]));
      for (const [l, k, source] of LABELS) {
        expect(by[cq[l]], `${who} ${l}`).toMatchObject({
          couple_id: couple,
          source,
          day: await localDate(TZ, -k),
          my_answered: true,
          partner_answered: true,
          locked: (LOCKED as readonly string[]).includes(l),
        });
        expect((by[cq[l]].question as { body: string }).body).toMatch(/^FIXTURE-CONTRACT-HIST-/);
      }
      expect(by[cq.d5].message_count).toBe(2);
      expect(by[cq.d2].message_count).toBe(3); // two text + one voice
    }
  });

  it('paging, limit clamp, one day by id, my couple by id', async () => {
    const all = must(await historyDays(as('sam')), 'all');
    const page = must(await historyDays(as('sam'), { p_limit: 2, p_offset: 2 }), 'page');
    expect(page.map((r) => r.couple_question_id)).toEqual(all.slice(2, 4).map((r) => r.couple_question_id));
    expect(must(await historyDays(as('sam'), { p_limit: 0 }), 'limit 0').length).toBe(1);
    expect(must(await historyDays(as('sam'), { p_limit: 1000 }), 'limit 1000').length).toBe(all.length);
    const one = must(await historyDays(as('sam'), { p_couple_question_id: cq.d5 }), 'one');
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ couple_question_id: cq.d5, locked: true });
    expect(must(await historyDays(as('maya'), { p_couple_id: couple }), 'by couple').length).toBe(all.length);
  });

  it('another couple gets an empty set for this couple or day; signed out 42501; no couple NOT_PAIRED', async () => {
    await pairAt('eve', 'finn', TZ);
    expect(must(await historyDays(as('eve'), { p_couple_id: couple }), 'foreign couple')).toEqual([]);
    expect(must(await historyDays(as('eve'), { p_couple_question_id: cq.d1 }), 'foreign day')).toEqual([]);
    expect(must(await historyDays(as('eve')), 'own empty')).toEqual([]);
    expectPermissionDenied(await historyDays(anon));
    expectCode(await historyDays(as('lea')), 'NOT_PAIRED');
    if (canForgeJwt) expectCode(await historyDays(noSubject()), 'NOT_AUTHENTICATED');
  });
});

describe('writes into a locked day → PREMIUM_REQUIRED (answers on a past daily day: DAY_ENDED, D56); plain update/delete match nothing', () => {
  const late = (who: PersonaName, l: Label) =>
    as(who)
      .from('thread_messages')
      .insert({ client_id: randomUUID(), couple_question_id: cq[l], user_id: ID[who], body: 'FIXTURE-HIST-LATE' })
      .select('id');

  it('a thread message on every locked day, either partner', async () => {
    for (const l of LOCKED) for (const who of PARTNERS) expectCode(await late(who, l), 'PREMIUM_REQUIRED');
  });

  it('an answer upsert (the app\'s edit) on a locked day: daily days DAY_ENDED (D56, no paywall), the old pack question PREMIUM_REQUIRED', async () => {
    const edit = (l: Label) =>
      as('sam')
        .from('answers')
        .upsert({ couple_question_id: cq[l], user_id: ID.sam, body: 'FIXTURE-HIST-EDIT' }, { onConflict: 'couple_question_id,user_id' })
        .select('id');
    for (const l of ['d2', 'd5'] as const) expectCode(await edit(l), 'DAY_ENDED');
    expectCode(await edit('packOld'), 'PREMIUM_REQUIRED');
  });

  it('a reaction on a locked answer (insert) and on a locked message (upsert)', async () => {
    expectCode(await as('maya').from('reactions').insert({ user_id: ID.maya, answer_id: ans.d2.sam, kind: '🔥' }).select('id'), 'PREMIUM_REQUIRED');
    expectCode(
      await as('sam')
        .from('reactions')
        .upsert({ user_id: ID.sam, message_id: msg.d5.maya, kind: '🔥' }, { onConflict: 'message_id,user_id' })
        .select('id'),
      'PREMIUM_REQUIRED',
    );
  });

  it('update / delete of own locked rows: 0 rows, no error, nothing changed', async () => {
    const upd = await as('maya').from('thread_messages').update({ body: 'FIXTURE-HIST-X', edited_at: new Date().toISOString() }).eq('id', msg.d2.maya).select('id');
    expect(upd.error).toBeNull();
    expect(upd.data).toEqual([]);
    const ua = await as('sam').from('answers').update({ body: 'FIXTURE-HIST-X' }).eq('id', ans.d5.sam).select('id');
    expect(ua.error).toBeNull();
    expect(ua.data).toEqual([]);
    const del = await as('maya').from('reactions').delete().eq('id', rx.d2.onMessage).select('id');
    expect(del.error).toBeNull();
    expect(del.data).toEqual([]);
    // No filter at all: still only the open days.
    ok(await as('maya').from('thread_messages').update({ body: 'FIXTURE-HIST-UNFILTERED' }).eq('user_id', ID.maya), 'unfiltered');
    const [{ n }] = await sql<{ n: number }>(
      `select count(*)::int n from thread_messages where body like 'FIXTURE-HIST-%X%' or (body = 'FIXTURE-HIST-UNFILTERED' and couple_question_id = any($1))`,
      [LOCKED.map((l) => cq[l])],
    );
    expect(n).toBe(0);
    const [{ body }] = await sql<{ body: string }>('select body from answers where id = $1', [ans.d5.sam]);
    expect(body).toBe('FIXTURE-HIST-ANSWER-SAM-d5');
    const [{ r }] = await sql<{ r: number }>('select count(*)::int r from reactions where id = $1', [rx.d2.onMessage]);
    expect(r).toBe(1);
    // Restore the open days' bodies the unfiltered update changed.
    for (const l of OPEN) await sql('update thread_messages set body = $2 where id = $1', [msg[l].maya, `FIXTURE-HIST-MSG-MAYA-${l}`]);
  });

  it('yesterday stays writable: a message and a reaction', async () => {
    const m = must(await late('maya', 'd1'), 'yesterday message');
    expect(m).toHaveLength(1);
    ok(await as('sam').from('reactions').insert({ user_id: ID.sam, message_id: m[0].id, kind: '😂' }), 'yesterday reaction');
    await sql('delete from thread_messages where id = $1', [m[0].id]);
  });

  it('another couple writing into this couple\'s days gets the RLS error, not PREMIUM_REQUIRED', async () => {
    for (const l of ['d1', 'd2'] as const) {
      const res = await late('eve', l);
      expect(res.error?.code, l).toBe('42501');
      expect(res.error?.message).not.toBe('PREMIUM_REQUIRED');
    }
  });
});

describe('Premium (either member) opens every day; a lapse relocks and deletes nothing', () => {
  const allOpen = async (who: PersonaName) => {
    for (const l of LOCKED) {
      expect((await answersOf(who, cq[l])).length, `${who} ${l} answers`).toBe(2);
      expect((await messagesOf(who, cq[l])).length, `${who} ${l} messages`).toBeGreaterThanOrEqual(2);
      expect((await reactionsById(who, [rx[l].onAnswer, rx[l].onMessage])).length, `${who} ${l} reactions`).toBe(2);
    }
    expect(await fetchVoice(who, voice.d2.answer)).not.toBeNull();
    expect(await fetchVoice(who, voice.d2.message)).not.toBeNull();
    expect(must(await historyDays(as(who)), 'history_days').every((r) => r.locked === false)).toBe(true);
  };
  const allLocked = async (who: PersonaName) => {
    for (const l of LOCKED) {
      expect(await answersOf(who, cq[l]), `${who} ${l}`).toEqual([]);
      expect(await messagesOf(who, cq[l]), `${who} ${l}`).toEqual([]);
    }
    expect(await fetchVoice(who, voice.d2.answer)).toBeNull();
    expect(must(await historyDays(as(who)), 'history_days').filter((r) => r.locked).length).toBe(LOCKED.length);
  };

  it('Sam\'s Premium opens the old days for both partners', async () => {
    await entitle('sam');
    for (const who of PARTNERS) await allOpen(who);
  });

  it('Maya\'s Premium alone opens them too; writing to an old thread then works', async () => {
    await dropEntitlements('sam');
    await entitle('maya');
    for (const who of PARTNERS) await allOpen(who);
    const m = must(
      await as('sam').from('thread_messages').insert({ client_id: randomUUID(), couple_question_id: cq.d5, user_id: ID.sam, body: 'FIXTURE-HIST-PREMIUM-LATE' }).select('id'),
      'premium write',
    );
    expect(m).toHaveLength(1);
    await sql('delete from thread_messages where id = $1', [m[0].id]);
  });

  it('expired entitlement relocks at once', async () => {
    await entitle('maya', '2000-01-01T00:00:00Z');
    for (const who of PARTNERS) await allLocked(who);
  });

  it('is_active false relocks too; Premium again reopens', async () => {
    await entitle('maya', null, false);
    await allLocked('sam');
    await entitle('maya');
    await allOpen('sam');
    await dropEntitlements('maya');
    await allLocked('maya');
  });

  it('nothing was deleted by the lapses (answers, messages, reactions, voice objects)', async () => {
    expect(await totals(couple)).toEqual(before);
  });
});

describe('reveal rule (D13) on top of Premium', () => {
  let old = '';
  let samVoice = '';
  it('Premium Maya cannot read Sam\'s old answer (text or voice) before she answers', async () => {
    await entitle('maya');
    old = await day(couple, TZ, 4);
    samVoice = await take('sam', 'REVEAL');
    // Day −4 is past: the answer Sam gave on that day is seeded by the server (D56: a client gets DAY_ENDED).
    ok(
      await admin
        .from('answers')
        .insert({ couple_question_id: old, user_id: ID.sam, kind: 'voice', body: null, voice_path: samVoice, voice_duration_ms: 5_000 }),
      'sam old voice answer',
    );
    expect(await answersOf('maya', old)).toEqual([]);
    expect(await fetchVoice('maya', samVoice)).toBeNull();
    expect((await answersOf('sam', old)).length).toBe(1);
    expect(await fetchVoice('sam', samVoice)).not.toBeNull();
    const [row] = must(await historyDays(as('maya'), { p_couple_question_id: old }), 'one');
    expect(row).toMatchObject({ my_answered: false, partner_answered: true, locked: false, message_count: 0 });
  });

  it('after Maya answers, both answers and the voice open; a lapse locks the day again', async () => {
    // A client cannot answer day −4 any more (D56): her answer of that day is seeded by the server.
    expectCode(
      await as('maya').from('answers').upsert({ couple_question_id: old, user_id: ID.maya, body: 'FIXTURE-HIST-ANSWER-MAYA-old' }, { onConflict: 'couple_question_id,user_id' }),
      'DAY_ENDED',
    );
    await answer(old, 'maya', 'FIXTURE-HIST-ANSWER-MAYA-old');
    expect((await answersOf('maya', old)).length).toBe(2);
    expect(await fetchVoice('maya', samVoice)).not.toBeNull();
    await dropEntitlements('maya');
    expect(await answersOf('maya', old)).toEqual([]);
    expect(await fetchVoice('maya', samVoice)).toBeNull();
    expect(await fetchVoice('sam', samVoice)).toBeNull();
  });
});

describe('Realtime: a free subscriber gets no events for older-day rows', () => {
  type Event = { table: string; eventType: string; id: string; raw: string };
  let channel: RealtimeChannel | null = null;
  const rtClient = createClient<Database>(stack.url, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const events: Event[] = [];

  /** Polls until `pred` holds (Realtime is asynchronous; no fixed sleeps), up to `ms`. */
  async function until(pred: () => boolean, what: string, ms = 20_000) {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** A server insert on an open day; resolves when Sam's subscription delivers it. */
  async function sentinel(): Promise<void> {
    const id = await message(cq.d1, 'maya', 'FIXTURE-HIST-SENTINEL');
    await until(() => events.some((e) => e.id === id), `sentinel ${id}`);
  }

  beforeAll(async () => {
    await dropEntitlements('maya', 'sam');
    await rtClient.realtime.setAuth(tokenOf('sam'));
    const ch = rtClient.channel(`qa37-${randomUUID()}`);
    for (const table of ['answers', 'thread_messages', 'reactions'] as const) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
        const row = (p.new && Object.keys(p.new).length ? p.new : p.old) as { id?: string };
        events.push({ table, eventType: p.eventType, id: row.id ?? '', raw: JSON.stringify(p) });
      });
    }
    await new Promise<void>((resolve, reject) => {
      ch.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') resolve();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err ?? new Error(status));
      });
    });
    channel = ch;
    // The replication link can take a moment after SUBSCRIBED: send open-day rows until one arrives.
    const end = Date.now() + 30_000;
    for (;;) {
      const id = await message(cq.d1, 'maya', 'FIXTURE-HIST-WARMUP');
      try {
        await until(() => events.some((e) => e.id === id), 'warm-up', 3_000);
        break;
      } catch (e) {
        if (Date.now() > end) throw e;
      }
    }
  }, 60_000);

  afterAll(async () => {
    if (channel) await rtClient.removeChannel(channel);
    rtClient.realtime.disconnect();
    await sql(`delete from thread_messages where body in ('FIXTURE-HIST-SENTINEL', 'FIXTURE-HIST-WARMUP', 'FIXTURE-HIST-RT-OLD', 'FIXTURE-HIST-RT-OPEN', 'FIXTURE-HIST-RT-PREMIUM')`);
  });

  it('positive control: open-day inserts and updates of answers, messages and reactions are delivered', async () => {
    events.length = 0;
    const m = await message(cq.d0, 'sam', 'FIXTURE-HIST-RT-OPEN');
    const r = await react('maya', { message_id: m });
    await sql(`update answers set body = 'FIXTURE-HIST-ANSWER-SAM-d0' where id = $1`, [ans.d0.sam]);
    await until(() => [m, r, ans.d0.sam].every((id) => events.some((e) => e.id === id)), 'open-day events');
    expect(events.find((e) => e.id === ans.d0.sam)).toMatchObject({ table: 'answers', eventType: 'UPDATE' });
  });

  it('no event for locked-day rows: new message, reaction, own and partner answer updates, a new own answer', async () => {
    events.length = 0;
    const lockedIds: string[] = [];
    lockedIds.push(await message(cq.d5, 'maya', 'FIXTURE-HIST-RT-OLD'));
    lockedIds.push(await message(cq.packOld, 'sam', 'FIXTURE-HIST-RT-OLD'));
    lockedIds.push(await react('sam', { message_id: lockedIds[0] }));
    lockedIds.push(await react('maya', { answer_id: ans.d2.sam }, '😂'));
    await sql(`update answers set body = body where id = any($1)`, [[ans.d5.maya, ans.d5.sam, ans.packOld.sam]]);
    lockedIds.push(ans.d5.maya, ans.d5.sam, ans.packOld.sam);
    await sql(`update thread_messages set body = body where id = $1`, [msg.d2.maya]);
    lockedIds.push(msg.d2.maya);
    const d6 = await day(couple, TZ, 6);
    lockedIds.push(await answer(d6, 'sam', 'FIXTURE-HIST-ANSWER-SAM-d6'));
    // Events of one subscription arrive in commit order: once the later open-day row is in, any
    // earlier locked-day event would be too.
    await sentinel();
    const leaked = events.filter((e) => lockedIds.includes(e.id));
    expect(leaked.map((e) => `${e.table}:${e.eventType}`)).toEqual([]);
    const raw = events.map((e) => e.raw).join('\n');
    for (const l of LOCKED) expect(raw).not.toContain(`-${l}"`);
    expect(raw).not.toContain('FIXTURE-HIST-RT-OLD');
    expect(raw).not.toContain('-d6"');
  });

  it('control: the same old-day write is delivered once the couple is Premium (the filter is the lock, not the table)', async () => {
    events.length = 0;
    await entitle('maya');
    const id = await message(cq.d5, 'maya', 'FIXTURE-HIST-RT-PREMIUM');
    await until(() => events.some((e) => e.id === id), 'premium old-day event');
    await dropEntitlements('maya');
    events.length = 0;
    const after = await message(cq.d5, 'maya', 'FIXTURE-HIST-RT-OLD');
    await sentinel();
    expect(events.some((e) => e.id === after)).toBe(false);
  });
});

describe('ended couple archive: the reader\'s own entitlement (D08 + D55)', () => {
  let ended = '';
  let eOld = '';
  let eYest = '';
  beforeAll(async () => {
    // eve + finn were paired above (other couple); give them days, then Finn unpairs.
    const [{ couple_id }] = await sql<{ couple_id: string }>(
      `select couple_id from couple_members where user_id = $1 and left_at is null`,
      [ID.eve],
    );
    ended = couple_id;
    eOld = await day(ended, TZ, 6);
    eYest = await day(ended, TZ, 1);
    for (const c of [eOld, eYest]) {
      await answer(c, 'eve', 'FIXTURE-HIST-ENDED-EVE');
      await answer(c, 'finn', 'FIXTURE-HIST-ENDED-FINN');
      await message(c, 'eve', 'FIXTURE-HIST-ENDED-MSG');
    }
    await entitle('eve');
    ok(await as('finn').rpc('unpair'), 'unpair');
    const [{ status }] = await sql<{ status: string }>('select status from couples where id = $1', [ended]);
    expect(status).toBe('ended');
  });

  it('Eve (own Premium) reads the old day; Finn (free) does not: the ex-partner\'s Premium does not count', async () => {
    expect((await answersOf('eve', eOld)).length).toBe(2);
    expect((await messagesOf('eve', eOld)).length).toBe(1);
    expect(await answersOf('finn', eOld)).toEqual([]);
    expect(await messagesOf('finn', eOld)).toEqual([]);
    expect((await answersOf('finn', eYest)).length).toBe(2);
  });

  it('history_days on the archive is locked per reader', async () => {
    const lockedFor = async (who: PersonaName) =>
      Object.fromEntries(must(await historyDays(as(who), { p_couple_id: ended }), who).map((r) => [r.couple_question_id, r.locked]));
    const e = await lockedFor('eve');
    const f = await lockedFor('finn');
    expect([e[eOld], e[eYest], f[eOld], f[eYest]]).toEqual([false, false, true, false]);
  });

  // QA-39 (MOB-27 + D55): the PDF export's two reads, exactly as src/features/history/api.ts makes them.
  // The app asks for text only on days history_days says are open; even a client that asks for every
  // day (a stale build, a direct call) gets no text of a day locked for the reader.
  it('PDF export path: history_days says which of my days are locked; the text select returns none of them', async () => {
    const exportSelect =
      'id, source, assigned_for, created_at, question:questions(body), answers(user_id, body, created_at), thread_messages(user_id, body, created_at)';
    for (const who of ['eve', 'finn'] as const) {
      const days = must(await historyDays(as(who), { p_couple_id: ended, p_limit: 100, p_offset: 0 }), who);
      const mine = days.filter((d) => d.my_answered);
      const open = mine.filter((d) => !d.locked).map((d) => d.couple_question_id).sort();
      const locked = mine.filter((d) => d.locked).map((d) => d.couple_question_id);
      expect({ who, open, locked }).toEqual(
        who === 'eve' ? { who, open: [eOld, eYest].sort(), locked: [] } : { who, open: [eYest], locked: [eOld] },
      );
      // Every day, not only the open ones: the database still holds the lock.
      const rows = must(
        await as(who).from('couple_questions').select(exportSelect).eq('couple_id', ended).in('id', [eOld, eYest]),
        `${who} export select`,
      );
      expect(rows.length, `${who}: both days listed`).toBe(2);
      const by = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(by[eYest]?.answers.length, `${who} yesterday answers`).toBe(2);
      expect(by[eYest]?.thread_messages.length, `${who} yesterday messages`).toBe(1);
      if (who === 'eve') {
        expect(by[eOld]?.answers.length, 'eve: old day answers').toBe(2);
        expect(by[eOld]?.thread_messages.length, 'eve: old day messages').toBe(1);
      } else {
        expect(by[eOld]?.answers, 'finn: old day answers').toEqual([]);
        expect(by[eOld]?.thread_messages, 'finn: old day messages').toEqual([]);
      }
    }
  });

  it('archive writes stay refused by RLS (read-only, not PREMIUM_REQUIRED)', async () => {
    const res = await as('eve')
      .from('thread_messages')
      .insert({ client_id: randomUUID(), couple_question_id: eYest, user_id: ID.eve, body: 'FIXTURE-HIST-ENDED-LATE' })
      .select('id');
    expect(res.error?.code).toBe('42501');
  });

  it('Eve\'s lapse relocks the old day for her', async () => {
    await dropEntitlements('eve');
    expect(await answersOf('eve', eOld)).toEqual([]);
    expect((await answersOf('eve', eYest)).length).toBe(2);
  });
});
