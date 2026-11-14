// QA-28: D48 little things (BE-44, BE-44b, BE-45; CONTRACTS §2 `send_little_thing`,
// `undo_little_thing`, `little_things_today`, "Little things" table, "Notification prefs"; §3/§4
// `notify` `{"type":"little_thing"}` + `claim_little_thing_pushes`; §5 little-things payload).
// The case list follows the backend's DB tests (supabase/tests/little-things*.test.mjs); here
// everything a client can do goes through supabase-js as the app calls it (PostgREST, real persona
// sessions, the database clock). Time-dependent rules (undo window, sender-local day, push
// eligibility, 10-minute grouping, 1 per type per hour, D24 cap, quiet hours, stale) run through
// the private clock-pinned `*_at` variants with the persona's JWT claims (helpers.callAs), on
// far-future days so the database-clock claim never sees them. The last block runs the real
// `notify` handler under Deno (qa/functions/notify_little_things.ts) with a recording transport.
// QA-36 (BE-53): `notification_prefs.little_things_sound` through PostgREST + the real handler;
// the claim-level caps with sound off are covered by supabase/tests/little-things-sound.test.mjs.
// Acceptance (BACKLOG QA-28): fails if a free user can send an 11th kiss in a day.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PostgrestError } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Database } from '../../src/types/database';
import {
  ID,
  PERSONAS,
  admin,
  anon,
  as,
  callAs,
  canForgeJwt,
  expectCode,
  expectPermissionDenied,
  loose,
  must,
  noSubject,
  ok,
  pair,
  resetWorld,
  sql,
} from './helpers';
import type { PersonaName } from './personas';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stack = inject('stack');
const KINDS = ['hug', 'kiss', 'goodnight', 'good_morning', 'miss_you'];
const ALL: PersonaName[] = ['maya', 'sam', 'lea', 'eve', 'finn', 'noor'];
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const at = (base: string, ms: number) => new Date(new Date(base).getTime() + ms).toISOString();

type Sent = { id: string; same_time: boolean; at_limit: boolean };
type State = { kind: string; at_limit: boolean; more_with_premium: boolean };
type Claim = {
  user_id: string;
  claim_id: string;
  silent: boolean;
  partner_name: string;
  gesture: string;
  counts: Record<string, number>;
};

// ───────────────────────────── helpers ─────────────────────────────

const send = (who: PersonaName, kind: string, amount?: number | null, client?: string) =>
  as(who).rpc('send_little_thing', {
    p_kind: kind,
    ...(amount !== undefined ? { p_amount: amount as number } : {}),
    ...(client ? { p_client_id: client } : {}),
  });
const sent = async (who: PersonaName, kind: string, amount?: number | null, client?: string) =>
  must(await send(who, kind, amount, client), `${who} send ${kind}`) as Sent;
const undo = (who: PersonaName, id: string) => as(who).rpc('undo_little_thing', { p_id: id });
const today = async (who: PersonaName) =>
  Object.fromEntries(
    (must(await as(who).rpc('little_things_today'), `${who} today`) as State[]).map((r) => [
      r.kind,
      r,
    ]),
  ) as Record<string, State>;

/** LITTLE_THING_LIMIT with its JSON `details` (CONTRACTS §2). */
function expectLimit(
  res: { error: PostgrestError | null },
  kind: string,
  moreWithPremium: boolean,
) {
  expectCode(res, 'LITTLE_THING_LIMIT');
  expect(JSON.parse(res.error!.details)).toEqual({ kind, more_with_premium: moreWithPremium });
}

/** private.send_little_thing_at as the persona (JWT claims set), clock pinned. */
async function sendAt(
  who: PersonaName,
  now: string,
  kind: string,
  amount: number | null = 1,
  client: string | null = null,
): Promise<Sent> {
  const r = await callAs<Sent>(
    who,
    'select (r).id, (r).same_time, (r).at_limit from (select private.send_little_thing_at($1, $2, $3, $4::timestamptz) r) s',
    [kind, amount, client, now],
  );
  if (r.raised) throw new Error(`${who} send ${kind} at ${now}: ${r.raised}`);
  return r.rows![0];
}
const sendAtErr = async (...a: Parameters<typeof sendAt>) => {
  try {
    await sendAt(...a);
    return null;
  } catch (e) {
    return (e as Error).message.split(': ').at(-1)!;
  }
};
const undoAt = (who: PersonaName, now: string, id: string) =>
  callAs<State>(who, 'select * from private.undo_little_thing_at($1, $2::timestamptz)', [id, now]);
const todayAt = async (who: PersonaName, now: string) => {
  const r = await callAs<State>(who, 'select * from private.little_things_today_at($1::timestamptz)', [now]);
  if (r.raised) throw new Error(r.raised);
  return Object.fromEntries(r.rows!.map((x) => [x.kind, x])) as Record<string, State>;
};
const claim = (now: string) =>
  sql<Claim>('select * from private.claim_little_thing_pushes_at($1::timestamptz)', [now]);
const claimFor = async (who: PersonaName, now: string) =>
  (await claim(now)).filter((r) => r.user_id === ID[who]);
const due = async (now: string) =>
  (await sql<{ b: boolean }>('select private.little_things_due($1::timestamptz) b', [now]))[0].b;
const outcome = async (id: string) =>
  (
    await sql<{ outcome: string }>(
      'select outcome from private.little_thing_dispatch where little_thing_id = $1',
      [id],
    )
  )[0]?.outcome ?? null;
const undoneAt = async (id: string) =>
  must(await admin.from('little_things').select('undone_at').eq('id', id).single(), 'row')
    .undone_at;
/** Another push type through the shared claim (D24 cap), as `notify` does for the other types. */
const claimOther = async (who: PersonaName, type: string, now: string) =>
  (
    await sql<{ claim_id: string | null }>(
      `select (cp).claim_id from (select private.claim_push($1, $2::public.push_type, $3, null, $4::date, $5::timestamptz) cp) s`,
      [ID[who], type, randomUUID(), now.slice(0, 10), now],
    )
  )[0].claim_id;
const setPrefs = async (
  who: PersonaName,
  prefs: Database['public']['Tables']['notification_prefs']['Update'],
) =>
  ok(
    await as(who).from('notification_prefs').update(prefs).eq('user_id', ID[who]),
    `${who} prefs`,
  );
const setTz = async (who: PersonaName, tz: string) =>
  ok(await admin.from('profiles').update({ timezone: tz }).eq('id', ID[who]), `${who} tz`);

/** Sends as `who` stamped `secondsAgo` before the database clock (so the real claim sees it). */
async function sendAgo(who: PersonaName, secondsAgo: number, kind: string, amount = 1): Promise<Sent> {
  const r = await callAs<Sent>(
    who,
    `select (r).id, (r).same_time, (r).at_limit
       from (select private.send_little_thing_at($1, $2, null, now() - make_interval(secs => $3)) r) s`,
    [kind, amount, secondsAgo],
  );
  if (r.raised) throw new Error(`${who} send ${kind}: ${r.raised}`);
  return r.rows![0];
}
const PREF_DEFAULTS = {
  little_things: true,
  little_things_sound: true,
  replies: true,
  partner_answered: true,
  nudges: true,
  quiet_start: '23:00:00',
  quiet_end: '07:00:00',
};

/** Fresh couples: maya + sam (free), eve + finn (Premium through Eve), lea solo, noor none. */
async function world() {
  await resetWorld();
  await sql('delete from public.push_log where user_id = any($1::uuid[])', [ALL.map((p) => ID[p])]);
  for (const p of ALL) {
    await setTz(p, 'UTC');
    ok(
      await admin.from('notification_prefs').update(PREF_DEFAULTS).eq('user_id', ID[p]),
      'prefs',
    );
  }
  const free = await pair('maya', 'sam');
  const pro = await pair('eve', 'finn');
  ok(
    await admin.from('entitlements').upsert({ user_id: ID.eve, is_active: true, expires_at: null }),
    'entitle eve',
  );
  must(await as('lea').rpc('create_couple', { p_stage: 'dating' }), 'lea solo');
  return { free, pro };
}

afterAll(async () => {
  for (const p of ALL) await setTz(p, PERSONAS[p].timezone);
  await resetWorld();
});

// ───────────────────────────── BE-44: send, limits, today ─────────────────────────────

describe('send_little_thing and limits (BE-44, D48)', () => {
  let free: string;
  beforeAll(async () => {
    ({ free } = await world());
  });

  it.each([
    ['kiss', 6, 'kiss batch of 6'],
    ['kiss', 0, 'kiss amount 0'],
    ['kiss', -1, 'negative amount'],
    ['hug', 5001, 'hug over 5 s'],
    ['hug', 0, 'hug of 0 ms'],
    ['goodnight', 2, 'goodnight amount 2'],
    ['miss_you', 2, 'miss-you amount 2'],
    ['wink', 1, 'unknown kind'],
    ['KISS', 1, 'kind in capitals'],
    ['', 1, 'empty kind'],
  ])('%s %s → INVALID_LITTLE_THING (%s)', async (kind, amount) => {
    expectCode(await send('finn', kind, amount as number), 'INVALID_LITTLE_THING');
  });

  it('returns {id, same_time, at_limit}; the partner reads the row with the documented columns', async () => {
    const r = await sent('maya', 'miss_you');
    expect(Object.keys(r).sort()).toEqual(['at_limit', 'id', 'same_time']);
    expect(r).toMatchObject({ same_time: false, at_limit: false });
    const row = must(
      await as('sam').from('little_things').select('*').eq('id', r.id).single(),
      'sam reads',
    );
    expect(Object.keys(row).sort()).toEqual(
      [
        'amount',
        'client_id',
        'couple_id',
        'created_at',
        'id',
        'kind',
        'local_date',
        'same_time',
        'sender_id',
        'source',
        'undone_at',
      ].sort(),
    );
    expect(row).toMatchObject({
      couple_id: free,
      sender_id: ID.maya,
      kind: 'miss_you',
      amount: 1,
      same_time: false,
      undone_at: null,
      source: 'app', // BE-60: the app path always writes 'app'
    });
  });

  it('a free user cannot send an 11th kiss in a day (kisses counted per kiss)', async () => {
    const first = await sent('sam', 'kiss', 5);
    expect(first.at_limit).toBe(false);
    const row = must(
      await as('maya').from('little_things').select('amount').eq('id', first.id).single(),
      'batch row',
    );
    expect(row.amount).toBe(5); // one row per batch
    expect((await sent('sam', 'kiss', 5)).at_limit).toBe(true);
    expectLimit(await send('sam', 'kiss', 1), 'kiss', true);
    expectLimit(await send('sam', 'kiss'), 'kiss', true); // default amount 1
    const rows = must(
      await as('sam').from('little_things').select('amount').eq('sender_id', ID.sam).eq('kind', 'kiss'),
      'sam kisses',
    );
    expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(10); // refused sends write nothing
    const t = await today('sam');
    expect(t.kiss).toEqual({ kind: 'kiss', at_limit: true, more_with_premium: true });
    expect(t.hug.at_limit).toBe(false);
  });

  it('a kiss batch that does not fit is refused whole; then the rest fits and reports at_limit', async () => {
    await sent('maya', 'kiss', 5);
    await sent('maya', 'kiss', 3);
    expect((await today('maya')).kiss.at_limit).toBe(false); // 8 used: not at limit
    expectLimit(await send('maya', 'kiss', 3), 'kiss', true); // 8 + 3 > 10: nothing sent
    expect((await sent('maya', 'kiss', 2)).at_limit).toBe(true);
    expectLimit(await send('maya', 'kiss', 1), 'kiss', true);
  });

  it('limits are per sender: the partner has his own count', async () => {
    // Sam is at 10 kisses (above); Maya too now. Neither blocks the other's hugs.
    expect((await sent('maya', 'hug', 1)).at_limit).toBe(false);
  });

  it('free hugs: 5 a day whatever the length; the 6th is LITTLE_THING_LIMIT', async () => {
    // Maya sent 1 hug in the previous test.
    for (const ms of [5000, 1, 2500]) expect((await sent('maya', 'hug', ms)).at_limit).toBe(false);
    expect((await sent('maya', 'hug', 200)).at_limit).toBe(true);
    expectLimit(await send('maya', 'hug', 100), 'hug', true);
  });

  it('free miss-yous: 3 a day (one already sent in the first test)', async () => {
    await sent('maya', 'miss_you');
    expect((await sent('maya', 'miss_you')).at_limit).toBe(true);
    expectLimit(await send('maya', 'miss_you'), 'miss_you', true);
  });

  it('goodnight and good morning: once a day, no Premium upsell', async () => {
    expect((await sent('maya', 'goodnight')).at_limit).toBe(true);
    expectLimit(await send('maya', 'goodnight'), 'goodnight', false);
    expect((await sent('maya', 'good_morning')).at_limit).toBe(true);
    expectLimit(await send('maya', 'good_morning'), 'good_morning', false);
    const t = await today('maya');
    expect(t.goodnight).toEqual({ kind: 'goodnight', at_limit: true, more_with_premium: false });
    expect(t.good_morning).toEqual({ kind: 'good_morning', at_limit: true, more_with_premium: false });
  });

  it('little_things_today: five rows in contract order, {kind, at_limit, more_with_premium} only', async () => {
    const rows = must(await as('maya').rpc('little_things_today'), 'today') as State[];
    expect(rows.map((r) => r.kind)).toEqual(KINDS);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(['at_limit', 'kind', 'more_with_premium']);
    expect(rows.every((r) => r.at_limit)).toBe(true); // Maya used every kind today
    expect(rows.filter((r) => r.more_with_premium).map((r) => r.kind)).toEqual(['hug', 'kiss', 'miss_you']);
    // Sam: only kisses used.
    const sam = await today('sam');
    expect(KINDS.filter((k) => sam[k].at_limit)).toEqual(['kiss']);
  });

  it('Premium (couple-level, the partner of the subscriber): 50 kisses, then the limit without upsell', async () => {
    for (let i = 0; i < 9; i++) expect((await sent('finn', 'kiss', 5)).at_limit).toBe(false);
    expect((await sent('finn', 'kiss', 5)).at_limit).toBe(true);
    expectLimit(await send('finn', 'kiss', 1), 'kiss', false);
    expect((await today('finn')).kiss).toEqual({ kind: 'kiss', at_limit: true, more_with_premium: false });
  });

  it('Premium: 30 hugs and 15 miss-yous; still 1 goodnight', async () => {
    for (let i = 0; i < 29; i++) await sent('eve', 'hug', 1000);
    expect((await sent('eve', 'hug', 1000)).at_limit).toBe(true);
    expectLimit(await send('eve', 'hug', 1000), 'hug', false);
    for (let i = 0; i < 14; i++) await sent('eve', 'miss_you');
    expect((await sent('eve', 'miss_you')).at_limit).toBe(true);
    expectLimit(await send('eve', 'miss_you'), 'miss_you', false);
    await sent('eve', 'goodnight');
    expectLimit(await send('eve', 'goodnight'), 'goodnight', false);
  });

  it('a lapse drops the limit to the free numbers; what was sent stays', async () => {
    ok(
      await admin
        .from('entitlements')
        .update({ is_active: false, expires_at: '2000-01-01T00:00:00Z' })
        .eq('user_id', ID.eve),
      'lapse',
    );
    try {
      const t = await today('eve');
      expect(t.hug).toEqual({ kind: 'hug', at_limit: true, more_with_premium: true });
      expect(t.kiss).toEqual({ kind: 'kiss', at_limit: false, more_with_premium: true });
      expectLimit(await send('eve', 'hug', 1000), 'hug', true);
      const n = must(
        await as('eve').from('little_things').select('id').eq('sender_id', ID.eve).eq('kind', 'hug'),
        'eve hugs',
      ).length;
      expect(n).toBe(30);
    } finally {
      ok(
        await admin.from('entitlements').update({ is_active: true, expires_at: null }).eq('user_id', ID.eve),
        'restore',
      );
    }
  });

  it('invalid input is refused for a paired user too, and writes nothing', async () => {
    const before = must(await as('finn').from('little_things').select('id'), 'before').length;
    expectCode(await send('finn', 'hug', 5001), 'INVALID_LITTLE_THING');
    expectCode(await send('finn', 'wink', 1), 'INVALID_LITTLE_THING');
    expect(must(await as('finn').from('little_things').select('id'), 'after').length).toBe(before);
  });

  it('a null amount means 1', async () => {
    const r = await sent('finn', 'good_morning', null);
    const row = must(await as('finn').from('little_things').select('amount').eq('id', r.id).single(), 'r');
    expect(row.amount).toBe(1);
  });

  it('NOT_PAIRED: a solo couple cannot send; no couple → little_things_today NOT_PAIRED', async () => {
    expectCode(await send('lea', 'hug', 100), 'NOT_PAIRED');
    expectCode(await as('lea').rpc('little_things_today'), 'NOT_PAIRED');
    expectCode(await send('noor', 'kiss', 1), 'NOT_PAIRED');
    expectCode(await as('noor').rpc('little_things_today'), 'NOT_PAIRED');
  });

  it.skipIf(!canForgeJwt)('NOT_AUTHENTICATED: authenticated JWT without a user', async () => {
    const ghost = noSubject();
    expectCode(await ghost.rpc('send_little_thing', { p_kind: 'hug', p_amount: 1 }), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('little_things_today'), 'NOT_AUTHENTICATED');
    expectCode(await ghost.rpc('undo_little_thing', { p_id: randomUUID() }), 'NOT_AUTHENTICATED');
  });

  it('anon cannot call any of the three RPCs (42501)', async () => {
    expectPermissionDenied(await anon.rpc('send_little_thing', { p_kind: 'hug', p_amount: 1 }));
    expectPermissionDenied(await anon.rpc('little_things_today'));
    expectPermissionDenied(await anon.rpc('undo_little_thing', { p_id: randomUUID() }));
  });

  it('the clock-pinned private variants are not reachable through the API', async () => {
    for (const fn of ['send_little_thing_at', 'undo_little_thing_at', 'little_things_today_at']) {
      const res = await loose(as('maya')).rpc(fn, {});
      expect(res.error, fn).not.toBeNull();
      expect(res.data).toBeNull();
    }
  });
});

// ───────────────────────────── sender-local day ─────────────────────────────

describe('limits per sender-local day (profile timezone)', () => {
  beforeAll(world);

  it('New York: still the same day after UTC midnight; reset at the sender\'s local midnight', async () => {
    await setTz('maya', 'America/New_York');
    const D1 = '2031-03-10T15:00:00Z'; // 11:00 New York
    await sendAt('maya', D1, 'kiss', 5);
    expect((await sendAt('maya', at(D1, MIN), 'kiss', 5)).at_limit).toBe(true);
    expect(await sendAtErr('maya', at(D1, 2 * MIN), 'kiss', 1)).toBe('LITTLE_THING_LIMIT');
    expect(await sendAtErr('maya', '2031-03-11T03:30:00Z', 'kiss', 1)).toBe('LITTLE_THING_LIMIT'); // 23:30 NY
    expect((await sendAt('maya', '2031-03-11T04:30:00Z', 'kiss', 1)).at_limit).toBe(false); // 00:30 NY
    const t = await todayAt('maya', '2031-03-11T04:31:00Z');
    expect(t.kiss.at_limit).toBe(false);
    const day = must(
      await as('maya').from('little_things').select('local_date').eq('sender_id', ID.maya).order('created_at'),
      'dates',
    ).map((r) => r.local_date);
    expect(day).toEqual(['2031-03-10', '2031-03-10', '2031-03-11']);
  });

  it('the partner in Tokyo counts on his own day', async () => {
    await setTz('sam', 'Asia/Tokyo');
    const r = await sendAt('sam', '2031-03-10T15:00:00Z', 'kiss', 5); // 00:00 Mar 11 Tokyo
    const row = must(await as('sam').from('little_things').select('local_date').eq('id', r.id).single(), 'r');
    expect(row.local_date).toBe('2031-03-11');
  });
});

// ───────────────────────────── undo ─────────────────────────────

describe('undo_little_thing (BE-44, BE-44b)', () => {
  beforeAll(world);

  it('undo within 5 s (database clock): returns the five-kind state, gives the count back, keeps the row', async () => {
    await sent('maya', 'kiss', 5);
    const b = await sent('maya', 'kiss', 5);
    expect(b.at_limit).toBe(true);
    const st = must(await undo('maya', b.id), 'undo') as State[];
    expect(st.map((s) => s.kind)).toEqual(KINDS);
    expect(st.find((s) => s.kind === 'kiss')).toEqual({ kind: 'kiss', at_limit: false, more_with_premium: true });
    const row = must(await as('sam').from('little_things').select('undone_at').eq('id', b.id).single(), 'partner sees row');
    expect(row.undone_at).not.toBeNull(); // the row stays (realtime UPDATE), partner drops it
    expect((await sent('maya', 'kiss', 5)).at_limit).toBe(true); // the 5 kisses came back
    expectLimit(await send('maya', 'kiss', 1), 'kiss', true);
  });

  it('undoing an undone send again is idempotent (state, no error)', async () => {
    const r = await sent('maya', 'hug', 100);
    must(await undo('maya', r.id), 'first');
    const again = must(await undo('maya', r.id), 'again') as State[];
    expect(again).toHaveLength(5);
  });

  it('only the sender: partner, other couple and unknown id all get INVALID_LITTLE_THING', async () => {
    const r = await sent('maya', 'hug', 100);
    expectCode(await undo('sam', r.id), 'INVALID_LITTLE_THING');
    expectCode(await undo('eve', r.id), 'INVALID_LITTLE_THING');
    expectCode(await undo('maya', randomUUID()), 'INVALID_LITTLE_THING');
    expect(await undoneAt(r.id)).toBeNull();
  });

  it('more than 5 s after the send → UNDO_EXPIRED, nothing changes (database clock)', async () => {
    const old = await sendAgo('maya', 6, 'hug', 100);
    expectCode(await undo('maya', old.id), 'UNDO_EXPIRED');
    expect(await undoneAt(old.id)).toBeNull();
  });

  it('the window boundary (pinned): exactly 5 s succeeds, 5.001 s is UNDO_EXPIRED', async () => {
    const H = '2031-04-01T12:00:00Z';
    const a = await sendAt('finn', H, 'hug', 100);
    const b = await sendAt('finn', at(H, 1), 'hug', 100);
    expect((await undoAt('finn', at(H, 5 * SEC), a.id)).raised).toBeUndefined();
    expect((await undoAt('finn', at(H, 6 * SEC + 1), b.id)).raised).toBe('UNDO_EXPIRED');
  });

  it('BE-44b: the 11th undo of the sender-local day is UNDO_EXPIRED; the gesture stays sent and counts', async () => {
    const D = '2031-05-01T10:00:00Z';
    let last = '';
    for (let i = 1; i <= 11; i++) {
      const s = await sendAt('sam', at(D, i * 10 * SEC), 'hug', 100);
      const u = await undoAt('sam', at(D, i * 10 * SEC + 2 * SEC), s.id);
      if (i <= 10) expect(u.raised, `undo ${i}`).toBeUndefined();
      else expect(u.raised).toBe('UNDO_EXPIRED');
      last = s.id;
    }
    expect(await undoneAt(last)).toBeNull();
    const t = await todayAt('sam', at(D, 200 * SEC));
    expect(t.hug.at_limit).toBe(false); // 1 of 5 hugs counted
    const undone = must(
      await as('sam').from('little_things').select('id').eq('sender_id', ID.sam).eq('local_date', '2031-05-01').not('undone_at', 'is', null),
      'undone',
    );
    expect(undone).toHaveLength(10);
    // Re-undoing an already undone gesture stays idempotent after the cap.
    expect((await undoAt('sam', at(D, 201 * SEC), undone[0].id)).raised).toBeUndefined();
    // Per sender: the partner can still undo that day.
    const p = await sendAt('maya', at(D, 300 * SEC), 'kiss', 1);
    expect((await undoAt('maya', at(D, 302 * SEC), p.id)).raised).toBeUndefined();
    // The next sender-local day starts again.
    const n = await sendAt('sam', '2031-05-02T10:00:00Z', 'kiss', 1);
    expect((await undoAt('sam', '2031-05-02T10:00:02Z', n.id)).raised).toBeUndefined();
  });

  it('BE-44b: the undo cap holds on the database clock too (public RPC, 10 loops then refused)', async () => {
    // Today on the real clock: Finn (Premium, 30 hugs) has undone nothing yet today.
    let refused: PostgrestError | null = null;
    let lastId = '';
    for (let i = 1; i <= 11; i++) {
      const s = await sent('finn', 'hug', 100);
      const u = await undo('finn', s.id);
      if (i <= 10) ok(u, `undo ${i}`);
      else refused = u.error;
      lastId = s.id;
    }
    expectCode({ error: refused }, 'UNDO_EXPIRED');
    expect(await undoneAt(lastId)).toBeNull();
  });

  it('a client_id retry returns the first result and counts once (even after an undo, other kind/amount)', async () => {
    const cid = randomUUID();
    const first = await sent('eve', 'kiss', 4, cid);
    const again = await sent('eve', 'kiss', 4, cid);
    const other = await sent('eve', 'hug', 1000, cid);
    expect(again.id).toBe(first.id);
    expect(other.id).toBe(first.id);
    must(await undo('eve', first.id), 'undo');
    expect((await sent('eve', 'kiss', 4, cid)).id).toBe(first.id);
    const rows = must(await as('eve').from('little_things').select('id').eq('client_id', cid), 'rows');
    expect(rows).toHaveLength(1);
  });
});

// ───────────────────────────── same-time hug ─────────────────────────────

describe('same_time (server decides, 10 s)', () => {
  beforeAll(world);

  it('the partner\'s hug right after mine is same_time (database clock); stored on the row for realtime', async () => {
    expect((await sent('eve', 'hug', 1000)).same_time).toBe(false);
    const r = await sent('finn', 'hug', 3000);
    expect(r.same_time).toBe(true);
    const row = must(await as('eve').from('little_things').select('same_time').eq('id', r.id).single(), 'r');
    expect(row.same_time).toBe(true);
  });

  it('pinned: 10 s yes, 11 s no; undone partner hug, kiss, own hugs and other couples do not count', async () => {
    const S = '2031-06-01T12:00:00Z';
    await sendAt('maya', S, 'hug', 1000);
    expect((await sendAt('sam', at(S, 10 * SEC), 'hug', 1000)).same_time).toBe(true);
    expect((await sendAt('maya', at(S, 21 * SEC), 'hug', 1000)).same_time).toBe(false);
    const lone = await sendAt('sam', at(S, 200 * SEC), 'hug', 1000);
    expect((await undoAt('sam', at(S, 201 * SEC), lone.id)).raised).toBeUndefined();
    expect((await sendAt('maya', at(S, 202 * SEC), 'kiss', 1)).same_time).toBe(false);
    expect((await sendAt('maya', at(S, 203 * SEC), 'hug', 1000)).same_time).toBe(false);
    // Maya's own hug at 203 s does not make her next one same-time.
    const T = '2031-06-02T12:00:00Z';
    await sendAt('eve', T, 'hug', 1000); // another couple
    expect((await sendAt('maya', at(T, SEC), 'hug', 1000)).same_time).toBe(false);
  });
});

// ───────────────────────────── table access ─────────────────────────────

describe('little_things table: read own couple, no direct writes', () => {
  let free: string;
  let gesture: string;
  beforeAll(async () => {
    ({ free } = await world());
    gesture = (await sent('sam', 'hug', 500)).id;
  });

  it('both members read the couple\'s rows; another couple sees none', async () => {
    for (const p of ['maya', 'sam'] as const) {
      const rows = must(await as(p).from('little_things').select('id, couple_id'), p);
      expect(rows.map((r) => r.id)).toContain(gesture);
      expect(rows.every((r) => r.couple_id === free)).toBe(true);
    }
    expect(must(await as('eve').from('little_things').select('id').eq('couple_id', free), 'eve')).toEqual([]);
    expect(must(await as('noor').from('little_things').select('id'), 'noor')).toEqual([]);
  });

  it('anon is denied', async () => {
    expectPermissionDenied(await anon.from('little_things').select('id'));
  });

  it('no direct insert, update (no un-undo, no count tampering) or delete', async () => {
    expectPermissionDenied(
      await as('maya').from('little_things').insert({
        couple_id: free,
        sender_id: ID.maya,
        kind: 'kiss',
        amount: 1,
        local_date: '2031-01-01',
      }),
    );
    expectPermissionDenied(await as('sam').from('little_things').update({ amount: 0 }).eq('id', gesture));
    expectPermissionDenied(await as('sam').from('little_things').delete().eq('id', gesture));
    const row = must(await admin.from('little_things').select('amount').eq('id', gesture).single(), 'r');
    expect(row.amount).toBe(500);
  });

  it('after unpair the gestures stay readable (archive) and nobody can send', async () => {
    ok(await as('maya').rpc('unpair'), 'unpair');
    const rows = must(await as('maya').from('little_things').select('id'), 'archive');
    expect(rows.map((r) => r.id)).toContain(gesture);
    expectCode(await send('maya', 'hug', 100), 'NOT_PAIRED');
    expectCode(await send('sam', 'hug', 100), 'NOT_PAIRED');
  });
});

// ───────────────────────────── toggle ─────────────────────────────

describe('notification_prefs.little_things (BE-45 toggle)', () => {
  beforeAll(world);

  it('defaults on; the owner switches it off and on through RLS; the partner cannot', async () => {
    expect(must(await as('sam').from('notification_prefs').select('little_things').single(), 'r').little_things).toBe(true);
    await setPrefs('sam', { little_things: false });
    expect(must(await as('sam').from('notification_prefs').select('little_things').single(), 'r').little_things).toBe(false);
    const res = await as('maya').from('notification_prefs').update({ little_things: true }).eq('user_id', ID.sam).select('user_id');
    expect(must(res, 'maya on sam').length).toBe(0);
    expect(must(await admin.from('notification_prefs').select('little_things').eq('user_id', ID.sam).single(), 'r').little_things).toBe(false);
    ok(
      await as('sam').from('notification_prefs').upsert({ user_id: ID.sam, little_things: true }, { onConflict: 'user_id' }),
      'upsert on',
    );
    expect(must(await as('sam').from('notification_prefs').select('little_things').single(), 'r').little_things).toBe(true);
  });
});

describe('notification_prefs.little_things_sound (BE-53 "Little things sounds" switch)', () => {
  beforeAll(world);

  it('defaults on; the owner switches it through PostgREST (update and the app upsert); partner, other couple and anon cannot', async () => {
    expect(must(await as('sam').from('notification_prefs').select('little_things_sound').single(), 'r').little_things_sound).toBe(true);
    await setPrefs('sam', { little_things_sound: false });
    expect(must(await as('sam').from('notification_prefs').select('little_things_sound').single(), 'r').little_things_sound).toBe(false);
    for (const who of ['maya', 'eve'] as const) {
      const res = await as(who).from('notification_prefs').update({ little_things_sound: true }).eq('user_id', ID.sam).select('user_id');
      expect(must(res, `${who} on sam`).length, who).toBe(0);
      const read = await as(who).from('notification_prefs').select('little_things_sound').eq('user_id', ID.sam);
      expect(must(read, `${who} reads sam`), who).toEqual([]);
    }
    expect((await anon.from('notification_prefs').update({ little_things_sound: true }).eq('user_id', ID.sam).select('user_id')).data ?? []).toEqual([]);
    expect(must(await admin.from('notification_prefs').select('little_things_sound').eq('user_id', ID.sam).single(), 'r').little_things_sound).toBe(false);
    ok(
      await as('sam').from('notification_prefs').upsert({ user_id: ID.sam, little_things_sound: true }, { onConflict: 'user_id' }),
      'upsert on',
    );
    expect(must(await as('sam').from('notification_prefs').select('little_things_sound').single(), 'r').little_things_sound).toBe(true);
    // Not nullable: the app cannot clear it.
    expect((await as('sam').from('notification_prefs').update({ little_things_sound: null as never }).eq('user_id', ID.sam)).error).not.toBeNull();
  });
});

// ───────────────────────────── BE-45: push claim ─────────────────────────────

describe('little-things push claim (BE-45, D48, D24; pinned clock)', () => {
  beforeAll(world);

  it('eligible 10 s after the send; a kiss batch and a hug go out as one push; counts and lead gesture', async () => {
    const T1 = '2031-03-01T12:00:00Z';
    const k1 = await sendAt('maya', T1, 'kiss', 3);
    const h1 = await sendAt('maya', at(T1, 3 * SEC), 'hug', 2000);
    expect(await claimFor('sam', at(T1, 9 * SEC))).toEqual([]);
    expect(await due(at(T1, 9 * SEC))).toBe(false);
    expect(await due(at(T1, 13 * SEC))).toBe(true);
    const c = await claimFor('sam', at(T1, 13 * SEC));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      silent: false,
      partner_name: PERSONAS.maya.display_name,
      gesture: 'hug',
      counts: { kiss: 3, hug: 1 },
    });
    expect(await outcome(k1.id)).toBe('pushed');
    expect(await outcome(h1.id)).toBe('pushed');
    const [log] = await sql<Record<string, unknown>>('select * from public.push_log where id = $1', [c[0].claim_id]);
    expect(log).toMatchObject({ user_id: ID.sam, type: 'little_thing', status: 'claimed', couple_question_id: null });
    expect([k1.id, h1.id]).toContain(log.record_id); // newest: see the #206 case below
    expect(JSON.stringify(log)).not.toMatch(/Maya|kiss|hug/);
    expect(await claimFor('sam', at(T1, 14 * SEC))).toEqual([]); // idempotent
    expect(await undoneAt(k1.id)).toBeNull();
    // Senders never get their own gesture.
    expect(await claimFor('maya', at(T1, 15 * SEC))).toEqual([]);
  });

  it('within 10 min after a push: held, then one grouped push; a kind pushed < 1 h ago is dropped', async () => {
    const T1 = '2031-03-01T12:00:00Z';
    const m1 = await sendAt('maya', at(T1, 2 * MIN), 'miss_you');
    const k2 = await sendAt('maya', at(T1, 3 * MIN), 'kiss', 2);
    const g1 = await sendAt('maya', at(T1, 4 * MIN), 'good_morning');
    expect(await claimFor('sam', at(T1, 5 * MIN))).toEqual([]);
    expect(await due(at(T1, 5 * MIN))).toBe(false);
    expect(await outcome(m1.id)).toBeNull();
    expect(await due(at(T1, 10 * MIN + 13 * SEC))).toBe(true);
    const c = await claimFor('sam', at(T1, 10 * MIN + 13 * SEC));
    expect(c).toHaveLength(1);
    expect(c[0].counts).toEqual({ miss_you: 1, good_morning: 1 });
    expect(c[0].gesture).toBe('good_morning');
    expect([await outcome(k2.id), await outcome(m1.id), await outcome(g1.id)]).toEqual(['type_cap', 'pushed', 'pushed']);
  });

  it('1 push per type per hour: only a capped kind → no push; after the hour it pushes again', async () => {
    const T1 = '2031-03-01T12:00:00Z';
    const k3 = await sendAt('maya', at(T1, 25 * MIN), 'kiss', 1);
    expect(await claimFor('sam', at(T1, 25 * MIN + 13 * SEC))).toEqual([]);
    expect(await outcome(k3.id)).toBe('type_cap');
    const k4 = await sendAt('maya', at(T1, HOUR + 5 * SEC), 'kiss', 1);
    const c = await claimFor('sam', at(T1, HOUR + 15 * SEC));
    expect(c.map((x) => x.counts)).toEqual([{ kiss: 1 }]);
    expect(await outcome(k4.id)).toBe('pushed');
  });

  it('D24: the four-a-day cap is shared both ways with every other type', async () => {
    const T2 = '2031-03-04T12:00:00Z';
    expect(await claimOther('finn', 'nudge', at(T2, -3 * HOUR))).not.toBeNull();
    expect(await claimOther('finn', 'partner_answered', at(T2, -2 * HOUR))).not.toBeNull();
    expect(await claimOther('finn', 'partner_joined', at(T2, -HOUR))).not.toBeNull();
    await sendAt('eve', T2, 'hug', 500);
    expect(await claimFor('finn', at(T2, 12 * SEC))).toHaveLength(1); // the 4th push of the day
    expect(await claimOther('finn', 'both_answered', at(T2, MIN))).toBeNull(); // little things count
    const late = await sendAt('eve', at(T2, 11 * MIN), 'miss_you');
    expect(await claimFor('finn', at(T2, 11 * MIN + 12 * SEC))).toEqual([]);
    expect(await outcome(late.id)).toBe('daily_cap'); // dropped, not queued
    expect(await claimFor('finn', at(T2, 20 * MIN))).toEqual([]);
    const next = await sendAt('eve', at(T2, 13 * HOUR), 'miss_you'); // next UTC day
    expect(await claimFor('finn', at(T2, 13 * HOUR + 12 * SEC))).toHaveLength(1);
    expect(await outcome(next.id)).toBe('pushed');
  });

  it('quiet hours (recipient-local): claimed silent and counted; custom quiet hours honoured', async () => {
    const T3 = '2031-03-07T23:30:00Z';
    await setTz('sam', 'Europe/Berlin'); // 00:30 local, inside 23:00–07:00
    await sendAt('maya', T3, 'goodnight');
    let c = await claimFor('sam', at(T3, 12 * SEC));
    expect(c).toHaveLength(1);
    expect(c[0].silent).toBe(true);
    const [log] = await sql<{ d: string }>('select local_date::text d from public.push_log where id = $1', [c[0].claim_id]);
    expect(log.d).toBe('2031-03-08');
    await setPrefs('sam', { quiet_start: '01:00', quiet_end: '02:00' });
    await sendAt('maya', at(T3, 12 * MIN), 'hug', 100); // 00:42 Berlin
    c = await claimFor('sam', at(T3, 12 * MIN + 12 * SEC));
    expect(c).toHaveLength(1);
    expect(c[0].silent).toBe(false);
    await setPrefs('sam', { quiet_start: '23:00', quiet_end: '07:00' });
    await setTz('sam', 'UTC');
  });

  it('toggle off (set by the user through RLS) → dropped, no push_log row; back on → only new gestures; other toggles do not matter', async () => {
    const T4 = '2031-03-10T12:00:00Z';
    await setPrefs('finn', { little_things: false });
    const off = await sendAt('eve', T4, 'kiss', 5);
    expect(await claimFor('finn', at(T4, 12 * SEC))).toEqual([]);
    expect(await outcome(off.id)).toBe('preference');
    const logs = await sql<{ n: number }>(
      `select count(*)::int n from public.push_log where user_id = $1 and local_date = '2031-03-10'`,
      [ID.finn],
    );
    expect(logs[0].n).toBe(0);
    await setPrefs('finn', { little_things: true });
    await sendAt('eve', at(T4, MIN), 'hug', 100);
    const c = await claimFor('finn', at(T4, MIN + 12 * SEC));
    expect(c.map((x) => x.counts)).toEqual([{ hug: 1 }]);
    await setPrefs('finn', { replies: false, partner_answered: false, nudges: false });
    await sendAt('eve', at(T4, 2 * HOUR), 'miss_you');
    expect(await claimFor('finn', at(T4, 2 * HOUR + 12 * SEC))).toHaveLength(1);
    await setPrefs('finn', { replies: true, partner_answered: true, nudges: true });
  });

  it('undone gestures never push; a batch skips the undone one', async () => {
    const T5 = '2031-03-13T12:00:00Z';
    const u = await sendAt('maya', T5, 'kiss', 2);
    expect((await undoAt('maya', at(T5, 3 * SEC), u.id)).raised).toBeUndefined();
    expect(await due(at(T5, 12 * SEC))).toBe(false);
    expect(await claimFor('sam', at(T5, 12 * SEC))).toEqual([]);
    expect(await outcome(u.id)).toBeNull();
    const v = await sendAt('maya', at(T5, 20 * SEC), 'kiss', 1);
    const w = await sendAt('maya', at(T5, 21 * SEC), 'hug', 300);
    expect((await undoAt('maya', at(T5, 24 * SEC), w.id)).raised).toBeUndefined();
    const c = await claimFor('sam', at(T5, 40 * SEC));
    expect(c.map((x) => [x.gesture, x.counts])).toEqual([['kiss', { kiss: 1 }]]);
    expect([await outcome(w.id), await outcome(v.id)]).toEqual([null, 'pushed']);
  });

  it('SEC-09d: an undo reaching the row after the claim is UNDO_EXPIRED even inside 5 s; the gesture stays', async () => {
    const T6 = '2031-03-16T12:00:00Z';
    const r = await sendAt('eve', T6, 'hug', 1000);
    expect(await claimFor('finn', at(T6, 10 * SEC))).toHaveLength(1);
    expect((await undoAt('eve', at(T6, 4 * SEC), r.id)).raised).toBe('UNDO_EXPIRED');
    expect(await undoneAt(r.id)).toBeNull();
  });

  it('stale (never handled within 30 min) and ended couple (no_recipient) never push', async () => {
    const T7 = '2031-03-19T12:00:00Z';
    const s = await sendAt('maya', T7, 'miss_you');
    expect(await claimFor('sam', at(T7, 31 * MIN))).toEqual([]);
    expect(await outcome(s.id)).toBe('stale');
    const e = await sendAt('maya', at(T7, HOUR), 'hug', 100);
    ok(await as('maya').rpc('unpair'), 'unpair');
    const c = await claim(at(T7, HOUR + 12 * SEC));
    expect(c.filter((x) => x.user_id === ID.sam || x.user_id === ID.maya)).toEqual([]);
    expect(await outcome(e.id)).toBe('no_recipient');
  });

  // Known bug #206 (QA-28): CONTRACTS §4 says push_log.record_id is the newest gesture id, but the
  // claim takes the last element of `v_keep`, an array_agg without ORDER BY, i.e. whatever order the
  // plan returns (heap or index order, not created_at). Which plan runs differs between stacks (a
  // no-op UPDATE of the older row reproduced it locally, not in CI), so a behavioural check would
  // be flaky; this pins the definition instead. Fixed in BE-45b (#210, ordered array_agg).
  it('push_log.record_id comes from gestures ordered by created_at (CONTRACTS §4, #206)', async () => {
    const [{ d }] = await sql<{ d: string }>(
      `select pg_get_functiondef('private.claim_little_thing_pushes_at(timestamptz)'::regprocedure) d`,
    );
    const unorderedKeep = /array_agg\(l\.id\)\s+filter\s*\(where not k\.capped\)/i.test(d);
    const recordFromKeep = /v_keep\[cardinality\(v_keep\)\]/.test(d);
    expect(unorderedKeep && recordFromKeep).toBe(false);
  });

  it('access: claim_little_thing_pushes is service-only; push_log and the dispatch ledger are not readable', async () => {
    expectPermissionDenied(await as('sam').rpc('claim_little_thing_pushes'));
    expectPermissionDenied(await anon.rpc('claim_little_thing_pushes'));
    ok(await admin.rpc('claim_little_thing_pushes'), 'service role');
    expectPermissionDenied(await as('sam').from('push_log').select('id'));
    for (const fn of ['claim_little_thing_pushes_at', 'little_things_due', 'dispatch_little_things']) {
      expect((await loose(as('sam')).rpc(fn, {})).error, fn).not.toBeNull();
    }
  });
});

// ───────────────────────────── notify end to end ─────────────────────────────

const INTERNAL_SECRET = 'FIXTURE-internal-function-secret';
type Message = {
  to: string;
  title?: string;
  body?: string;
  sound?: string;
  channelId?: string;
  priority?: string;
  interruptionLevel?: string;
  data?: Record<string, unknown>;
};
type NotifyRun = { status: number; body: Record<string, unknown>; messages: Message[] };

/** The real notify handler once (qa/functions/notify_little_things.ts), Expo transport recorded. */
function notify(opts: { bearer?: string; invalid?: string[]; body?: unknown; fail?: boolean } = {}): NotifyRun {
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
        NOTIFY_BEARER: opts.bearer ?? INTERNAL_SECRET,
        NOTIFY_INVALID: (opts.invalid ?? []).join(','),
        NOTIFY_BODY: opts.body === undefined ? '' : JSON.stringify(opts.body),
        NOTIFY_SEND_FAIL: opts.fail ? '1' : '',
      },
      timeout: 120_000,
    },
  );
  const line = out.trim().split('\n').reverse().find((l) => l.startsWith('{"status"'));
  if (!line) throw new Error(`no result from notify: ${out}`);
  return JSON.parse(line);
}

const token = () => `FIXTURE-CONTRACT-TOKEN-${randomUUID()}`;
const register = async (who: PersonaName) => {
  const t = token();
  ok(await as(who).rpc('register_push_token', { p_token: t, p_platform: 'ios' }), 'token');
  return t;
};
/** The push_log row of the push that carried a gesture (through the private dispatch ledger). */
const pushLog = async (gestureId: string) =>
  (
    await sql<{ status: string; sent_at: string | null }>(
      `select p.status, p.sent_at from public.push_log p
         join private.little_thing_dispatch d on d.push_id = p.id where d.little_thing_id = $1`,
      [gestureId],
    )
  )[0];
/** Everything due on the database clock is handled, so each case starts clean. */
const drain = async () => {
  const users = [ALL.map((p) => ID[p])];
  await sql('delete from public.push_log where user_id = any($1::uuid[])', users);
  await sql(`select * from private.claim_little_thing_pushes_at(now() + interval '1 minute')`);
  await sql('delete from public.push_log where user_id = any($1::uuid[])', users);
};

/**
 * A quiet window (UTC, every persona's profile timezone here) that never contains the database
 * clock during this group: 11 to 13 hours from now. The handler claims at the real `now()`, so the
 * PREF_DEFAULTS 23:00-07:00 window would make every push quiet between 23:00 and 07:00 UTC (#275).
 */
async function quietAwayFromNow(): Promise<{ quiet_start: string; quiet_end: string }> {
  const [{ s, e }] = await sql<{ s: string; e: string }>(
    `select to_char((now() at time zone 'UTC') + interval '11 hours', 'HH24:MI') s,
            to_char((now() at time zone 'UTC') + interval '13 hours', 'HH24:MI') e`,
  );
  return { quiet_start: s, quiet_end: e };
}

describe('notify {"type":"little_thing"} (real handler, BE-45, CONTRACTS §4/§5)', () => {
  let samToken: string;
  let awake: { quiet_start: string; quiet_end: string };
  beforeAll(async () => {
    await world();
    awake = await quietAwayFromNow();
    ok(
      await admin.from('notification_prefs').update(awake).in('user_id', ALL.map((p) => ID[p])),
      'quiet hours away from now',
    );
    await drain();
    samToken = await register('sam');
  });
  afterEach(drain); // also after a failure, so one case never holds the next in the group window
  // Later files (purchases, purchases-be48) expect the default 23:00-07:00 window back.
  afterAll(async () => {
    const { quiet_start, quiet_end } = PREF_DEFAULTS;
    ok(
      await admin.from('notification_prefs').update({ quiet_start, quiet_end }).in('user_id', ALL.map((p) => ID[p])),
      'quiet hours back to the defaults',
    );
  });

  it('401 without the internal secret, before anything is claimed', async () => {
    const g = await sendAgo('maya', 15, 'kiss', 2);
    const res = notify({ bearer: 'FIXTURE-wrong' });
    expect(res.status).toBe(401);
    expect(await outcome(g.id)).toBeNull();
    await drain();
  });

  it('delivers one grouped push with the §5 shape: sound and channel of the newest gesture, no ids', async () => {
    const k = await sendAgo('maya', 20, 'kiss', 3);
    const h = await sendAgo('maya', 15, 'hug', 2400);
    const res = notify();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 1, suppressed: 0 });
    const mine = res.messages.filter((m) => m.to === samToken);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toEqual({
      to: samToken,
      title: 'Bonded',
      body: `${PERSONAS.maya.display_name} sent you 3 kisses and a hug`,
      sound: 'little_thing_hug.wav',
      channelId: 'little_thing_hug',
      priority: 'high',
      interruptionLevel: 'active',
      data: {
        type: 'little_thing',
        url: 'bonded://today',
        gesture: 'hug',
        gestures: { kiss: 3, hug: 1 },
        silent: false,
      },
    });
    const raw = JSON.stringify(mine);
    expect(raw).not.toContain(k.id);
    expect(raw).not.toContain(h.id);
    expect(raw).not.toContain('2400');
    const log = await pushLog(h.id);
    expect(log.status).toBe('sent');
    expect(log.sent_at).not.toBeNull();
    // A second run sends nothing (the claim is kept; nothing twice).
    const again = notify();
    expect(again.messages.filter((m) => m.to === samToken)).toEqual([]);
    expect(again.body).toEqual({ sent: 0, suppressed: 0 });
    await drain();
  });

  it('quiet hours → no sound, passive, little_thing_quiet channel, data.silent true', async () => {
    // Sam's quiet window covers the database clock right now (UTC profile timezone).
    const [{ s, e }] = await sql<{ s: string; e: string }>(
      `select to_char((now() at time zone 'UTC') - interval '1 hour', 'HH24:MI') s,
              to_char((now() at time zone 'UTC') + interval '1 hour', 'HH24:MI') e`,
    );
    await setPrefs('sam', { quiet_start: s, quiet_end: e });
    try {
      await sendAgo('maya', 15, 'goodnight');
      const res = notify();
      const mine = res.messages.filter((m) => m.to === samToken);
      expect(mine).toHaveLength(1);
      expect(mine[0].sound).toBeUndefined();
      expect(mine[0]).toMatchObject({
        channelId: 'little_thing_quiet',
        priority: 'normal',
        interruptionLevel: 'passive',
        data: { type: 'little_thing', url: 'bonded://today', gesture: 'goodnight', gestures: { goodnight: 1 }, silent: true },
      });
    } finally {
      await setPrefs('sam', awake);
      await drain();
    }
  });

  it('per-gesture sound and channel for every kind', async () => {
    for (const kind of ['kiss', 'miss_you', 'good_morning'] as const) {
      await sendAgo('maya', 15, kind);
      const res = notify();
      const mine = res.messages.filter((m) => m.to === samToken);
      expect(mine, kind).toHaveLength(1);
      expect(mine[0]).toMatchObject({ sound: `little_thing_${kind}.wav`, channelId: `little_thing_${kind}` });
      await drain(); // clears the 10-minute group window and the type cap
    }
  });

  // BE-53 cases use the Premium couple (Eve -> Finn) so Maya's free daily limits stay for the cases below;
  // their tokens are dropped again because later cases rely on only Sam having one.
  it('BE-53: "Little things sounds" off (set by the user through RLS), outside quiet hours → still delivered, silently on the quiet channel, logged sent', async () => {
    const finnToken = await register('finn');
    const eveToken = await register('eve');
    await setPrefs('finn', { little_things_sound: false });
    try {
      const k = await sendAgo('eve', 20, 'kiss', 2);
      const h = await sendAgo('eve', 15, 'hug', 300);
      const res = notify();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ sent: 1, suppressed: 0 });
      const mine = res.messages.filter((m) => m.to === finnToken);
      expect(mine).toHaveLength(1);
      expect('sound' in mine[0]).toBe(false);
      expect(mine[0]).toEqual({
        to: finnToken,
        title: 'Bonded',
        body: `${PERSONAS.eve.display_name} sent you 2 kisses and a hug`,
        channelId: 'little_thing_quiet',
        priority: 'normal',
        interruptionLevel: 'passive',
        data: { type: 'little_thing', url: 'bonded://today', gesture: 'hug', gestures: { kiss: 2, hug: 1 }, silent: true },
      });
      expect([await outcome(k.id), await outcome(h.id)]).toEqual(['pushed', 'pushed']);
      expect((await pushLog(h.id)).status).toBe('sent'); // a push_log slot: counts toward D24
      // The recipient's switch decides: Eve (sound on) still gets sound from Finn (sound off).
      await drain();
      await sendAgo('finn', 15, 'miss_you');
      const back = notify().messages.filter((m) => m.to === eveToken);
      expect(back).toHaveLength(1);
      expect(back[0]).toMatchObject({ sound: 'little_thing_miss_you.wav', channelId: 'little_thing_miss_you', data: { silent: false } });
    } finally {
      await setPrefs('finn', { little_things_sound: true });
      ok(await admin.from('push_tokens').delete().in('token', [finnToken, eveToken]), 'drop tokens');
      await drain();
    }
  });

  it('BE-53: sound off does not override little things off: nothing delivered, nothing logged', async () => {
    const finnToken = await register('finn');
    await setPrefs('finn', { little_things: false, little_things_sound: false });
    try {
      const g = await sendAgo('eve', 15, 'goodnight');
      const res = notify();
      expect(res.messages.filter((m) => m.to === finnToken)).toEqual([]);
      expect(await outcome(g.id)).toBe('preference');
      expect(await pushLog(g.id)).toBeUndefined();
    } finally {
      await setPrefs('finn', { little_things: true, little_things_sound: true });
      ok(await admin.from('push_tokens').delete().eq('token', finnToken), 'drop token');
      await drain();
    }
  });

  it('toggle off → nothing delivered, nothing logged', async () => {
    await setPrefs('sam', { little_things: false });
    try {
      const g = await sendAgo('maya', 15, 'kiss', 1);
      const res = notify();
      expect(res.messages.filter((m) => m.to === samToken)).toEqual([]);
      expect(await outcome(g.id)).toBe('preference');
      expect(await pushLog(g.id)).toBeUndefined();
    } finally {
      await setPrefs('sam', { little_things: true });
      await drain();
    }
  });

  it('an undone gesture is never delivered', async () => {
    const g = await sendAgo('maya', 1, 'hug', 100);
    must(await undo('maya', g.id), 'undo'); // within 5 s on the database clock
    await sql(`update public.little_things set created_at = now() - interval '15 seconds' where id = $1`, [g.id]);
    const res = notify();
    expect(res.messages.filter((m) => m.to === samToken)).toEqual([]);
    expect(await outcome(g.id)).toBeNull();
    await drain();
  });

  it('a recipient without tokens: claimed and marked suppressed (counts, nothing sent)', async () => {
    const g = await sendAgo('sam', 15, 'kiss', 1); // Maya has no token
    const res = notify();
    expect(res.body).toEqual({ sent: 0, suppressed: 1 });
    expect((await pushLog(g.id)).status).toBe('suppressed');
    await drain();
  });

  it('a token Expo reports as not registered is removed', async () => {
    const extra = await register('maya');
    await sendAgo('sam', 15, 'hug', 100);
    const res = notify({ invalid: [extra] });
    expect(res.messages.map((m) => m.to)).toContain(extra);
    expect(must(await admin.from('push_tokens').select('token').eq('token', extra), 'gone')).toEqual([]);
    await drain();
  });

  it('a failed delivery answers 500 INTERNAL_ERROR and keeps the claim (no resend)', async () => {
    const g = await sendAgo('maya', 15, 'kiss', 2);
    const res = notify({ fail: true });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'INTERNAL_ERROR' });
    expect(await outcome(g.id)).toBe('pushed');
    expect((await pushLog(g.id)).status).toBe('claimed');
    const again = notify();
    expect(again.messages.filter((m) => m.to === samToken)).toEqual([]);
    await drain();
  });
});
