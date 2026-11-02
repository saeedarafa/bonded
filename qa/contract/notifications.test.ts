// QA-03: BE-07 notification_prefs (D23), register_push_token and timezone validation (CONTRACTS §2).
// Bodies and tokens are FIXTURE- values. The clock is not involved; quiet-hours logic is a pure
// SQL function and is called with explicit times.
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ID,
  admin,
  anon,
  as,
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

const DEFAULTS = {
  ritual_time: '21:00:00',
  daily_reminder: true,
  partner_answered: true,
  replies: true,
  last_call: true,
  nudges: true,
  tips: false,
  quiet_start: '23:00:00',
  quiet_end: '07:00:00',
};
const token = () => `FIXTURE-CONTRACT-TOKEN-${randomUUID()}`;

describe('notification_prefs (BE-07, D23)', () => {
  beforeAll(resetWorld);
  beforeEach(async () => {
    // Back to the documented defaults for the personas under test.
    for (const who of ['maya', 'sam', 'eve'] as const) {
      ok(
        await admin
          .from('notification_prefs')
          .upsert({ user_id: ID[who], ...DEFAULTS }, { onConflict: 'user_id' }),
        `reset prefs ${who}`,
      );
    }
  });

  it('every new account gets a row with the D23 defaults (tips are opt-in)', async () => {
    const email = `fixture-prefs-${randomUUID()}@example.test`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error) throw new Error(`createUser: ${created.error.message}`);
    const id = created.data.user.id;
    try {
      const row = must(
        await admin.from('notification_prefs').select('*').eq('user_id', id).single(),
        'new user prefs',
      );
      expect(row).toMatchObject({ user_id: id, ...DEFAULTS });
    } finally {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it('a user reads only their own row, even when paired; anon is denied', async () => {
    await resetWorld();
    await pair('maya', 'sam');
    const rows = must(await as('maya').from('notification_prefs').select('user_id'), 'maya');
    expect(rows.map((r) => r.user_id)).toEqual([ID.maya]);
    expectPermissionDenied(await anon.from('notification_prefs').select('user_id'));
  });

  it('updates my own toggles and times; updated_at moves', async () => {
    const before = must(
      await as('maya').from('notification_prefs').select('updated_at').single(),
      'before',
    );
    const after = must(
      await as('maya')
        .from('notification_prefs')
        .update({ ritual_time: '20:15', tips: true, nudges: false, quiet_start: '22:00' })
        .eq('user_id', ID.maya)
        .select('*')
        .single(),
      'update',
    );
    expect(after).toMatchObject({
      ritual_time: '20:15:00',
      tips: true,
      nudges: false,
      quiet_start: '22:00:00',
      quiet_end: '07:00:00',
    });
    expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(before.updated_at));
  });

  it("cannot change a partner's or anyone else's prefs (RLS: no rows) nor hand a row over (42501)", async () => {
    const other = must(
      await as('maya')
        .from('notification_prefs')
        .update({ tips: true })
        .eq('user_id', ID.sam)
        .select('user_id'),
      'sam via maya',
    );
    expect(other).toEqual([]);
    const sam = must(
      await admin.from('notification_prefs').select('tips').eq('user_id', ID.sam).single(),
      'sam',
    );
    expect(sam.tips).toBe(false);
    const steal = await as('maya')
      .from('notification_prefs')
      .update({ user_id: ID.eve })
      .eq('user_id', ID.maya);
    expect(steal.error?.code).toBe('42501');
  });

  it('cannot insert a row for someone else (42501) or a second row for me (23505)', async () => {
    await admin.from('notification_prefs').delete().eq('user_id', ID.eve);
    const forged = await as('maya').from('notification_prefs').insert({ user_id: ID.eve });
    expect(forged.error?.code).toBe('42501');
    const dup = await as('maya').from('notification_prefs').insert({ user_id: ID.maya });
    expect(dup.error?.code).toBe('23505');
    // Own row can be created when missing (the app upserts it).
    ok(await as('eve').from('notification_prefs').insert({ user_id: ID.eve }), 'eve own row');
  });

  it('the row is never deletable by the client (removed with the account)', async () => {
    const del = await as('maya').from('notification_prefs').delete().eq('user_id', ID.maya);
    expect(del.error?.code).toBe('42501');
    expect(must(await as('maya').from('notification_prefs').select('user_id'), 'still')).toHaveLength(
      1,
    );
  });

  it('quiet start and end must differ (23514); a window wrapping midnight is fine', async () => {
    const same = await as('maya')
      .from('notification_prefs')
      .update({ quiet_start: '07:00', quiet_end: '07:00' })
      .eq('user_id', ID.maya);
    expect(same.error?.code).toBe('23514');
    ok(
      await as('maya')
        .from('notification_prefs')
        .update({ quiet_start: '22:00', quiet_end: '06:00' })
        .eq('user_id', ID.maya),
      'wrapping window',
    );
  });

  it('profiles no longer has reminder_time (moved to notification_prefs)', async () => {
    const res = await loose(as('maya')).from('profiles').select('reminder_time');
    expect(res.error, 'column must be gone').not.toBeNull();
  });
});

describe('private.in_quiet_hours (BE-07, for BE-08 notify)', () => {
  const quiet = async (local: string, start: string, end: string) =>
    (
      await sql<{ r: boolean }>('select private.in_quiet_hours($1::time, $2::time, $3::time) r', [
        local,
        start,
        end,
      ])
    )[0].r;

  it('a window that wraps midnight (23:00 to 07:00)', async () => {
    expect(await quiet('23:00', '23:00', '07:00')).toBe(true); // start is inside
    expect(await quiet('02:30', '23:00', '07:00')).toBe(true);
    expect(await quiet('06:59:59', '23:00', '07:00')).toBe(true);
    expect(await quiet('07:00', '23:00', '07:00')).toBe(false); // end is outside
    expect(await quiet('12:00', '23:00', '07:00')).toBe(false);
    expect(await quiet('22:59:59', '23:00', '07:00')).toBe(false);
  });

  it('a same-day window (13:00 to 15:00)', async () => {
    expect(await quiet('13:00', '13:00', '15:00')).toBe(true);
    expect(await quiet('14:59', '13:00', '15:00')).toBe(true);
    expect(await quiet('15:00', '13:00', '15:00')).toBe(false);
    expect(await quiet('00:00', '13:00', '15:00')).toBe(false);
  });

  it('is not callable through the API', async () => {
    const res = await loose(as('maya')).rpc('in_quiet_hours', {
      p_local: '01:00',
      p_start: '23:00',
      p_end: '07:00',
    });
    expect(res.error?.code).toBe('PGRST202');
  });
});

describe('register_push_token (BE-07)', () => {
  beforeEach(resetWorld);

  it('registers a token for me; calling it again is a no-op', async () => {
    const t = token();
    ok(await as('maya').rpc('register_push_token', { p_token: t, p_platform: 'ios' }), 'first');
    ok(await as('maya').rpc('register_push_token', { p_token: t, p_platform: 'ios' }), 'retry');
    const rows = must(await as('maya').from('push_tokens').select('token, platform'), 'mine');
    expect(rows).toEqual([{ token: t, platform: 'ios' }]);
  });

  it('moves the token to the signed-in user when another person signs in on the same device', async () => {
    const t = token();
    ok(await as('maya').rpc('register_push_token', { p_token: t, p_platform: 'android' }), 'maya');
    ok(await as('sam').rpc('register_push_token', { p_token: t, p_platform: 'ios' }), 'sam');
    expect(must(await as('maya').from('push_tokens').select('token'), 'maya')).toEqual([]);
    expect(must(await as('sam').from('push_tokens').select('token, platform'), 'sam')).toEqual([
      { token: t, platform: 'ios' },
    ]);
    const owner = must(
      await admin.from('push_tokens').select('user_id').eq('token', t).single(),
      'owner',
    );
    expect(owner.user_id).toBe(ID.sam);
  });

  it('rejects a token outside 8..512 characters and an unknown platform (23514)', async () => {
    for (const bad of ['short', 'x'.repeat(513)]) {
      const res = await as('maya').rpc('register_push_token', { p_token: bad, p_platform: 'ios' });
      expect(res.error?.code, `length ${bad.length}`).toBe('23514');
    }
    ok(
      await as('maya').rpc('register_push_token', { p_token: 'x'.repeat(512), p_platform: 'ios' }),
      '512 is the limit',
    );
    const web = await as('maya').rpc('register_push_token', {
      p_token: token(),
      p_platform: 'web',
    });
    expect(web.error?.code).toBe('23514');
  });

  it('anon is denied (42501); a no-subject JWT is NOT_AUTHENTICATED', async () => {
    expectPermissionDenied(
      await anon.rpc('register_push_token', { p_token: token(), p_platform: 'ios' }),
    );
    if (canForgeJwt) {
      expectCode(
        await noSubject().rpc('register_push_token', { p_token: token(), p_platform: 'ios' }),
        'NOT_AUTHENTICATED',
      );
    }
  });

  it('push_tokens: anon reads nothing (42501); the partner never sees my token', async () => {
    await pair('maya', 'sam');
    ok(await as('maya').rpc('register_push_token', { p_token: token(), p_platform: 'ios' }), 'reg');
    expectPermissionDenied(await anon.from('push_tokens').select('token'));
    expect(must(await as('sam').from('push_tokens').select('token'), 'sam')).toEqual([]);
  });
});

describe('timezone validation (BE-07): IANA names only', () => {
  let original: string;
  beforeAll(async () => {
    original = must(
      await admin.from('profiles').select('timezone').eq('id', ID.maya).single(),
      'tz',
    ).timezone;
  });
  const setProfile = (tz: string) =>
    as('maya').from('profiles').update({ timezone: tz }).eq('id', ID.maya);

  it('accepts IANA names (Europe/Berlin, America/Argentina/Buenos_Aires, UTC)', async () => {
    for (const tz of ['Europe/Berlin', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata', 'UTC']) {
      ok(await setProfile(tz), tz);
    }
    const now = must(await admin.from('profiles').select('timezone').eq('id', ID.maya).single(), 'r');
    expect(now.timezone).toBe('UTC');
    ok(await admin.from('profiles').update({ timezone: original }).eq('id', ID.maya), 'restore');
  });

  it('rejects abbreviations, POSIX forms, made-up zones and empty values (23514)', async () => {
    for (const tz of ['EST', 'PST8PDT', 'UTC+3', 'GMT', 'Mars/Olympus_Mons', 'Europe/', '', 'berlin']) {
      const res = await setProfile(tz);
      expect(res.error?.code, `profile ${JSON.stringify(tz)}`).toBe('23514');
    }
    const kept = must(await admin.from('profiles').select('timezone').eq('id', ID.maya).single(), 'r');
    expect(kept.timezone).toBe(original);
  });

  it('couples.timezone is checked the same way (service role, so no RLS in the way)', async () => {
    await resetWorld();
    const couple = await pair('maya', 'sam');
    const bad = await admin.from('couples').update({ timezone: 'EST' }).eq('id', couple);
    expect(bad.error?.code).toBe('23514');
    ok(await admin.from('couples').update({ timezone: 'Asia/Tokyo' }).eq('id', couple), 'valid');
  });

  it('private.is_valid_timezone: null is not valid', async () => {
    const rows = await sql<{ r: boolean }>('select private.is_valid_timezone(null) r');
    expect(rows[0].r).toBe(false);
  });

  it('a new couple takes the creator timezone, which is always valid', async () => {
    await resetWorld();
    const couple = await pair('maya', 'sam');
    const c = must(await admin.from('couples').select('timezone').eq('id', couple).single(), 'c');
    expect(c.timezone).toBe(original);
  });
});
