// QA-10: BE-26 (D02, SEC-04) typed codes need the inviter's approval. Through PostgREST as signed-in
// personas, with the clock pinned over direct SQL (private.accept_invite_at / approve_join_at /
// decline_join_at) where the rule depends on time. CONTRACTS §2: `accept_invite`,
// `pending_join_requests`, `approve_join` / `decline_join`, error format.
//
// Cast: Maya is the inviter (solo couple + one open invite). Sam, Lea and Noor request; Finn is the
// 4th requester; Eve is an outsider.
import { randomUUID } from 'node:crypto';
import type { PostgrestError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ID,
  PERSONAS,
  admin,
  anon,
  approveJoin,
  as,
  asPending,
  atTime,
  callAs,
  canForgeJwt,
  createInvite,
  expectCode,
  expectPermissionDenied,
  failedAttempts,
  joinByLink,
  must,
  noSubject,
  ok,
  requestJoin,
  resetWorld,
  sql,
  type ErrorCode,
  type Invite,
} from './helpers';
import type { PersonaName } from './personas';

type Res = { error: PostgrestError | null; status: number; data: unknown };

/** A counted (committed) rejection: HTTP 400 body, error.message exactly the code. */
function expectBodyError(res: Res, code: ErrorCode) {
  expectCode(res, code);
  expect(res.status, `${code} status`).toBe(400);
  expect(res.data).toBeNull();
}

const typed = (who: PersonaName, code: string) => as(who).rpc('accept_invite', { p_code: code });
const approve = (who: PersonaName, id: string) => as(who).rpc('approve_join', { p_request: id });
const decline = (who: PersonaName, id: string) => as(who).rpc('decline_join', { p_request: id });
const pending = (who: PersonaName) => as(who).rpc('pending_join_requests');

/** Active members of Maya's couple. */
const members = async () =>
  must(
    await admin.from('couple_members').select('user_id').eq('couple_id', mayaCouple).is('left_at', null),
    'members',
  )
    .map((m) => m.user_id)
    .sort();
/** The couples `who` is an active member of. */
const coupleOf = async (who: PersonaName) =>
  must(
    await admin.from('couple_members').select('couple_id').eq('user_id', ID[who]).is('left_at', null),
    'membership',
  ).map((m) => m.couple_id);
const requestRow = async (id: string) =>
  (
    await sql<{ status: string; expires_at: Date; decided_at: Date | null }>(
      'select status, expires_at, decided_at from public.join_requests where id = $1',
      [id],
    )
  )[0];

/** approve_join / decline_join as Maya with the clock pinned; returns the json result. */
const decideAt = async (fn: 'approve_join_at' | 'decline_join_at', id: string, now: Date) => {
  const res = await callAs<{ r: unknown }>(
    'maya',
    `select private.${fn}($1::uuid, $2::timestamptz) r`,
    [id, now.toISOString()],
  );
  if (res.raised) return { raised: res.raised };
  return { body: res.rows![0].r };
};

let mayaCouple: string;
let invite: Invite;

async function setup() {
  await resetWorld();
  mayaCouple = must(
    await as('maya').rpc('create_couple', { p_stage: 'long_distance', p_partner_name: 'Sam' }),
    'create_couple',
  );
  invite = await createInvite('maya');
}

describe('typed code needs the inviter approval (BE-26, D02)', () => {
  beforeEach(setup);

  it('fails if a typed code pairs without approval: pending object, nobody paired, invite unused', async () => {
    const before = Date.now();
    const res = await typed('sam', invite.code);
    const req = asPending(must(res, 'typed'));
    expect(req.request_id).toMatch(/^[0-9a-f-]{36}$/);
    // Lives 15 minutes (the invite has 48 h left, so the 15 minutes win).
    const ttl = Date.parse(req.expires_at) - before;
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000 + 5_000);

    expect(await coupleOf('sam')).toEqual([]);
    expect(await members()).toEqual([ID.maya]);
    expectCode(await as('sam').rpc('get_daily_question'), 'NOT_PAIRED');
    const inv = must(
      await admin.from('pair_invites').select('accepted_at, accepted_by').eq('code', invite.code).is('revoked_at', null),
      'invite',
    );
    expect(inv).toEqual([{ accepted_at: null, accepted_by: null }]);
    expect(await failedAttempts('sam')).toBe(0); // a request is not a failure
    // Maya cannot create another couple member by herself: her invite is still open.
    expect(must(await as('maya').from('pair_invites').select('code'), 'maya invite')).toHaveLength(1);
  });

  it('approve: the requester joins the inviter couple and inherits it; request approved; retries are done', async () => {
    const req = await requestJoin('sam', invite.code);
    const res = await approve('maya', req.request_id);
    expect(typeof must(res, 'approve')).toBe('string');
    expect(res.data).toBe(mayaCouple);
    expect(await members()).toEqual([ID.maya, ID.sam].sort());
    const c = must(await as('sam').from('couples').select('id, stage, partner_name'), 'sam couple');
    expect(c).toEqual([{ id: mayaCouple, stage: 'long_distance', partner_name: 'Sam' }]);
    expect(must(await as('sam').rpc('get_daily_question'), 'daily').couple_id).toBe(mayaCouple);
    const inv = must(
      await admin.from('pair_invites').select('accepted_by').eq('code', invite.code).is('revoked_at', null),
      'invite',
    );
    expect(inv).toEqual([{ accepted_by: ID.sam }]);
    expect((await requestRow(req.request_id)).status).toBe('approved');
    // Approving again is not a second join; the joiner retrying the code is done.
    expectCode(await approve('maya', req.request_id), 'JOIN_REQUEST_EXPIRED');
    expectCode(await typed('sam', invite.code), 'ALREADY_PAIRED');
    expect(await failedAttempts('sam')).toBe(0);
    expect(must(await pending('maya'), 'pending after')).toEqual([]);
  });

  it('decline: not paired, counted once; re-request on that invite is JOIN_REQUEST_FORBIDDEN for its whole life', async () => {
    const req = await requestJoin('sam', invite.code);
    const res = await decline('maya', req.request_id);
    expect(must(res, 'decline')).toEqual({ status: 'declined', request_id: req.request_id });
    expect(await coupleOf('sam')).toEqual([]);
    expect(await members()).toEqual([ID.maya]);
    expect((await requestRow(req.request_id)).status).toBe('declined');
    expect(await failedAttempts('sam')).toBe(1);

    expectCode(await typed('sam', invite.code), 'JOIN_REQUEST_FORBIDDEN');
    expectCode(await typed('sam', ` BND-${invite.code} `), 'JOIN_REQUEST_FORBIDDEN');
    expect(await failedAttempts('sam')).toBe(1); // the blocked retry is raised, not counted
    // The declined request cannot be approved or declined again.
    expectCode(await approve('maya', req.request_id), 'JOIN_REQUEST_EXPIRED');
    expectCode(await decline('maya', req.request_id), 'JOIN_REQUEST_EXPIRED');
    // Still blocked one second before the invite expires (48 h), clock pinned.
    const late = await atTime(
      'accept_invite_at',
      'sam',
      invite.code,
      null,
      new Date(Date.parse(invite.expires_at) - 1000),
    );
    expect(late.raised).toBe('JOIN_REQUEST_FORBIDDEN');
    // Others may still ask.
    asPending(must(await typed('lea', invite.code), 'lea'));
  });

  it('a decline does not block a fresh invite, nor the valid link of the same invite', async () => {
    const req = await requestJoin('sam', invite.code);
    must(await decline('maya', req.request_id), 'decline');
    expectCode(await typed('sam', invite.code), 'JOIN_REQUEST_FORBIDDEN');
    // The valid link is a separate capability: it pairs at once.
    expect(await joinByLink('sam', invite)).toBe(mayaCouple);
  });

  it('a fresh invite resets the decline block', async () => {
    const req = await requestJoin('sam', invite.code);
    must(await decline('maya', req.request_id), 'decline');
    let fresh = await createInvite('maya');
    while (fresh.code === invite.code) fresh = await createInvite('maya');
    const again = await requestJoin('sam', fresh.code);
    expect(again.request_id).not.toBe(req.request_id);
    expect(await approveJoin('maya', again.request_id)).toBe(mayaCouple);
  });

  it('idempotent retry: the same request_id and expires_at; the 15-minute window is not extended', async () => {
    const t0 = new Date();
    const first = await atTime('accept_invite_at', 'sam', invite.code, null, t0);
    const a = asPending(first.body);
    expect(Date.parse(a.expires_at)).toBe(t0.getTime() + 15 * 60_000);
    const retry = await atTime(
      'accept_invite_at',
      'sam',
      `BND·${invite.code}`,
      null,
      new Date(t0.getTime() + 5 * 60_000),
    );
    expect(asPending(retry.body)).toEqual(a);
    // Through the API too (the API clock is now(), still inside the window).
    expect(asPending(must(await typed('sam', invite.code), 'api retry'))).toEqual(a);
    const rows = await sql<{ n: number }>(
      `select count(*)::int n from public.join_requests where requester_id = $1`,
      [ID.sam],
    );
    expect(rows[0].n).toBe(1);
    expect(await failedAttempts('sam')).toBe(0);
  });

  it('expiry: JOIN_REQUEST_EXPIRED at expires_at (400 body, counted once); approved one second before', async () => {
    const t0 = new Date();
    const req = asPending((await atTime('accept_invite_at', 'sam', invite.code, null, t0)).body);
    const end = new Date(Date.parse(req.expires_at));

    const late = await decideAt('approve_join_at', req.request_id, end);
    expect(late.body).toMatchObject({ code: 'P0001', message: 'JOIN_REQUEST_EXPIRED' });
    expect((await requestRow(req.request_id)).status).toBe('expired');
    expect(await failedAttempts('sam')).toBe(1);
    expect(await coupleOf('sam')).toEqual([]);

    // A new request after expiry is a new id; the expiry is not counted a second time.
    const again = asPending(
      (await atTime('accept_invite_at', 'sam', invite.code, null, new Date(end.getTime() + 60_000))).body,
    );
    expect(again.request_id).not.toBe(req.request_id);
    expect(await failedAttempts('sam')).toBe(1);
    const ok1 = await decideAt('approve_join_at', again.request_id, new Date(Date.parse(again.expires_at) - 1000));
    expect(ok1.body).toBe(mayaCouple);
    expect(await members()).toEqual([ID.maya, ID.sam].sort());
  });

  it('expiry through the public API: an expired request is a 400 body JOIN_REQUEST_EXPIRED, for approve and decline', async () => {
    const a = await requestJoin('sam', invite.code);
    const b = await requestJoin('lea', invite.code);
    await sql(`update public.join_requests set expires_at = now() - interval '1 second' where id = any($1)`, [
      [a.request_id, b.request_id],
    ]);
    expectBodyError((await approve('maya', a.request_id)) as Res, 'JOIN_REQUEST_EXPIRED');
    expectBodyError((await decline('maya', b.request_id)) as Res, 'JOIN_REQUEST_EXPIRED');
    expect(await failedAttempts('sam')).toBe(1);
    expect(await failedAttempts('lea')).toBe(1);
    expect(await members()).toEqual([ID.maya]);
  });

  it('a re-request after the request expired (not decided) is a new request; the expiry is counted once', async () => {
    const t0 = new Date();
    const a = asPending((await atTime('accept_invite_at', 'sam', invite.code, null, t0)).body);
    // At the boundary the old request is reclaimable.
    const b = asPending(
      (await atTime('accept_invite_at', 'sam', invite.code, null, new Date(Date.parse(a.expires_at)))).body,
    );
    expect(b.request_id).not.toBe(a.request_id);
    expect((await requestRow(a.request_id)).status).toBe('expired');
    expect(await failedAttempts('sam')).toBe(1);
    const c = asPending(
      (await atTime('accept_invite_at', 'sam', invite.code, null, new Date(Date.parse(a.expires_at) + 60_000))).body,
    );
    expect(c).toEqual(b);
    expect(await failedAttempts('sam')).toBe(1);
  });

  it('a request near the end of the invite lives only until the invite expires', async () => {
    const at = new Date(Date.parse(invite.expires_at) - 5 * 60_000);
    const req = asPending((await atTime('accept_invite_at', 'sam', invite.code, null, at)).body);
    expect(Date.parse(req.expires_at)).toBe(Date.parse(invite.expires_at));
  });

  it('only the inviter may approve or decline (JOIN_REQUEST_FORBIDDEN); anon is denied; unknown id is JOIN_REQUEST_EXPIRED', async () => {
    const req = await requestJoin('sam', invite.code);
    must(await as('eve').rpc('create_couple', { p_stage: 'dating' }), 'eve couple');
    for (const who of ['sam', 'lea', 'eve'] as const) {
      expectCode(await approve(who, req.request_id), 'JOIN_REQUEST_FORBIDDEN');
      expectCode(await decline(who, req.request_id), 'JOIN_REQUEST_FORBIDDEN');
    }
    expectPermissionDenied(await anon.rpc('approve_join', { p_request: req.request_id }));
    expectPermissionDenied(await anon.rpc('decline_join', { p_request: req.request_id }));
    expectPermissionDenied(await anon.rpc('pending_join_requests'));
    if (canForgeJwt) {
      expectCode(await noSubject().rpc('approve_join', { p_request: req.request_id }), 'NOT_AUTHENTICATED');
      expectCode(await noSubject().rpc('decline_join', { p_request: req.request_id }), 'NOT_AUTHENTICATED');
      expectCode(await noSubject().rpc('pending_join_requests'), 'NOT_AUTHENTICATED');
    }
    expectCode(await approve('maya', randomUUID()), 'JOIN_REQUEST_EXPIRED');
    expectCode(await decline('maya', randomUUID()), 'JOIN_REQUEST_EXPIRED');
    // Nothing happened: still pending, still unpaired; Maya can still approve.
    expect((await requestRow(req.request_id)).status).toBe('pending');
    expect(await coupleOf('sam')).toEqual([]);
    expect(await failedAttempts('sam')).toBe(0);
    expect(await approveJoin('maya', req.request_id)).toBe(mayaCouple);
  });

  it('join_requests rows: the requester and the inviter read theirs, nobody else; no client writes', async () => {
    const req = await requestJoin('sam', invite.code);
    for (const who of ['sam', 'maya'] as const) {
      const rows = must(await as(who).from('join_requests').select('id, status'), who);
      expect(rows).toEqual([{ id: req.request_id, status: 'pending' }]);
    }
    for (const who of ['lea', 'eve', 'noor'] as const) {
      expect(must(await as(who).from('join_requests').select('id'), who)).toEqual([]);
    }
    expect((await anon.from('join_requests').select('id')).error?.code).toBe('42501');
    const upd = await as('maya').from('join_requests').update({ status: 'approved' }).eq('id', req.request_id);
    expect(upd.error?.code).toBe('42501');
    const ins = await as('lea').from('join_requests').insert({
      invite_id: req.request_id,
      couple_id: mayaCouple,
      requester_id: ID.lea,
      expires_at: req.expires_at,
    });
    expect(ins.error?.code).toBe('42501');
    // The table is in the Realtime publication (the app subscribes to it).
    const pub = await sql(
      `select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'join_requests'`,
    );
    expect(pub).toHaveLength(1);
  });

  it('an invite revoked after the request voids it: JOIN_REQUEST_EXPIRED, not counted for the requester', async () => {
    const req = await requestJoin('sam', invite.code);
    let fresh = await createInvite('maya'); // revokes the old invite
    while (fresh.code === invite.code) fresh = await createInvite('maya');
    expectBodyError((await approve('maya', req.request_id)) as Res, 'JOIN_REQUEST_EXPIRED');
    expect(await failedAttempts('sam')).toBe(0);
    expect(await coupleOf('sam')).toEqual([]);
  });

  // QA-BUG-4 (sev 4, BE-26, reported to backend): the race loser gets COUPLE_FULL (not in the
  // approve_join code list), it is counted as a failed attempt for the requester, and the request
  // stays 'pending'. Sequentially the same case is JOIN_REQUEST_EXPIRED, not counted, 'expired'.
  // Kept lenient here because which branch is hit depends on timing.
  // QA-41 (#57, BE-30): the loser matches the sequential stale-invite result exactly.
  it('two approvals racing for one invite: one joins; the loser gets a 400 JOIN_REQUEST_EXPIRED, uncounted, request expired', async () => {
    const a = await requestJoin('sam', invite.code);
    const b = await requestJoin('lea', invite.code);
    const reqs = [
      { who: 'sam' as const, id: a.request_id },
      { who: 'lea' as const, id: b.request_id },
    ];
    const results = (await Promise.all(reqs.map((r) => approve('maya', r.id)))) as Res[];
    const winIdx = results.findIndex((r) => r.error === null);
    expect(winIdx, 'exactly one approval wins').toBeGreaterThanOrEqual(0);
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    const win = reqs[winIdx];
    const lose = reqs[1 - winIdx];

    expect(results[winIdx].data).toBe(mayaCouple);
    expectBodyError(results[1 - winIdx], 'JOIN_REQUEST_EXPIRED'); // never COUPLE_FULL
    expect((await requestRow(win.id)).status).toBe('approved');
    expect((await requestRow(lose.id)).status).toBe('expired');
    expect(await failedAttempts(lose.who)).toBe(0);
    expect(await failedAttempts(win.who)).toBe(0);
    expect(await members()).toEqual([ID.maya, ID[win.who]].sort());
    expect(await coupleOf(lose.who)).toEqual([]);
    // A retry of the losing approval stays expired.
    expectBodyError((await approve('maya', lose.id)) as Res, 'JOIN_REQUEST_EXPIRED');
    expect(await failedAttempts(lose.who)).toBe(0);
  });
});

describe('at most 3 live pending requests per invite (BE-26, SEC-04)', () => {
  beforeEach(setup);

  it('the 4th requester is RATE_LIMITED (400 body, not counted); pending retries and a valid link bypass the cap', async () => {
    const reqs = [];
    for (const who of ['sam', 'lea', 'noor'] as const) reqs.push(await requestJoin(who, invite.code));
    expect(new Set(reqs.map((r) => r.request_id)).size).toBe(3);

    expectBodyError((await typed('finn', invite.code)) as Res, 'RATE_LIMITED');
    expect(await failedAttempts('finn')).toBe(0);
    expect(await coupleOf('finn')).toEqual([]);
    // An existing requester's retry is not a new request: same id, not capped.
    expect(await requestJoin('sam', invite.code)).toEqual(reqs[0]);
    // The valid link pairs at once, cap or not.
    expect(await joinByLink('finn', invite)).toBe(mayaCouple);
    expect(await members()).toEqual([ID.maya, ID.finn].sort());
    // The used invite has no live requests for the inviter any more.
    expect(must(await pending('maya'), 'pending')).toEqual([]);
  });

  it('a slot is reclaimable once a request expires (at the boundary, clock pinned)', async () => {
    const t0 = new Date();
    for (const who of ['sam', 'lea', 'noor'] as const) {
      asPending((await atTime('accept_invite_at', who, invite.code, null, t0)).body);
    }
    const blocked = await atTime(
      'accept_invite_at',
      'finn',
      invite.code,
      null,
      new Date(t0.getTime() + 15 * 60_000 - 1000),
    );
    expect(blocked.body).toMatchObject({ message: 'RATE_LIMITED' });
    const freed = await atTime(
      'accept_invite_at',
      'finn',
      invite.code,
      null,
      new Date(t0.getTime() + 15 * 60_000),
    );
    asPending(freed.body);
  });

  it('a declined request frees its slot', async () => {
    const reqs = [];
    for (const who of ['sam', 'lea', 'noor'] as const) reqs.push(await requestJoin(who, invite.code));
    must(await decline('maya', reqs[1].request_id), 'decline lea');
    asPending(must(await typed('finn', invite.code), 'finn'));
  });
});

describe('pending_join_requests (BE-26, SEC-04)', () => {
  beforeEach(setup);
  afterEach(async () => {
    for (const who of ['sam', 'lea'] as const) {
      ok(
        await admin.from('profiles').update({ display_name: PERSONAS[who].display_name }).eq('id', ID[who]),
        `restore ${who}`,
      );
    }
  });

  it('the inviter gets {request_id, requester_name, expires_at}: trimmed first name, at most 30 characters', async () => {
    const long = 'Leopoldinaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 43 characters
    ok(await admin.from('profiles').update({ display_name: '  Samuel  Jones ' }).eq('id', ID.sam), 'sam name');
    ok(await admin.from('profiles').update({ display_name: `${long} Smith` }).eq('id', ID.lea), 'lea name');
    const s = await requestJoin('sam', invite.code);
    const l = await requestJoin('lea', invite.code);

    const rows = must(await pending('maya'), 'maya pending');
    expect(rows.map((r) => Object.keys(r).sort())).toEqual([
      ['expires_at', 'request_id', 'requester_name'],
      ['expires_at', 'request_id', 'requester_name'],
    ]);
    expect(rows.map((r) => r.request_id)).toEqual([s.request_id, l.request_id]);
    expect(rows[0].requester_name).toBe('Samuel');
    expect(rows[1].requester_name).toBe(long.slice(0, 30));
    expect(rows[1].requester_name.length).toBe(30);
    expect(Date.parse(rows[0].expires_at)).toBe(Date.parse(s.expires_at));
    const text = JSON.stringify(rows);
    for (const secret of [PERSONAS.sam.email, PERSONAS.lea.email, ID.sam, ID.lea, 'Jones', 'Smith']) {
      expect(text, `leaks ${secret}`).not.toContain(secret);
    }
  });

  it('is empty for everyone but the inviter: requesters, outsiders, a requester with an own invite', async () => {
    await requestJoin('sam', invite.code);
    must(await as('lea').rpc('create_couple', { p_stage: 'dating' }), 'lea couple');
    await createInvite('lea');
    for (const who of ['sam', 'lea', 'eve', 'noor'] as const) {
      expect(must(await pending(who), who)).toEqual([]);
    }
    expect(must(await pending('maya'), 'maya')).toHaveLength(1);
  });

  it('drops decided, expired and revoked-invite requests', async () => {
    const s = await requestJoin('sam', invite.code);
    const l = await requestJoin('lea', invite.code);
    const n = await requestJoin('noor', invite.code);
    must(await decline('maya', l.request_id), 'decline lea');
    await sql(`update public.join_requests set expires_at = now() - interval '1 second' where id = $1`, [
      n.request_id,
    ]);
    expect(must(await pending('maya'), 'after').map((r) => r.request_id)).toEqual([s.request_id]);
    await createInvite('maya'); // revokes the invite Sam asked for
    expect(must(await pending('maya'), 'revoked')).toEqual([]);
  });
});
