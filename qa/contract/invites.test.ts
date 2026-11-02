// QA-03b: BE-04 invites v2 (D01, D02, D04, D05, D06) through PostgREST as signed-in personas
// and as anon, with the failed-attempt log and the pinned clock reached over direct SQL.
//
// Error transport (CONTRACTS §2 "Error format"): INVALID_CODE, INVITE_EXPIRED and COUPLE_FULL from
// accept_invite and invite_preview are an HTTP 400 *response body* {code:'P0001', message:'<CODE>'}
// (so the failed attempt commits); supabase-js must still give error.message === '<CODE>', and
// the attempt must be in private.invite_attempts afterwards. Everything else is a normal raise.
import { randomUUID } from 'node:crypto';
import type { PostgrestError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ID,
  admin,
  anon,
  as,
  atTime,
  createInvite,
  expectCode,
  failedAttempts,
  must,
  ok,
  otherCode,
  resetWorld,
  sql,
  type ErrorCode,
  type Invite,
} from './helpers';
import type { PersonaName } from './personas';

type Res = { error: PostgrestError | null; status: number; data: unknown };

/** A counted failure: HTTP 400, body-borne, `data` unset, error.message exactly the code. */
function expectBodyError(res: Res, code: ErrorCode) {
  expectCode(res, code);
  expect(res.status, `${code} status`).toBe(400);
  expect(res.data).toBeNull();
}

const accept = (who: PersonaName, code: string, token?: string) =>
  as(who).rpc(
    'accept_invite',
    token === undefined ? { p_code: code } : { p_code: code, p_token: token },
  );
const preview = (code: string, token?: string) =>
  anon.rpc(
    'invite_preview',
    token === undefined ? { p_code: code } : { p_code: code, p_token: token },
  );

/** n counted failures (unknown code) for a persona. */
async function failN(who: PersonaName, wrong: string, n: number) {
  for (let i = 0; i < n; i++) expectBodyError(await accept(who, wrong), 'INVALID_CODE');
}

/** Rows the limiter would have written for `who`, `minutesAgo` minutes ago. */
async function seedFailures(who: PersonaName, n: number, minutesAgo = 0) {
  await sql(
    `insert into private.invite_attempts (actor, created_at)
     select $1, now() - make_interval(mins => $2) from generate_series(1, $3)`,
    [`u:${ID[who]}`, minutesAgo, n],
  );
}

const expire = async (code: string) =>
  ok(
    await admin
      .from('pair_invites')
      .update({ expires_at: '2026-01-01T00:00:00Z' })
      .eq('code', code)
      .is('revoked_at', null),
    'expire',
  );

let mayaCouple: string;
let invite: Invite; // Maya's active invite
let wrong: string; // a 4-digit code that is not Maya's

/** Maya has a solo couple (long_distance, two goals, partner name Sam) and one active invite. */
async function setup() {
  await resetWorld();
  mayaCouple = must(
    await as('maya').rpc('create_couple', {
      p_stage: 'long_distance',
      p_goals: ['deep_talks', 'our_future'],
      p_partner_name: 'Sam',
    }),
    'create_couple',
  );
  invite = await createInvite('maya');
  wrong = otherCode(invite.code);
}

describe('create_invite (BE-04, D01)', () => {
  beforeEach(resetWorld);

  it('NOT_PAIRED until create_couple has run, then returns { code, expires_at, token }', async () => {
    expectCode(await as('maya').rpc('create_invite'), 'NOT_PAIRED');
    must(await as('maya').rpc('create_couple', { p_stage: 'dating' }), 'create_couple');
    const inv = must(await as('maya').rpc('create_invite'), 'create_invite');
    expect(Object.keys(inv).sort()).toEqual(['code', 'expires_at', 'token']);
    expect(inv.code).toMatch(/^[0-9]{4}$/); // shown as BND·1234; the prefix is not stored
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]{32}$/); // 192 bits, url-safe
  });

  it('expires 48 h after it was created; the inviter reads it back, no token column', async () => {
    const couple = must(
      await as('maya').rpc('create_couple', { p_stage: 'dating', p_partner_name: 'Sam' }),
      'create_couple',
    );
    const inv = await createInvite('maya');
    const rows = must(await as('maya').from('pair_invites').select('*'), 'read');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      code: inv.code,
      inviter_id: ID.maya,
      couple_id: couple,
      partner_name: 'Sam',
      accepted_at: null,
      accepted_by: null,
      revoked_at: null,
    });
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(48 * 3600 * 1000);
    expect(Date.parse(row.expires_at)).toBe(Date.parse(inv.expires_at));
    // The token is returned once; neither it nor its hash is a readable column.
    expect(Object.keys(row).sort()).toEqual(
      [
        'accepted_at',
        'accepted_by',
        'code',
        'couple_id',
        'created_at',
        'expires_at',
        'id',
        'inviter_id',
        'partner_name',
        'revoked_at',
      ].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain(inv.token);
    const bad = await as('maya')
      .from('pair_invites')
      .select('token' as never);
    expect(bad.error?.code).toBe('42703');
  });

  it('one active invite per inviter: a new call revokes the previous code and token', async () => {
    must(await as('maya').rpc('create_couple', { p_stage: 'dating' }), 'create_couple');
    const first = await createInvite('maya');
    let second = await createInvite('maya');
    while (second.code === first.code) second = await createInvite('maya'); // 1 in 10 000
    expect(second.token).not.toBe(first.token);
    const rows = must(
      await as('maya').from('pair_invites').select('code, revoked_at, accepted_at'),
      'read',
    );
    expect(rows.filter((r) => r.revoked_at === null).map((r) => r.code)).toEqual([second.code]);
    expect(rows.filter((r) => r.revoked_at !== null).map((r) => r.code)).toContain(first.code);
    // The old code and its token are dead for the joiner.
    expectBodyError(await accept('sam', first.code), 'INVALID_CODE');
    expectBodyError(await accept('sam', first.code, first.token), 'INVALID_CODE');
    expectBodyError(await preview(first.code), 'INVALID_CODE');
  });

  it('digits are unique among active invites', async () => {
    const inviters = ['maya', 'noor', 'lea', 'finn'] as const;
    const codes: string[] = [];
    for (const who of inviters) {
      must(await as(who).rpc('create_couple', { p_stage: 'dating' }), `${who} create_couple`);
      codes.push((await createInvite(who)).code);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('COUPLE_FULL once the caller is in a two-member couple', async () => {
    await setup();
    must(await accept('sam', invite.code), 'sam joins');
    expectCode(await as('maya').rpc('create_invite'), 'COUPLE_FULL');
    expectCode(await as('sam').rpc('create_invite'), 'COUPLE_FULL');
  });

  it('pair_invites: only the inviter reads it; nobody writes it from the client; anon is denied', async () => {
    await setup();
    expect(must(await as('maya').from('pair_invites').select('code'), 'maya')).toHaveLength(1);
    for (const who of ['sam', 'eve'] as const) {
      expect(must(await as(who).from('pair_invites').select('code'), who)).toEqual([]);
    }
    const anonRead = await anon.from('pair_invites').select('code');
    expect(anonRead.error?.code).toBe('42501');
    const ins = await as('maya').from('pair_invites').insert({
      code: '1234',
      inviter_id: ID.maya,
      couple_id: mayaCouple,
    });
    expect(ins.error?.code).toBe('42501');
    const upd = await as('maya')
      .from('pair_invites')
      .update({ expires_at: '2099-01-01T00:00:00Z' })
      .eq('code', invite.code);
    expect(upd.error?.code).toBe('42501');
    const del = await as('maya').from('pair_invites').delete().eq('code', invite.code);
    expect(del.error?.code).toBe('42501');
    // The joiner does not see the (used) invite afterwards either.
    must(await accept('sam', invite.code), 'sam joins');
    expect(must(await as('sam').from('pair_invites').select('code'), 'sam after')).toEqual([]);
  });
});

describe('accept_invite (BE-04, D01, D04, D05)', () => {
  beforeEach(setup);

  const formats: Array<[string, (c: string) => string]> = [
    ['BND·1234', (c) => `BND·${c}`],
    ['bnd 1234', (c) => `bnd ${c}`],
    ['BND1234', (c) => `BND${c}`],
    ['1234', (c) => c],
    [' BND-1234 ', (c) => ` BND-${c} `],
  ];
  for (const [label, format] of formats) {
    it(`accepts the code typed as '${label}'`, async () => {
      const couple = must(await accept('sam', format(invite.code)), 'accept');
      expect(couple).toBe(mayaCouple);
    });
  }

  it("returns the inviter's couple id as a json string; both are members; the invite is used", async () => {
    const res = await accept('sam', invite.code);
    expect(typeof must(res, 'accept')).toBe('string');
    expect(res.data).toBe(mayaCouple);
    for (const who of ['maya', 'sam'] as const) {
      const c = must(
        await as(who).from('couples').select('id, couple_members(user_id)'),
        'read couple',
      );
      expect(c.map((r) => r.id)).toEqual([mayaCouple]);
      expect(c[0].couple_members.map((m) => m.user_id).sort()).toEqual([ID.maya, ID.sam].sort());
    }
    const rows = must(
      await as('maya').from('pair_invites').select('accepted_by, accepted_at'),
      'invite',
    );
    expect(rows[0].accepted_by).toBe(ID.sam);
    expect(rows[0].accepted_at).not.toBeNull();
    expect(await failedAttempts('sam')).toBe(0);
  });

  it('the joiner inherits stage, goals, partner name and key dates (J5)', async () => {
    must(
      await as('maya')
        .from('key_dates')
        .insert({ couple_id: mayaCouple, kind: 'together_since', date: '2023-03-14' })
        .select(),
      'key date',
    );
    expect(must(await as('sam').from('key_dates').select('id'), 'before')).toEqual([]);
    must(await accept('sam', invite.code), 'accept');
    const c = must(await as('sam').from('couples').select('stage, goals, partner_name'), 'couple');
    expect(c).toEqual([
      { stage: 'long_distance', goals: ['deep_talks', 'our_future'], partner_name: 'Sam' },
    ]);
    const dates = must(await as('sam').from('key_dates').select('kind, date'), 'dates');
    expect(dates).toEqual([{ kind: 'together_since', date: '2023-03-14' }]);
  });

  it('D04: a joiner with a solo couple joins; the solo couple is deleted with its answers, dates and invite', async () => {
    const solo = must(await as('sam').rpc('create_couple', { p_stage: 'dating' }), 'sam solo');
    const soloCq = must(await as('sam').rpc('get_daily_question'), 'sam daily');
    ok(
      await as('sam')
        .from('answers')
        .insert({ couple_question_id: soloCq.id, user_id: ID.sam, body: 'FIXTURE-CONTRACT-SOLO' }),
      'sam answers',
    );
    ok(
      await as('sam')
        .from('key_dates')
        .insert({ couple_id: solo, kind: 'birthday', user_id: ID.sam, date: '1993-11-20' }),
      'sam birthday',
    );
    await createInvite('sam'); // an open invite of the solo couple

    const joined = must(await accept('sam', invite.code), 'accept');
    expect(joined).toBe(mayaCouple);
    expect(must(await admin.from('couples').select('id').eq('id', solo), 'solo')).toEqual([]);
    expect(
      must(await admin.from('answers').select('id').eq('couple_question_id', soloCq.id), 'a'),
    ).toEqual([]);
    expect(must(await admin.from('key_dates').select('id').eq('couple_id', solo), 'd')).toEqual([]);
    expect(
      must(await admin.from('pair_invites').select('id').eq('inviter_id', ID.sam), 'i'),
    ).toEqual([]);
    const members = must(
      await admin.from('couple_members').select('couple_id').eq('user_id', ID.sam),
      'members',
    );
    expect(members).toEqual([{ couple_id: mayaCouple }]);
    expect(await failedAttempts('sam')).toBe(0);
  });

  it('ALREADY_PAIRED (caller in a two-member couple) is checked first and is not counted; a retry after success gets it', async () => {
    must(await accept('sam', invite.code), 'accept');
    expectCode(await accept('sam', invite.code), 'ALREADY_PAIRED');
    expectCode(await accept('sam', wrong), 'ALREADY_PAIRED');
    expectCode(await accept('maya', wrong), 'ALREADY_PAIRED');
    // ... even when the limiter would have blocked the caller.
    await seedFailures('sam', 5);
    expectCode(await accept('sam', wrong), 'ALREADY_PAIRED');
    expect(await failedAttempts('sam')).toBe(5);
    const members = must(
      await admin.from('couple_members').select('couple_id').in('user_id', [ID.maya, ID.sam]),
      'members',
    );
    expect(members.map((m) => m.couple_id)).toEqual([mayaCouple, mayaCouple]);
  });

  it('OWN_CODE for the inviter (raised, not counted)', async () => {
    const res = await accept('maya', invite.code);
    expectCode(res, 'OWN_CODE');
    expect(await failedAttempts('maya')).toBe(0);
  });

  it('INVALID_CODE: unknown, empty, too short, too long, letters; HTTP 400 body; each failure is persisted', async () => {
    for (const code of [wrong, '', '12', '12345', 'ABCD']) {
      expectBodyError(await accept('sam', code), 'INVALID_CODE');
    }
    expect(await failedAttempts('sam')).toBe(5);
    // Nothing was created.
    const members = must(
      await admin.from('couple_members').select('couple_id').eq('user_id', ID.sam),
      'members',
    );
    expect(members).toEqual([]);
  });

  it('a failed attempt is recorded although the response is an error (the reason for the 400 body)', async () => {
    expect(await failedAttempts('sam')).toBe(0);
    expectBodyError(await accept('sam', wrong), 'INVALID_CODE');
    expect(await failedAttempts('sam')).toBe(1);
    await expire(invite.code);
    expectBodyError(await accept('sam', invite.code), 'INVITE_EXPIRED');
    expect(await failedAttempts('sam')).toBe(2);
  });

  it('INVITE_EXPIRED for an expired code (pinned in the past)', async () => {
    await expire(invite.code);
    expectBodyError(await accept('sam', invite.code), 'INVITE_EXPIRED');
    const members = must(
      await admin.from('couple_members').select('user_id').eq('couple_id', mayaCouple),
      'members',
    );
    expect(members).toEqual([{ user_id: ID.maya }]);
  });

  it('INVITE_EXPIRED exactly at expires_at (clock pinned), accepted one second before', async () => {
    const at = new Date(invite.expires_at); // millisecond precision: round up to be at or after
    const late = await atTime(
      'accept_invite_at',
      'sam',
      invite.code,
      null,
      new Date(at.getTime() + 1),
    );
    expect(late.body).toMatchObject({ code: 'P0001', message: 'INVITE_EXPIRED' });
    const early = await atTime(
      'accept_invite_at',
      'sam',
      invite.code,
      null,
      new Date(at.getTime() - 1000),
    );
    expect(early.body).toBe(mayaCouple);
  });

  it('COUPLE_FULL for a used code (J10), also after it expired; counted', async () => {
    must(await accept('sam', invite.code), 'accept');
    expectBodyError(await accept('lea', invite.code), 'COUPLE_FULL');
    ok(
      await admin
        .from('pair_invites')
        .update({ expires_at: '2026-01-01T00:00:00Z' })
        .eq('code', invite.code),
      'expire',
    );
    expectBodyError(await accept('lea', invite.code), 'COUPLE_FULL');
    expect(await failedAttempts('lea')).toBe(2);
  });

  it('the used code is INVALID_CODE again once 48 h have passed since it was used (clock pinned)', async () => {
    must(await accept('sam', invite.code), 'accept');
    const later = new Date(Date.now() + 49 * 3600 * 1000);
    const res = await atTime('accept_invite_at', 'lea', invite.code, null, later);
    expect(res.body).toMatchObject({ message: 'INVALID_CODE' });
  });

  it("the inviter's day-1 answer stays hidden from the joiner until the joiner answers (reveal rule)", async () => {
    const cq = must(await as('maya').rpc('get_daily_question'), 'maya day 1');
    ok(
      await as('maya')
        .from('answers')
        .insert({ couple_question_id: cq.id, user_id: ID.maya, body: 'FIXTURE-CONTRACT-DAY1' }),
      'maya answers',
    );
    must(await accept('sam', invite.code), 'sam joins');
    // The joiner gets the question the inviter already answered, with the count but not the text.
    const mine = must(await as('sam').rpc('get_daily_question'), 'sam daily');
    expect(mine).toMatchObject({ id: cq.id, answer_count: 1 });
    expect(
      must(
        await as('sam').from('answers').select('user_id').eq('couple_question_id', cq.id),
        'before',
      ),
    ).toEqual([]);
    ok(
      await as('sam')
        .from('answers')
        .insert({ couple_question_id: cq.id, user_id: ID.sam, body: 'FIXTURE-CONTRACT-DAY1-SAM' }),
      'sam answers',
    );
    const after = must(
      await as('sam').from('answers').select('user_id, body').eq('couple_question_id', cq.id),
      'after',
    );
    expect(after.map((a) => a.user_id).sort()).toEqual([ID.maya, ID.sam].sort());
  });

  it('a second joiner cannot take the same invite: exactly one wins', async () => {
    const [a, b] = await Promise.all([accept('sam', invite.code), accept('lea', invite.code)]);
    const wins = [a, b].filter((r) => r.error === null);
    const losses = [a, b].filter((r) => r.error !== null);
    expect(wins).toHaveLength(1);
    expectBodyError(losses[0], 'COUPLE_FULL');
    const members = must(
      await admin.from('couple_members').select('user_id').eq('couple_id', mayaCouple),
      'members',
    );
    expect(members).toHaveLength(2);
  });
});

describe('accept_invite rate limit and link token (BE-04, D02)', () => {
  beforeEach(setup);

  it('the 6th failed attempt in 15 min is RATE_LIMITED; the 5 before were INVALID_CODE', async () => {
    await failN('sam', wrong, 5);
    expectCode(await accept('sam', wrong), 'RATE_LIMITED');
    expect(await failedAttempts('sam')).toBe(5); // the blocked call is not another failure
  });

  it('a typed valid code is also blocked at the limit; nothing is joined', async () => {
    await failN('sam', wrong, 5);
    expectCode(await accept('sam', invite.code), 'RATE_LIMITED');
    const members = must(
      await admin.from('couple_members').select('user_id').eq('couple_id', mayaCouple),
      'members',
    );
    expect(members).toEqual([{ user_id: ID.maya }]);
  });

  it('a success does not count: 4 failures, then the right code joins', async () => {
    await failN('sam', wrong, 4);
    must(await accept('sam', invite.code), 'accept');
    expect(await failedAttempts('sam')).toBe(4);
  });

  it('the window rolls over after 15 min (clock pinned)', async () => {
    await failN('sam', wrong, 5);
    const now = Date.now();
    const at = (min: number) => new Date(now + min * 60_000);
    const within = await atTime('accept_invite_at', 'sam', invite.code, null, at(14));
    expect(within.raised).toBe('RATE_LIMITED');
    const after = await atTime('accept_invite_at', 'sam', wrong, null, at(16));
    expect(after.raised).toBeUndefined();
    expect(after.body).toMatchObject({ message: 'INVALID_CODE' }); // allowed again
  });

  it('failures older than the window do not count', async () => {
    await seedFailures('sam', 5, 16);
    expectBodyError(await accept('sam', wrong), 'INVALID_CODE');
    await seedFailures('lea', 4, 5);
    expectBodyError(await accept('lea', wrong), 'INVALID_CODE'); // the 5th, still allowed
    expectCode(await accept('lea', wrong), 'RATE_LIMITED');
  });

  it('is per user: another user is not limited', async () => {
    await failN('sam', wrong, 5);
    expectCode(await accept('sam', wrong), 'RATE_LIMITED');
    must(await accept('lea', invite.code), 'lea joins');
  });

  it('a valid code + valid token succeeds after 5 failed typed attempts, and is not counted', async () => {
    await failN('sam', wrong, 5);
    expectCode(await accept('sam', invite.code), 'RATE_LIMITED');
    const couple = must(await accept('sam', invite.code, invite.token), 'accept with token');
    expect(couple).toBe(mayaCouple);
    expect(await failedAttempts('sam')).toBe(5);
  });

  it('an invalid token is treated as typed: random, truncated or another invite token never skip the limit', async () => {
    must(await as('noor').rpc('create_couple', { p_stage: 'dating' }), 'noor couple');
    const noor = await createInvite('noor');
    const bad = [randomUUID().replaceAll('-', ''), invite.token.slice(0, -4), noor.token];

    // Under the limit: INVALID_CODE and counted.
    for (const [i, token] of bad.entries()) {
      expectBodyError(await accept('sam', invite.code, token), 'INVALID_CODE');
      expect(await failedAttempts('sam')).toBe(i + 1);
    }
    // At the limit: blocked.
    await seedFailures('sam', 2);
    for (const token of bad) {
      expectCode(await accept('sam', invite.code, token), 'RATE_LIMITED');
    }
  });

  it('an invalid code with any token: INVALID_CODE, counted; RATE_LIMITED after 5', async () => {
    for (let i = 1; i <= 5; i++) {
      expectBodyError(await accept('sam', wrong, invite.token), 'INVALID_CODE');
      expect(await failedAttempts('sam')).toBe(i);
    }
    expectCode(await accept('sam', wrong, invite.token), 'RATE_LIMITED');
    // The valid token vouches for the right code even now.
    must(await accept('sam', invite.code, invite.token), 'joins with the token');
  });

  it('the token of a revoked invite is rejected (INVALID_CODE) and does not skip the limit', async () => {
    let second = await createInvite('maya');
    while (second.code === invite.code) second = await createInvite('maya');
    expectBodyError(await accept('sam', invite.code, invite.token), 'INVALID_CODE');
    expect(await failedAttempts('sam')).toBe(1);
    await seedFailures('sam', 4);
    expectCode(await accept('sam', invite.code, invite.token), 'RATE_LIMITED');
    // The new invite's token does work at the limit.
    must(await accept('sam', second.code, second.token), 'new token');
  });

  it('the token of an expired invite is rejected with INVITE_EXPIRED', async () => {
    await expire(invite.code);
    expectBodyError(await accept('sam', invite.code, invite.token), 'INVITE_EXPIRED');
  });

  // QA-BUG-1 (sev 4, BE-04): TEST_PLAN D02 says the token of an expired invite "does not skip the
  // limit". Live behaviour: a valid token skips the limiter even when the invite is expired, so
  // a user at the limit gets INVITE_EXPIRED instead of RATE_LIMITED (backend's own test expects
  // that too). `it.fails` keeps the strict expectation: it turns red when backend changes the
  // behaviour, and the lead decides whether the plan or BE-04 is wrong. Not weakened.
  it.fails('the token of an expired invite does not skip the limit (TEST_PLAN D02)', async () => {
    await expire(invite.code);
    await seedFailures('sam', 5);
    expectCode(await accept('sam', invite.code, invite.token), 'RATE_LIMITED');
  });

  it('the token of a used invite is COUPLE_FULL for the next user', async () => {
    must(await accept('sam', invite.code, invite.token), 'sam joins with the token');
    expectBodyError(await accept('lea', invite.code, invite.token), 'COUPLE_FULL');
  });

  it('the hourly global cap of failed attempts writes one alert row (no user text)', async () => {
    await sql(
      `insert into private.invite_attempts (actor, created_at)
       select 'u:' || gen_random_uuid()::text, now() - interval '1 minute' from generate_series(1, 99)`,
    );
    await sql(`delete from private.security_alerts where kind = 'invite_guessing'`);
    expectBodyError(await accept('sam', wrong), 'INVALID_CODE'); // the 100th in the hour
    expectBodyError(await accept('lea', wrong), 'INVALID_CODE');
    const alerts = await sql<{ kind: string; detail: Record<string, unknown> }>(
      `select kind, detail from private.security_alerts where kind = 'invite_guessing'`,
    );
    expect(alerts).toHaveLength(1);
    expect(JSON.stringify(alerts[0].detail)).not.toMatch(/FIXTURE|@|[0-9a-f]{8}-[0-9a-f]{4}/);
    await sql(`delete from private.security_alerts where kind = 'invite_guessing'`);
  });
});

describe('invite_preview (BE-04, D06)', () => {
  beforeEach(setup);

  type Preview = {
    inviter_name: string;
    inviter_avatar_url: string | null;
    inviter_answered_today: boolean;
    expires_at: string;
  };

  it('anon gets exactly { inviter_name, inviter_avatar_url, inviter_answered_today, expires_at }', async () => {
    const res = await preview(invite.code);
    const body = must(res, 'preview') as unknown as Preview;
    expect(Object.keys(body).sort()).toEqual([
      'expires_at',
      'inviter_answered_today',
      'inviter_avatar_url',
      'inviter_name',
    ]);
    expect(body.inviter_name).toBe('Maya'); // first name only
    expect(body.inviter_answered_today).toBe(false);
    expect(Date.parse(body.expires_at)).toBe(Date.parse(invite.expires_at));
    expect(await failedAttempts('maya')).toBe(0);
  });

  it('accepts every code format; a token is optional', async () => {
    for (const code of [
      `BND·${invite.code}`,
      `bnd ${invite.code}`,
      `BND${invite.code}`,
      invite.code,
    ]) {
      expect(must(await preview(code), code)).toMatchObject({ inviter_name: 'Maya' });
    }
    expect(must(await preview(invite.code, invite.token), 'token')).toMatchObject({
      inviter_name: 'Maya',
    });
  });

  it('is also callable signed in, and does not use up the invite', async () => {
    const res = await as('sam').rpc('invite_preview', { p_code: invite.code });
    expect(must(res, 'preview')).toMatchObject({ inviter_name: 'Maya' });
    must(await accept('sam', invite.code), 'accept still works');
  });

  it("inviter_answered_today flips once the inviter answered today's question", async () => {
    const cq = must(await as('maya').rpc('get_daily_question'), 'maya daily');
    ok(
      await as('maya').from('answers').insert({
        couple_question_id: cq.id,
        user_id: ID.maya,
        body: 'FIXTURE-CONTRACT-PREVIEW-ANSWER',
      }),
      'maya answers',
    );
    const body = must(await preview(invite.code), 'preview') as unknown as Preview;
    expect(body.inviter_answered_today).toBe(true);
  });

  it('never returns answer text, email, ids or the partner_name', async () => {
    const cq = must(await as('maya').rpc('get_daily_question'), 'maya daily');
    ok(
      await as('maya').from('answers').insert({
        couple_question_id: cq.id,
        user_id: ID.maya,
        body: 'FIXTURE-CONTRACT-PREVIEW-ANSWER',
      }),
      'maya answers',
    );
    const text = JSON.stringify((await preview(invite.code, invite.token)).data);
    for (const secret of [
      'FIXTURE-',
      'maya@bonded.test',
      ID.maya,
      mayaCouple,
      'Sam', // partner_name
      invite.token,
      cq.id,
    ]) {
      expect(text, `leaks ${secret}`).not.toContain(secret);
    }
  });

  it('INVALID_CODE, INVITE_EXPIRED and COUPLE_FULL come back as HTTP 400 bodies; each is counted for the caller', async () => {
    expectBodyError(await preview(wrong), 'INVALID_CODE');
    await expire(invite.code);
    expectBodyError(await preview(invite.code), 'INVITE_EXPIRED');
    const [{ n }] = await sql<{ n: number }>(
      `select count(*)::int n from private.invite_attempts where actor like 'ip:%'`,
    );
    expect(n).toBe(2);
  });

  it('COUPLE_FULL for a used code', async () => {
    must(await accept('sam', invite.code), 'sam joins');
    expectBodyError(await preview(invite.code), 'COUPLE_FULL');
  });

  it('RATE_LIMITED after 5 failed attempts in 15 min, for anon too (per client IP)', async () => {
    for (let i = 0; i < 5; i++) expectBodyError(await preview(wrong), 'INVALID_CODE');
    expectCode(await preview(wrong), 'RATE_LIMITED');
    expectCode(await preview(invite.code), 'RATE_LIMITED');
  });

  it('the limiter is shared with accept_invite per user', async () => {
    for (let i = 0; i < 5; i++) {
      expectBodyError(await as('sam').rpc('invite_preview', { p_code: wrong }), 'INVALID_CODE');
    }
    expectCode(await accept('sam', invite.code), 'RATE_LIMITED');
  });

  it('a valid token previews at the limit; an invalid token counts toward it', async () => {
    for (let i = 0; i < 5; i++) expectBodyError(await preview(wrong), 'INVALID_CODE');
    expectCode(await preview(invite.code, 'not-the-token'), 'RATE_LIMITED');
    expect(must(await preview(invite.code, invite.token), 'valid token')).toMatchObject({
      inviter_name: 'Maya',
    });

    await setup();
    expectBodyError(await preview(invite.code, 'not-the-token'), 'INVALID_CODE');
    const [{ n }] = await sql<{ n: number }>(
      `select count(*)::int n from private.invite_attempts where actor like 'ip:%'`,
    );
    expect(n).toBe(1);
  });
});
