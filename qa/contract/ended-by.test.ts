// QA-21: BE-38 `couples.ended_by` / `ended_reason` (D08, D09; CONTRACTS §2 `unpair`, Couple row,
// §3 Realtime, §4 `delete-account`; migration 20261110170000_couple_ended_by.sql).
// - unpair(): ended_by = the caller, ended_reason = 'unpaired'.
// - Account deletion (the profile-delete trigger behind `delete-account`): ended_reason =
//   'deleted', ended_by = null, and the deleted user's uuid is cleared from ended_by of couples
//   they unpaired earlier (D09: nothing of a deleted account is kept, no uuid and no name).
// - Null in both on active couples and on a solo space archived by a join (D04/D37).
// - Both former members read the columns through the API for the 30-day window; outsiders and
//   anon read nothing; clients cannot write them (server-owned).
//
// Account deletion runs through the Auth admin API (`auth.admin.deleteUser`), the same call the
// `delete-account` function makes after removing the avatar; the DB trigger is what is tested.
// Deleted accounts are throwaway users, never the fixed personas.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { Database } from '../../src/types/database';
import {
  ID,
  admin,
  anon,
  as,
  expectCode,
  must,
  ok,
  pair,
  resetWorld,
  sql,
  type Db,
} from './helpers';
import type { PersonaName } from './personas';

const stack = inject('stack');
const opts = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

type Temp = { id: string; db: Db };
const temps: string[] = [];

/** A throwaway account signed in through a real email OTP (as global-setup does for personas). */
async function tempUser(name: string): Promise<Temp> {
  const email = `fixture-ended-by-${randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name },
  });
  if (created.error) throw new Error(`createUser: ${created.error.message}`);
  const id = created.data.user.id;
  temps.push(id);
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const otp = link.data.properties?.email_otp;
  if (link.error || !otp) throw new Error(`OTP: ${link.error?.message ?? 'no email_otp'}`);
  const signIn = createClient<Database>(stack.url, stack.anonKey, opts);
  const { data, error } = await signIn.auth.verifyOtp({ email, token: otp, type: 'email' });
  if (error || !data.session) throw new Error(`sign in: ${error?.message ?? 'no session'}`);
  const db = createClient<Database>(stack.url, stack.anonKey, {
    ...opts,
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  return { id, db };
}

/** What `delete-account` does to the database: the Auth user goes, the profile cascades. */
async function deleteAccount(t: Temp) {
  const res = await admin.auth.admin.deleteUser(t.id);
  if (res.error) throw new Error(`deleteUser: ${res.error.message}`);
  temps.splice(temps.indexOf(t.id), 1);
}

/** The temp user invites, `joiner` (a persona with no couple) opens the link: paired at once. */
async function pairWithTemp(t: Temp, joiner: PersonaName): Promise<string> {
  must(await t.db.rpc('create_couple', { p_stage: 'dating' }), 'temp create_couple');
  const inv = must(await t.db.rpc('create_invite'), 'temp create_invite');
  if (!inv.code || !inv.token) throw new Error(`create_invite: ${JSON.stringify(inv)}`);
  const id = must(
    await as(joiner).rpc('accept_invite', { p_code: inv.code, p_token: inv.token }),
    `${joiner} accept_invite (link)`,
  );
  if (typeof id !== 'string') throw new Error(`accept_invite: ${JSON.stringify(id)}`);
  return id;
}

/** The ended couple as the app reads it (CONTRACTS Couple row), through `who`'s session. */
const endedRow = (db: Db, couple: string) =>
  db
    .from('couples')
    .select('id, status, ended_at, ended_by, ended_reason, couple_members(user_id, left_at)')
    .eq('id', couple);

/** The database row, read directly (setup and D09 assertions only). */
const dbRow = async (couple: string) =>
  (
    await sql<{ status: string; ended_by: string | null; ended_reason: string | null }>(
      `select status, ended_by, ended_reason::text from couples where id = $1`,
      [couple],
    )
  )[0];

afterAll(async () => {
  for (const id of [...temps]) await admin.auth.admin.deleteUser(id);
  await resetWorld();
});

describe('unpair records who ended it (BE-38, D08)', () => {
  beforeEach(resetWorld);

  it('an active couple has ended_by and ended_reason null, read by both members', async () => {
    const couple = await pair('maya', 'sam');
    for (const who of ['maya', 'sam'] as const) {
      const row = must(
        await as(who)
          .from('couples')
          .select('id, status, ended_by, ended_reason')
          .eq('status', 'active')
          .single(),
        `${who} active`,
      );
      expect(row).toEqual({ id: couple, status: 'active', ended_by: null, ended_reason: null });
    }
  });

  it("Maya unpairs: ended_by = Maya, ended_reason = 'unpaired'; both read it, the actor knows it was her", async () => {
    const couple = await pair('maya', 'sam');
    ok(await as('maya').rpc('unpair'), 'maya unpair');
    for (const who of ['maya', 'sam'] as const) {
      const [row] = must(await endedRow(as(who), couple), `${who} ended`);
      expect(row).toMatchObject({
        id: couple,
        status: 'ended',
        ended_by: ID.maya,
        ended_reason: 'unpaired',
      });
      expect(row.ended_at).not.toBeNull();
      expect(row.couple_members.map((m) => m.user_id).sort()).toEqual([ID.maya, ID.sam].sort());
    }
  });

  it('Sam unpairs: ended_by = Sam (the caller, whichever member it is)', async () => {
    const couple = await pair('maya', 'sam');
    ok(await as('sam').rpc('unpair'), 'sam unpair');
    const [row] = must(await endedRow(as('maya'), couple), 'maya reads');
    expect(row).toMatchObject({ ended_by: ID.sam, ended_reason: 'unpaired' });
  });

  it('a retry (NOT_PAIRED) by the other member does not change ended_by', async () => {
    const couple = await pair('maya', 'sam');
    ok(await as('maya').rpc('unpair'), 'maya unpair');
    expectCode(await as('sam').rpc('unpair'), 'NOT_PAIRED');
    expectCode(await as('maya').rpc('unpair'), 'NOT_PAIRED');
    expect(await dbRow(couple)).toEqual({
      status: 'ended',
      ended_by: ID.maya,
      ended_reason: 'unpaired',
    });
  });

  it('both unpair at once: ended_by is the one whose call succeeded', async () => {
    const couple = await pair('maya', 'sam');
    const [m, s] = await Promise.all([as('maya').rpc('unpair'), as('sam').rpc('unpair')]);
    const winners = [m.error ? null : ID.maya, s.error ? null : ID.sam].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(await dbRow(couple)).toEqual({
      status: 'ended',
      ended_by: winners[0],
      ended_reason: 'unpaired',
    });
  });

  it('a solo space archived by a join (D04/D37) keeps both null', async () => {
    must(await as('sam').rpc('create_couple', { p_stage: 'dating' }), 'sam solo');
    const [{ id: soloId }] = await sql<{ id: string }>(
      `select couple_id id from couple_members where user_id = $1`,
      [ID.sam],
    );
    await pair('maya', 'sam', 'code', { archiveOwn: true });
    const archived = await sql<{
      id: string;
      ended_by: string | null;
      ended_reason: string | null;
    }>(
      `select c.id, c.ended_by, c.ended_reason::text from couples c
         join couple_members m on m.couple_id = c.id
        where m.user_id = $1 and c.status = 'ended'`,
      [ID.sam],
    );
    expect(archived).toHaveLength(1);
    expect(archived[0]).toEqual({ id: soloId, ended_by: null, ended_reason: null });
  });
});

describe('who can read ended_by / ended_reason (BE-38)', () => {
  let couple: string;
  beforeAll(async () => {
    await resetWorld();
    couple = await pair('maya', 'sam');
    ok(await as('sam').rpc('unpair'), 'sam unpair');
  });

  it('the survivor (the one who did not end it) reads both columns of the ended couple', async () => {
    const row = must(
      await as('maya')
        .from('couples')
        .select('id, ended_by, ended_reason')
        .eq('status', 'ended')
        .maybeSingle(),
      'maya ended',
    );
    expect(row).toEqual({ id: couple, ended_by: ID.sam, ended_reason: 'unpaired' });
  });

  it('a non-member reads nothing: not by id, not by ended_by, not by reason', async () => {
    for (const q of [
      as('eve').from('couples').select('id, ended_by, ended_reason').eq('id', couple),
      as('eve').from('couples').select('id').eq('ended_by', ID.sam),
      as('eve').from('couples').select('id').eq('ended_reason', 'unpaired'),
    ]) {
      expect(must(await q, 'eve')).toEqual([]);
    }
    // A former member's new partner is a non-member too.
    await pair('maya', 'finn');
    expect(must(await endedRow(as('finn'), couple), 'finn')).toEqual([]);
    const mine = must(await endedRow(as('maya'), couple), 'maya still reads');
    expect(mine).toHaveLength(1);
  });

  it('anon reads nothing', async () => {
    const res = await anon.from('couples').select('id, ended_by, ended_reason').eq('id', couple);
    expect(res.data ?? []).toEqual([]);
  });

  it('after the 30-day window neither former member reads it', async () => {
    await sql(
      `with c as (update couples set ended_at = now() - interval '30 days 1 minute' where id = $1 returning id)
       update couple_members set left_at = now() - interval '30 days 1 minute' where couple_id in (select id from c)`,
      [couple],
    );
    for (const who of ['maya', 'sam'] as const) {
      expect(must(await endedRow(as(who), couple), who)).toEqual([]);
    }
  });
});

describe('ended_by and ended_reason are server-owned (BE-38)', () => {
  let active: string;
  let ended: string;
  beforeAll(async () => {
    await resetWorld();
    ended = await pair('maya', 'sam');
    ok(await as('maya').rpc('unpair'), 'maya unpair');
    active = await pair('eve', 'finn');
  });

  it('a member cannot set them on an active couple (permission denied, nothing changes)', async () => {
    for (const patch of [
      { ended_by: ID.eve },
      { ended_reason: 'unpaired' as const },
      { ended_by: ID.finn, ended_reason: 'deleted' as const },
    ]) {
      const res = await as('eve').from('couples').update(patch).eq('id', active).select('id');
      expect(res.error?.code, JSON.stringify(Object.keys(patch))).toBe('42501');
    }
    expect(await dbRow(active)).toEqual({ status: 'active', ended_by: null, ended_reason: null });
    // The writable columns still work for the same member.
    ok(
      await as('eve').from('couples').update({ partner_name: 'Finn' }).eq('id', active),
      'partner_name',
    );
  });

  it('a former member cannot rewrite them on the ended couple', async () => {
    for (const who of ['maya', 'sam'] as const) {
      const res = await as(who)
        .from('couples')
        .update({ ended_by: ID.sam, ended_reason: 'deleted' })
        .eq('id', ended)
        .select('id');
      expect(res.error?.code, who).toBe('42501');
    }
    expect(await dbRow(ended)).toEqual({
      status: 'ended',
      ended_by: ID.maya,
      ended_reason: 'unpaired',
    });
  });
});

describe('account deletion keeps nothing of the deleted user (BE-38, D09)', () => {
  beforeEach(resetWorld);

  it("the partner deletes their account: 'deleted' with ended_by null; Maya reads it, her history stays", async () => {
    const t = await tempUser('FIXTURE-ENDED-BY-OLLY');
    const couple = await pairWithTemp(t, 'maya');
    const cq = must(await as('maya').rpc('get_daily_question'), 'daily').id;
    ok(
      await as('maya')
        .from('answers')
        .insert({ couple_question_id: cq, user_id: ID.maya, body: 'FIXTURE-CONTRACT-ENDED-BY' }),
      'maya answers',
    );
    await deleteAccount(t);

    const [row] = must(await endedRow(as('maya'), couple), 'maya reads');
    expect(row).toMatchObject({
      id: couple,
      status: 'ended',
      ended_by: null,
      ended_reason: 'deleted',
    });
    expect(row.ended_at).not.toBeNull();
    // Only Maya's own membership is left (with left_at), and only her profile is readable.
    expect(row.couple_members).toEqual([{ user_id: ID.maya, left_at: expect.any(String) }]);
    expect(must(await as('maya').from('profiles').select('id'), 'profiles')).toEqual([
      { id: ID.maya },
    ]);
    expect(
      must(await as('maya').from('answers').select('body').eq('couple_question_id', cq), 'mine'),
    ).toEqual([{ body: 'FIXTURE-CONTRACT-ENDED-BY' }]);
    // Maya is unpaired and can start again.
    expectCode(await as('maya').rpc('unpair'), 'NOT_PAIRED');
    must(await as('maya').rpc('create_couple', { p_stage: 'dating' }), 'maya solo');
  });

  it('no uuid or name of the deleted user is left in couples (D09)', async () => {
    const t = await tempUser('FIXTURE-ENDED-BY-NOOR');
    const couple = await pairWithTemp(t, 'maya');
    await deleteAccount(t);
    const [hit] = await sql<{ n: number }>(
      `select count(*)::int n from couples c
        where c.id = $1 and (c.ended_by = $2 or row_to_json(c)::text like '%' || $2 || '%'
                             or row_to_json(c)::text like '%FIXTURE-ENDED-BY-NOOR%')`,
      [couple, t.id],
    );
    expect(hit.n).toBe(0);
    const [any] = await sql<{ n: number }>(
      `select count(*)::int n from couples where ended_by = $1`,
      [t.id],
    );
    expect(any.n).toBe(0);
  });

  it("the unpair caller later deletes their account: ended_by is cleared, ended_reason stays 'unpaired'", async () => {
    const t = await tempUser('FIXTURE-ENDED-BY-RAY');
    const couple = await pairWithTemp(t, 'maya');
    ok(await t.db.rpc('unpair'), 'temp unpair');
    expect(must(await endedRow(as('maya'), couple), 'before')[0]).toMatchObject({
      ended_by: t.id,
      ended_reason: 'unpaired',
    });
    await deleteAccount(t);
    const [row] = must(await endedRow(as('maya'), couple), 'after');
    expect(row).toMatchObject({ status: 'ended', ended_by: null, ended_reason: 'unpaired' });
    expect(row.couple_members.map((m) => m.user_id)).toEqual([ID.maya]);
  });

  it('the survivor of an unpair deleting their account leaves the actor in ended_by', async () => {
    const t = await tempUser('FIXTURE-ENDED-BY-ZED');
    const couple = await pairWithTemp(t, 'maya');
    ok(await as('maya').rpc('unpair'), 'maya unpair');
    await deleteAccount(t);
    const [row] = must(await endedRow(as('maya'), couple), 'maya reads');
    expect(row).toMatchObject({ status: 'ended', ended_by: ID.maya, ended_reason: 'unpaired' });
  });

  it('a deletion while paired ends only the active couple; an older archive keeps its own values', async () => {
    // Sam ended an earlier couple with Maya; later Sam pairs with a temp user who deletes.
    const old = await pair('maya', 'sam');
    ok(await as('sam').rpc('unpair'), 'sam unpair');
    const t = await tempUser('FIXTURE-ENDED-BY-KAI');
    const couple = await pairWithTemp(t, 'sam');
    await deleteAccount(t);
    expect(await dbRow(couple)).toEqual({
      status: 'ended',
      ended_by: null,
      ended_reason: 'deleted',
    });
    expect(await dbRow(old)).toEqual({
      status: 'ended',
      ended_by: ID.sam,
      ended_reason: 'unpaired',
    });
    // Sam reads both of his ended couples with their own reasons; Eve reads neither.
    const sams = must(
      await as('sam').from('couples').select('id, ended_by, ended_reason').eq('status', 'ended'),
      'sam ended',
    );
    expect(sams.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: old, ended_by: ID.sam, ended_reason: 'unpaired' },
        { id: couple, ended_by: null, ended_reason: 'deleted' },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(
      must(await as('eve').from('couples').select('id').in('id', [old, couple]), 'eve'),
    ).toEqual([]);
  });

  it("a solo account's deletion ends its solo space as 'deleted' with no actor", async () => {
    const t = await tempUser('FIXTURE-ENDED-BY-SOLO');
    must(await t.db.rpc('create_couple', { p_stage: 'dating' }), 'temp solo');
    const [{ id: solo }] = await sql<{ id: string }>(
      `select couple_id id from couple_members where user_id = $1`,
      [t.id],
    );
    await deleteAccount(t);
    expect(await dbRow(solo)).toEqual({ status: 'ended', ended_by: null, ended_reason: 'deleted' });
    const [left] = await sql<{ n: number }>(
      `select count(*)::int n from couple_members where couple_id = $1`,
      [solo],
    );
    expect(left.n).toBe(0);
  });
});

describe('the end reaches the remaining partner through couple_members Realtime (BE-38)', () => {
  it('couple_members is published, couples is not (CONTRACTS §3)', async () => {
    const rows = await sql<{ tablename: string }>(
      `select tablename from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'
          and tablename in ('couples', 'couple_members') order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(['couple_members']);
  });

  it("the remaining partner's own couple_members row (left_at) is readable after unpair and after deletion", async () => {
    await resetWorld();
    const c1 = await pair('maya', 'sam');
    ok(await as('maya').rpc('unpair'), 'maya unpair');
    const samRow = must(
      await as('sam').from('couple_members').select('user_id, left_at').eq('couple_id', c1),
      'sam members',
    );
    expect(samRow.find((m) => m.user_id === ID.sam)?.left_at).not.toBeNull();

    await resetWorld();
    const t = await tempUser('FIXTURE-ENDED-BY-RT');
    const c2 = await pairWithTemp(t, 'maya');
    await deleteAccount(t);
    const mayaRow = must(
      await as('maya').from('couple_members').select('user_id, left_at').eq('couple_id', c2),
      'maya members',
    );
    expect(mayaRow).toEqual([{ user_id: ID.maya, left_at: expect.any(String) }]);
  });
});
