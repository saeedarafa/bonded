// QA-27: D46 voice (BE-42, BE-43, BE-43b; CONTRACTS §2 "Answer / edit", "Send message", "Voice
// upload", `start_voice_upload`, error codes VOICE_LIMIT / VOICE_TOO_LONG / INVALID_VOICE; §3
// `delete-account`, `voice-cleanup`). Answer length by tier and after a lapse (BE-41) is in
// tables.test.ts. Everything goes through supabase-js as the app calls it (PostgREST + Storage API)
// with real persona sessions; `admin` and `sql` are for setup, clock shifts and reading what is
// stored. Uploads always use the name `start_voice_upload` issues (BE-43).
// Release blocker: the partner never downloads a voice answer before answering (D13).
// Recordings are FIXTURE bytes (no audio, no user content).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type { Database } from '../../src/types/database';
import {
  ID,
  admin,
  anon,
  as,
  ensureContent,
  expectCode,
  expectPermissionDenied,
  must,
  ok,
  pair,
  PRICE,
  resetWorld,
  sql,
  type Db,
} from './helpers';
import { PERSONAS, type PersonaName } from './personas';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stack = inject('stack');
const KB = 1024;
const AUDIO = 'audio/mp4';
const ALLOWED_TYPES = [
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/aacp',
  'audio/ogg',
  'audio/opus',
];
const NAME_RE = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(m4a|aac|ogg|opus)$/;

type Who = PersonaName | Temp;
type Temp = { id: string; db: Db; token: string };
const db = (who: Who): Db => (typeof who === 'string' ? as(who) : who.db);
const uid = (who: Who): string => (typeof who === 'string' ? ID[who] : who.id);

/** FIXTURE recording: n bytes, the first 16 tagged so a swapped object shows. */
const recording = (n: number, tag = 'A') => {
  const b = Buffer.alloc(n, 0x20);
  b.write(`FIXTURE-VOICE-${tag}`.slice(0, Math.min(16, n)));
  return b;
};

// ───────────────────────────── helpers ─────────────────────────────

const slotRes = (who: Who | 'anon', ext: string | null = 'm4a') =>
  (who === 'anon' ? anon : db(who)).rpc('start_voice_upload', ext === null ? {} : { p_ext: ext });

async function slot(who: Who, ext = 'm4a'): Promise<string> {
  const name = must(await slotRes(who, ext), `start_voice_upload ${uid(who)}`);
  return name as string;
}

const upload = (
  who: Who | 'anon',
  name: string,
  body: Buffer = recording(10 * KB),
  opts: { contentType?: string; upsert?: boolean } = { contentType: AUDIO },
) => (who === 'anon' ? anon : db(who)).storage.from('voice').upload(name, body, { upsert: false, ...opts });

/** A take: slot, then upload of `size` bytes. Returns the object name. */
async function take(who: Who, size = 10 * KB, tag = 'A'): Promise<string> {
  const name = await slot(who);
  const res = await upload(who, name, recording(size, tag));
  if (res.error) throw new Error(`upload: ${JSON.stringify(res.error)}`);
  return name;
}

type StorageRes = { error: unknown };
/** Storage rejects with HTTP 400 and the body's statusCode/code (CONTRACTS §2 Voice upload). */
function expectStorage(res: StorageRes, statusCode: string, code: string, what = '') {
  expect(res.error, `${what}: expected Storage ${code}`).toBeTruthy();
  const e = res.error as { statusCode?: string; code?: string };
  expect({ statusCode: e.statusCode, code: e.code }, what).toEqual({ statusCode, code });
}

/** What Storage holds for a name (read directly, never through a user). */
async function stored(name: string): Promise<{ size: string | null } | null> {
  const rows = await sql<{ size: string | null }>(
    `select metadata->>'size' size from storage.objects where bucket_id = 'voice' and name = $1`,
    [name],
  );
  return rows[0] ?? null;
}

/** Download and a signed URL as `who`: both must agree. Returns the bytes or null when denied. */
async function fetchAs(who: Who | 'anon', name: string): Promise<Buffer | null> {
  const client = who === 'anon' ? anon : db(who);
  const dl = await client.storage.from('voice').download(name);
  const signed = await client.storage.from('voice').createSignedUrl(name, 60);
  if (dl.error || !dl.data) {
    expect(signed.error, `signed URL must be refused too (${name})`).toBeTruthy();
    expect(signed.data?.signedUrl ?? null).toBeNull();
    return null;
  }
  expect(signed.error, 'download worked, signed URL must too').toBeNull();
  const viaUrl = await fetch(signed.data!.signedUrl);
  expect(viaUrl.status).toBe(200);
  const a = Buffer.from(await dl.data.arrayBuffer());
  expect(Buffer.from(await viaUrl.arrayBuffer()).equals(a)).toBe(true);
  return a;
}

const entitle = async (who: Who, active = true) =>
  ok(
    await admin
      .from('entitlements')
      .upsert({ user_id: uid(who), is_active: active, expires_at: null }),
    'entitle',
  );
const dropEntitlements = async (...who: Who[]) =>
  ok(await admin.from('entitlements').delete().in('user_id', who.map(uid)), 'drop entitlements');

/** Upload slots of a couple (the daily cap counts them), cleared between blocks. */
const clearSlots = (couple: string) => sql(`delete from private.voice_uploads where couple_id = $1`, [couple]);

const voiceAnswer = (who: Who, cq: string, voice_path: string, voice_duration_ms = 5_000) =>
  db(who)
    .from('answers')
    .upsert(
      { couple_question_id: cq, user_id: uid(who), kind: 'voice', body: null, voice_path, voice_duration_ms },
      { onConflict: 'couple_question_id,user_id' },
    )
    .select('id');
const textAnswer = (who: Who, cq: string, body = 'FIXTURE-CONTRACT-VOICE-TEXT') =>
  db(who)
    .from('answers')
    .upsert(
      { couple_question_id: cq, user_id: uid(who), kind: 'text', body, voice_path: null, voice_duration_ms: null },
      { onConflict: 'couple_question_id,user_id' },
    )
    .select('id');
const voiceMessage = (who: Who, cq: string, voice_path: string, voice_duration_ms = 5_000, client_id = randomUUID()) =>
  db(who)
    .from('thread_messages')
    .insert({ client_id, couple_question_id: cq, user_id: uid(who), kind: 'voice', body: null, voice_path, voice_duration_ms })
    .select('id');

/** The VOICE_TOO_LONG details for answers / messages (JSON string). */
function expectTooLong(res: { error: { message: string; code: string; details: string } | null }, kind: 'answer' | 'message') {
  expectCode(res as never, 'VOICE_TOO_LONG');
  expect(JSON.parse(res.error!.details)).toEqual(
    kind === 'answer' ? { max_ms: 90000, max_bytes: 409600 } : { max_ms: 60000, max_bytes: 307200 },
  );
}

/**
 * A fresh couple question (pack row, inserted as admin) for a couple: one per test, no reveal state.
 * Skips every question the couple already has (the daily row other code assigned, earlier tests'
 * rows) and, if a row still races in (23505 couple_questions_once_per_couple), tries the next one.
 */
const usedQuestions = new Set<string>();
async function freshCq(couple: string): Promise<string> {
  const qs = must(
    await admin.from('questions').select('id').eq('active', true).order('id').limit(1000),
    'questions',
  );
  const taken = new Set(
    must(await admin.from('couple_questions').select('question_id').eq('couple_id', couple), 'couple rows').map(
      (r) => r.question_id,
    ),
  );
  for (const q of qs) {
    if (usedQuestions.has(q.id) || taken.has(q.id)) continue;
    usedQuestions.add(q.id);
    const res = await admin
      .from('couple_questions')
      .insert({ couple_id: couple, question_id: q.id, source: 'pack' })
      .select('id')
      .single();
    if (res.error?.code === '23505') continue;
    return must(res, 'fresh cq').id;
  }
  throw new Error('fresh cq: no question left for this couple');
}

const temps: string[] = [];
const authOpts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
/** A throwaway account signed in through a real email OTP (as global-setup does for personas). */
async function tempUser(name: string): Promise<Temp> {
  const email = `fixture-voice-${randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name } });
  if (created.error) throw new Error(`createUser: ${created.error.message}`);
  const id = created.data.user.id;
  temps.push(id);
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const otp = link.data.properties?.email_otp;
  if (link.error || !otp) throw new Error(`OTP: ${link.error?.message ?? 'no email_otp'}`);
  const signIn = createClient<Database>(stack.url, stack.anonKey, authOpts);
  const { data, error } = await signIn.auth.verifyOtp({ email, token: otp, type: 'email' });
  if (error || !data.session) throw new Error(`sign in: ${error?.message ?? 'no session'}`);
  const token = data.session.access_token;
  const client = createClient<Database>(stack.url, stack.anonKey, {
    ...authOpts,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { id, db: client, token };
}

/** The temp user invites, `joiner` (a persona with no couple) opens the link: paired at once. */
async function pairWithTemp(t: Temp, joiner: PersonaName): Promise<string> {
  must(await t.db.rpc('create_couple', { p_stage: 'dating' }), 'temp create_couple');
  const inv = must(await t.db.rpc('create_invite'), 'temp create_invite');
  if (!inv.code || !inv.token) throw new Error(`create_invite: ${JSON.stringify(inv)}`);
  const id = must(await as(joiner).rpc('accept_invite', { p_code: inv.code, p_token: inv.token }), 'accept');
  if (typeof id !== 'string') throw new Error(`accept_invite: ${JSON.stringify(id)}`);
  return id;
}

const INTERNAL_SECRET = 'FIXTURE-internal-function-secret';
/** Runs the real Edge Function handler once under Deno (qa/functions/voice_functions.ts). */
function runFunction(
  which: 'delete-account' | 'voice-cleanup',
  bearer: string = which === 'voice-cleanup' ? INTERNAL_SECRET : '',
): { status: number; body: unknown } {
  const out = execFileSync(
    process.env.DENO ?? 'deno',
    [
      'run',
      '--allow-net',
      '--allow-env',
      '--allow-read',
      '--config',
      'supabase/functions/deno.json',
      'qa/functions/voice_functions.ts',
      which,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: stack.url,
        SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
        INTERNAL_FUNCTION_SECRET: INTERNAL_SECRET,
        VOICE_BEARER: bearer,
      },
      timeout: 120_000,
    },
  );
  const line = out.trim().split('\n').reverse().find((l) => l.startsWith('{"status"'));
  if (!line) throw new Error(`no result from ${which}: ${out}`);
  return JSON.parse(line);
}

// ───────────────────────────── world ─────────────────────────────

let couple: string; // maya + sam, Premium through Sam
let other: string; // eve + finn, Premium through Eve
let free: string; // lea + noor, free
let daily: string; // maya/sam daily question (the reveal rule case)

beforeAll(async () => {
  await ensureContent();
  await resetWorld();
  couple = await pair('maya', 'sam');
  other = await pair('eve', 'finn', 'link');
  free = await pair('lea', 'noor', 'link');
  await entitle('sam');
  await entitle('eve');
  daily = must(await as('maya').rpc('get_daily_question'), 'daily').id;
}, 120_000);

afterAll(async () => {
  for (const id of [...temps]) await admin.auth.admin.deleteUser(id);
  // Remove every voice object (the sweep only lists unreferenced ones once their rows are gone).
  await resetWorld();
  const left = await sql<{ name: string }>(`select name from storage.objects where bucket_id = 'voice'`);
  for (let i = 0; i < left.length; i += 100) {
    await admin.storage.from('voice').remove(left.slice(i, i + 100).map((r) => r.name));
  }
});

// ───────────────────────────── start_voice_upload ─────────────────────────────

describe('start_voice_upload issues the upload name (BE-43)', () => {
  it('a Premium couple member gets {couple_id}/{uid}/{uuid}.{ext} for each allowed extension; m4a by default', async () => {
    for (const ext of ['m4a', 'aac', 'ogg', 'opus']) {
      const name = await slot('maya', ext);
      const m = name.match(NAME_RE);
      expect(m, name).not.toBeNull();
      expect([m![1], m![2], m![3]]).toEqual([couple, ID.maya, ext]);
    }
    const byDefault = must(await slotRes('sam', null), 'default ext') as string;
    expect(byDefault).toMatch(new RegExp(`^${couple}/${ID.sam}/.+\\.m4a$`));
    expect(await slot('maya')).not.toBe(await slot('maya')); // one slot per take
  });

  it('another extension is INVALID_VOICE', async () => {
    for (const ext of ['mp3', 'wav', 'M4A', '', '../x', 'm4a/../../x']) {
      expectCode(await slotRes('maya', ext), 'INVALID_VOICE');
    }
  });

  it('a free couple gets PREMIUM_REQUIRED, an unpaired user NOT_PAIRED, anon has no grant', async () => {
    expectCode(await slotRes('lea'), 'PREMIUM_REQUIRED');
    expectCode(await slotRes('noor'), 'PREMIUM_REQUIRED');
    const loner = await tempUser('FIXTURE Loner');
    expectCode(await slotRes(loner), 'NOT_PAIRED');
    expectPermissionDenied(await slotRes('anon'));
  });

  it('an inactive entitlement is not Premium (PREMIUM_REQUIRED); either member\'s entitlement counts', async () => {
    await entitle('sam', false);
    expectCode(await slotRes('maya'), 'PREMIUM_REQUIRED');
    await entitle('maya');
    await slot('sam');
    await dropEntitlements('maya');
    await entitle('sam');
  });
});

// ───────────────────────────── upload policy ─────────────────────────────

describe('voice upload: issued name, own folder, Premium couple, bucket limits (BE-42/43, SEC-09)', () => {
  beforeAll(() => clearSlots(couple));

  it('the issued name uploads (audio/mp4); Storage records the size', async () => {
    const name = await slot('maya');
    ok((await upload('maya', name, recording(12_345))) as never, 'upload');
    expect(await stored(name)).toEqual({ size: '12345' });
  });

  it('a self-made name, even in the own folder, is AccessDenied', async () => {
    const name = `${couple}/${ID.maya}/${randomUUID()}.m4a`;
    expectStorage(await upload('maya', name), '403', 'AccessDenied', 'self-made');
    expect(await stored(name)).toBeNull();
  });

  it("the partner's or the other couple's issued name is AccessDenied; anon cannot upload", async () => {
    const mayas = await slot('maya');
    expectStorage(await upload('sam', mayas), '403', 'AccessDenied', 'partner uses maya slot');
    const eves = await slot('eve');
    expectStorage(await upload('maya', eves), '403', 'AccessDenied', 'maya uses eve slot');
    const res = await upload('anon', mayas);
    expect(res.error, 'anon upload').toBeTruthy();
    expect(await stored(mayas)).toBeNull();
    expect(await stored(eves)).toBeNull();
    // The slots still work for their owners (a refused upload does not burn them).
    ok((await upload('maya', mayas)) as never, 'maya own slot');
    ok((await upload('eve', eves)) as never, 'eve own slot');
  });

  it('a slot older than 1 hour is AccessDenied', async () => {
    const name = await slot('maya');
    await sql(`update private.voice_uploads set created_at = now() - interval '61 minutes' where name = $1`, [name]);
    expectStorage(await upload('maya', name), '403', 'AccessDenied', 'expired slot');
    const fresh = await slot('maya');
    await sql(`update private.voice_uploads set created_at = now() - interval '59 minutes' where name = $1`, [fresh]);
    ok((await upload('maya', fresh)) as never, '59 min old slot');
  });

  it('free couple: upload denied (slot taken while Premium, then the couple lapses)', async () => {
    const name = await slot('maya');
    await dropEntitlements('sam');
    try {
      expectStorage(await upload('maya', name), '403', 'AccessDenied', 'lapsed');
      expect(await stored(name)).toBeNull();
    } finally {
      await entitle('sam');
    }
  });

  it('contentType must be an allowed audio type (415 InvalidMimeType), every allowed one passes', async () => {
    const missing = await slot('maya');
    expectStorage(await upload('maya', missing, recording(KB), {}), '415', 'InvalidMimeType', 'default type');
    for (const t of ['audio/mpeg', 'text/plain', 'application/octet-stream', 'video/mp4']) {
      expectStorage(await upload('maya', missing, recording(KB), { contentType: t }), '415', 'InvalidMimeType', t);
    }
    expect(await stored(missing)).toBeNull();
    await clearSlots(couple);
    for (const t of ALLOWED_TYPES) {
      const name = await slot('maya');
      ok((await upload('maya', name, recording(KB), { contentType: t })) as never, t);
    }
  });

  it('at most 400 KB per object (413 EntityTooLarge)', async () => {
    await clearSlots(couple);
    const big = await slot('maya');
    expectStorage(await upload('maya', big, recording(409_601)), '413', 'EntityTooLarge', '400 KB + 1');
    expect(await stored(big)).toBeNull();
    ok((await upload('maya', big, recording(409_600))) as never, 'exactly 400 KB');
    expect(await stored(big)).toEqual({ size: '409600' });
  });
});

// ───────────────────────────── write-once (BE-43b) ─────────────────────────────

describe('voice objects are write-once (BE-43b, SEC-09b)', () => {
  let name: string;
  let cq: string;
  beforeAll(async () => {
    await clearSlots(couple);
    cq = await freshCq(couple);
    name = await take('maya', 10 * KB, 'ORIGINAL');
    must(await voiceAnswer('maya', cq, name), 'attach');
  });
  const unchanged = async () => {
    expect(await stored(name)).toEqual({ size: String(10 * KB) });
    const bytes = await fetchAs('maya', name);
    expect(bytes?.subarray(0, 16).toString()).toBe('FIXTURE-VOICE-OR');
  };

  it('upload again (upsert false or true), update and move are refused; the recording is unchanged', async () => {
    expect((await upload('maya', name, recording(20 * KB, 'SWAP'))).error, 'upsert false').toBeTruthy();
    expectStorage(
      await upload('maya', name, recording(20 * KB, 'SWAP'), { contentType: AUDIO, upsert: true }),
      '403',
      'AccessDenied',
      'upsert true',
    );
    const upd = await as('maya').storage.from('voice').update(name, recording(20 * KB, 'SWAP'), { contentType: AUDIO });
    expect(upd.error, 'update').toBeTruthy();
    const target = await slot('maya');
    const mv = await as('maya').storage.from('voice').move(name, target);
    expect(mv.error, 'move').toBeTruthy();
    expect(await stored(target)).toBeNull();
    await unchanged();
  });


  it('a signed upload URL made with upsert:true cannot overwrite an attached recording (before or after the upload)', async () => {
    // The SEC-09b path: the URL is made while the slot is fresh and the object does not exist yet.
    const victim = await slot('maya');
    const made = await as('maya').storage.from('voice').createSignedUploadUrl(victim, { upsert: true });
    expect(made.error, 'signed upload URL before the upload').toBeNull();
    const early = made.data!;
    ok((await upload('maya', victim, recording(10 * KB, 'FIRSTTAKE'))) as never, 'normal upload');
    must(await voiceAnswer('maya', await freshCq(couple), victim), 'attach');
    const swap = await as('maya')
      .storage.from('voice')
      .uploadToSignedUrl(victim, early.token, recording(350 * KB, 'SWAP'), { contentType: AUDIO, upsert: true });
    expect(swap.error, 'overwrite through the early signed URL').toBeTruthy();
    // CONTRACTS §2: Storage answers HTTP 500 DatabaseError (the trigger's P0001).
    expect(swap.error).toMatchObject({ status: 500, code: 'DatabaseError' });
    expect((swap.error as Error).message).toMatch(/P0001/);
    expect(await stored(victim)).toEqual({ size: String(10 * KB) });
    expect((await fetchAs('maya', victim))?.subarray(0, 16).toString()).toBe('FIXTURE-VOICE-FI');

    // A URL made after the object exists: either refused when made or when used.
    const late = await as('maya').storage.from('voice').createSignedUploadUrl(name, { upsert: true });
    if (!late.error) {
      const res = await as('maya')
        .storage.from('voice')
        .uploadToSignedUrl(name, late.data!.token, recording(20 * KB, 'SWAP'), { contentType: AUDIO, upsert: true });
      expect(res.error, 'overwrite through a late signed URL').toBeTruthy();
    }
    await unchanged();
  });
});

// ───────────────────────────── answers: text XOR voice ─────────────────────────────

describe('voice answers: text XOR voice, Premium, own fresh object, caps (BE-42/43)', () => {
  beforeAll(() => clearSlots(couple));

  it('kind voice with a body, without a path or duration, or text with a path are 23514', async () => {
    const cq = await freshCq(couple);
    const name = await take('maya');
    const raw = (row: Record<string, unknown>) =>
      as('maya')
        .from('answers')
        .upsert({ couple_question_id: cq, user_id: ID.maya, ...row } as never, { onConflict: 'couple_question_id,user_id' });
    const bad: Record<string, unknown>[] = [
      { kind: 'voice', body: 'FIXTURE-CONTRACT-BOTH', voice_path: name, voice_duration_ms: 5000 },
      { kind: 'voice', body: null, voice_path: name, voice_duration_ms: null },
      { kind: 'voice', body: null, voice_path: null, voice_duration_ms: 5000 },
      { kind: 'text', body: 'FIXTURE-CONTRACT-TEXT', voice_path: name, voice_duration_ms: 5000 },
      { kind: 'text', body: null, voice_path: null, voice_duration_ms: null },
      { kind: 'voice', body: null, voice_path: name, voice_duration_ms: 0 },
    ];
    for (const row of bad) expect((await raw(row)).error?.code, JSON.stringify(row)).toBe('23514');
    // Nothing was stored; the object is still free to attach.
    must(await voiceAnswer('maya', cq, name), 'valid voice answer');
    const row = must(
      await as('maya').from('answers').select('kind, body, voice_path, voice_duration_ms').eq('couple_question_id', cq).eq('user_id', ID.maya).single(),
      'read own',
    );
    expect(row).toEqual({ kind: 'voice', body: null, voice_path: name, voice_duration_ms: 5000 });
    // A text-only upsert on a voice row fails the CHECK; switching sends the voice fields as null.
    const textOnly = await as('maya')
      .from('answers')
      .upsert({ couple_question_id: cq, user_id: ID.maya, body: 'FIXTURE-CONTRACT-TEXT' }, { onConflict: 'couple_question_id,user_id' });
    expect(textOnly.error?.code).toBe('23514');
    must(await textAnswer('maya', cq), 'switch to text');
    // The released object is no longer referenced: the owner may delete it.
  });

  it('INVALID_VOICE: the partner\'s object, a missing object, an object already used, the other couple\'s name', async () => {
    const cq = await freshCq(couple);
    const samTake = await take('sam');
    expectCode(await voiceAnswer('maya', cq, samTake), 'INVALID_VOICE');
    expectCode(await voiceAnswer('maya', cq, `${couple}/${ID.maya}/${randomUUID()}.m4a`), 'INVALID_VOICE');
    const pending = await slot('maya'); // issued but never uploaded
    expectCode(await voiceAnswer('maya', cq, pending), 'INVALID_VOICE');
    expectCode(await voiceAnswer('maya', cq, `${couple}/${ID.maya}/../${ID.sam}/x.m4a`), 'INVALID_VOICE');
    const used = await take('maya');
    must(await voiceAnswer('maya', await freshCq(couple), used), 'first use');
    expectCode(await voiceAnswer('maya', cq, used), 'INVALID_VOICE');
    const eveTake = await take('eve');
    expectCode(await voiceAnswer('maya', cq, eveTake), 'INVALID_VOICE');
  });

  it('an object uploaded more than 23 hours ago is INVALID_VOICE; 22 hours is fine', async () => {
    const cq = await freshCq(couple);
    const old = await take('maya');
    await sql(`update storage.objects set created_at = now() - interval '23 hours 1 minute' where bucket_id = 'voice' and name = $1`, [old]);
    expectCode(await voiceAnswer('maya', cq, old), 'INVALID_VOICE');
    const ok22 = await take('maya');
    await sql(`update storage.objects set created_at = now() - interval '22 hours' where bucket_id = 'voice' and name = $1`, [ok22]);
    must(await voiceAnswer('maya', cq, ok22), '22 h old take');
  });

  it('duration: 90 000 ms passes, 90 001 is VOICE_TOO_LONG {max_ms:90000,max_bytes:409600}; 400 KB passes', async () => {
    const cq = await freshCq(couple);
    const name = await take('maya', 409_600);
    expectTooLong((await voiceAnswer('maya', cq, name, 90_001)) as never, 'answer');
    must(await voiceAnswer('maya', cq, name, 90_000), '90 s, 400 KB');
  });

  it('a free couple cannot attach a new recording (PREMIUM_REQUIRED); after a lapse the unchanged re-send and switching to text pass', async () => {
    const cq = await freshCq(couple);
    const kept = await take('maya');
    must(await voiceAnswer('maya', cq, kept), 'while Premium');
    const fresh = await take('maya'); // uploaded while Premium, attached after the lapse
    await dropEntitlements('sam');
    try {
      expectCode(await voiceAnswer('maya', await freshCq(couple), fresh), 'PREMIUM_REQUIRED');
      expectCode(await voiceAnswer('maya', cq, fresh), 'PREMIUM_REQUIRED');
      must(await voiceAnswer('maya', cq, kept), 'unchanged re-send after the lapse');
      ok(
        await as('maya').from('answers').update({ client_written_at: new Date().toISOString() }).eq('couple_question_id', cq).eq('user_id', ID.maya),
        'update not touching the voice',
      );
      expect(await fetchAs('maya', kept)).not.toBeNull(); // lapsed couples keep reading
      must(await textAnswer('maya', cq), 'switch to text after the lapse');
      expectCode(await voiceAnswer('maya', cq, kept), 'PREMIUM_REQUIRED'); // back to voice is new again
    } finally {
      await entitle('sam');
    }
  });

  it('the outsider gets RLS 42501, never PREMIUM_REQUIRED or INVALID_VOICE', async () => {
    const cq = await freshCq(couple);
    const eveTake = await take('eve');
    const res = await voiceAnswer('eve', cq, eveTake);
    expect(res.error?.code).toBe('42501');
    const mayaTake = await take('maya');
    expect((await voiceAnswer('eve', cq, mayaTake)).error?.code).toBe('42501');
  });
});

// ───────────────────────────── reveal rule on objects (release blocker) ─────────────────────────────

describe('storage reveal rule: a voice answer object follows the answers RLS (D13, BE-42)', () => {
  let name: string;
  let unattached: string;
  beforeAll(async () => {
    await clearSlots(couple);
    name = await take('maya', 8 * KB, 'MAYADAILY');
    unattached = await take('maya', 4 * KB, 'SPARE');
    must(await voiceAnswer('maya', daily, name, 12_000), 'maya answers by voice');
  });

  it('before the partner answered: the partner can neither download nor sign a URL, nor read the row', async () => {
    expect(await fetchAs('sam', name)).toBeNull();
    const rows = must(await as('sam').from('answers').select('id').eq('couple_question_id', daily).eq('user_id', ID.maya), 'rows');
    expect(rows).toEqual([]);
    // Listing the folder shows nothing of Maya's either.
    const list = await as('sam').storage.from('voice').list(`${couple}/${ID.maya}`);
    expect((list.data ?? []).map((o) => o.name)).toEqual([]);
  });

  it('the owner always reads; the other couple and anon never', async () => {
    expect((await fetchAs('maya', name))?.length).toBe(8 * KB);
    expect(await fetchAs('eve', name)).toBeNull();
    expect(await fetchAs('finn', name)).toBeNull();
    expect(await fetchAs('anon', name)).toBeNull();
  });

  it('after the partner answers: the partner downloads the same bytes; the other couple and anon still not', async () => {
    must(await textAnswer('sam', daily, 'FIXTURE-CONTRACT-SAM-DAILY'), 'sam answers');
    const bytes = await fetchAs('sam', name);
    expect(bytes?.length).toBe(8 * KB);
    expect(bytes?.subarray(0, 16).toString()).toBe('FIXTURE-VOICE-MA');
    expect(await fetchAs('eve', name)).toBeNull();
    expect(await fetchAs('anon', name)).toBeNull();
  });

  it('an object not attached to any row stays the owner\'s only, even after the reveal', async () => {
    expect(await fetchAs('sam', unattached)).toBeNull();
    expect((await fetchAs('maya', unattached))?.length).toBe(4 * KB);
  });

  it('a lapsed couple keeps read access', async () => {
    await dropEntitlements('sam');
    try {
      expect((await fetchAs('sam', name))?.length).toBe(8 * KB);
    } finally {
      await entitle('sam');
    }
  });

  it('the same holds for a pack question; and a voice answer of the partner is hidden from me until I answer', async () => {
    const cq = await freshCq(couple);
    const samTake = await take('sam', 6 * KB, 'SAMPACK');
    must(await voiceAnswer('sam', cq, samTake), 'sam voice');
    expect(await fetchAs('maya', samTake)).toBeNull();
    const mayaTake = await take('maya', 6 * KB, 'MAYAPACK');
    must(await voiceAnswer('maya', cq, mayaTake), 'maya voice');
    expect((await fetchAs('maya', samTake))?.length).toBe(6 * KB);
    expect((await fetchAs('sam', mayaTake))?.length).toBe(6 * KB);
    expect(await fetchAs('eve', samTake)).toBeNull();
  });
});

// ───────────────────────────── thread voice ─────────────────────────────

describe('voice thread messages: caps, Premium, fixed after sending, readable by the couple (BE-42/43)', () => {
  beforeAll(() => clearSlots(couple));

  it('60 000 ms and 300 KB pass; 60 001 ms or 300 KB + 1 is VOICE_TOO_LONG {max_ms:60000,max_bytes:307200}', async () => {
    const name = await take('sam', 307_200, 'SAMMSG');
    expectTooLong((await voiceMessage('sam', daily, name, 60_001)) as never, 'message');
    const big = await take('sam', 307_201);
    expectTooLong((await voiceMessage('sam', daily, big, 1_000)) as never, 'message');
    must(await voiceMessage('sam', daily, name, 60_000), '60 s, 300 KB');
  });

  it('text XOR voice per message (23514); text and voice mix in one thread', async () => {
    const name = await take('maya');
    const raw = (row: Record<string, unknown>) =>
      as('maya').from('thread_messages').insert({ client_id: randomUUID(), couple_question_id: daily, user_id: ID.maya, ...row } as never);
    for (const row of [
      { kind: 'voice', body: 'FIXTURE-CONTRACT-BOTH', voice_path: name, voice_duration_ms: 1000 },
      { kind: 'voice', body: null, voice_path: name, voice_duration_ms: null },
      { kind: 'text', body: 'FIXTURE-CONTRACT-MSG', voice_path: name, voice_duration_ms: 1000 },
    ]) {
      expect((await raw(row)).error?.code, JSON.stringify(row)).toBe('23514');
    }
    ok(await raw({ body: 'FIXTURE-CONTRACT-MSG-TEXT' }), 'text message');
    must(await voiceMessage('maya', daily, name), 'voice message');
  });

  it('the partner reads a thread voice message; the other couple and anon do not; a resend with the same client_id is not new', async () => {
    const clientId = randomUUID();
    const name = await take('maya', 5 * KB, 'MAYAMSG');
    must(await voiceMessage('maya', daily, name, 3_000, clientId), 'send');
    const resend = await as('maya')
      .from('thread_messages')
      .upsert(
        { client_id: clientId, couple_question_id: daily, user_id: ID.maya, kind: 'voice', body: null, voice_path: name, voice_duration_ms: 3_000 },
        { onConflict: 'client_id', ignoreDuplicates: true },
      );
    expect(resend.error).toBeNull();
    // The app's plain insert retry: the duplicate (23505) says "already sent", not INVALID_VOICE.
    expect((await voiceMessage('maya', daily, name, 3_000, clientId)).error?.code).toBe('23505');
    const sent = must(await admin.from('thread_messages').select('id').eq('client_id', clientId), 'sent');
    expect(sent).toHaveLength(1);
    expect((await fetchAs('sam', name))?.length).toBe(5 * KB);
    expect(await fetchAs('eve', name)).toBeNull();
    expect(await fetchAs('anon', name)).toBeNull();
    // Reusing the message's object for an answer or another message is INVALID_VOICE.
    expectCode(await voiceMessage('maya', daily, name), 'INVALID_VOICE');
    expectCode(await voiceAnswer('maya', await freshCq(couple), name), 'INVALID_VOICE');
  });

  it('an edit cannot change kind, voice_path or duration of a sent message', async () => {
    const name = await take('sam', 2 * KB);
    const id = must(await voiceMessage('sam', daily, name, 2_000), 'send')[0].id;
    const other = await take('sam');
    await as('sam').from('thread_messages').update({ voice_path: other, voice_duration_ms: 9_000 }).eq('id', id);
    const row = must(await admin.from('thread_messages').select('kind, voice_path, voice_duration_ms').eq('id', id).single(), 'row');
    expect(row).toEqual({ kind: 'voice', voice_path: name, voice_duration_ms: 2_000 });
  });

  it('a free couple cannot send a new voice message (PREMIUM_REQUIRED); text still works', async () => {
    const name = await take('maya');
    await dropEntitlements('sam');
    try {
      expectCode(await voiceMessage('maya', daily, name), 'PREMIUM_REQUIRED');
      ok(
        await as('maya').from('thread_messages').insert({ client_id: randomUUID(), couple_question_id: daily, user_id: ID.maya, body: 'FIXTURE-CONTRACT-FREE-MSG' }),
        'text message while free',
      );
    } finally {
      await entitle('sam');
    }
  });
});

// ───────────────────────────── voice message push (BE-52 copy) ─────────────────────────────

/** The real notify handler once with a thread event (qa/functions/notify_little_things.ts, Expo recorded). */
function notifyThread(event: Record<string, string>): { status: number; body: unknown; messages: Record<string, unknown>[] } {
  const out = execFileSync(
    process.env.DENO ?? 'deno',
    ['run', '--allow-net', '--allow-env', '--allow-read', '--config', 'supabase/functions/deno.json', 'qa/functions/notify_little_things.ts'],
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
      },
      timeout: 120_000,
    },
  );
  const line = out.trim().split('\n').reverse().find((l) => l.startsWith('{"status"'));
  if (!line) throw new Error(`no result from notify: ${out}`);
  return JSON.parse(line);
}

describe('notify: a voice thread message push uses the approved copy, no content (BE-52, BE-43)', () => {
  it('"<first name> sent a voice message" / "Tap to listen.": real kind and name lookup, no path, duration, surname or price', async () => {
    const samToken = `ExponentPushToken[FIXTURE-qa36-sam-${randomUUID()}]`;
    const users = [ID.maya, ID.sam];
    await sql('delete from public.push_log where user_id = any($1::uuid[])', [users]);
    // Sam: UTC, a quiet window that does not cover now, replies on; Maya's name has a surname.
    const [{ s: qs, e: qe }] = await sql<{ s: string; e: string }>(
      `select to_char((now() at time zone 'UTC') + interval '2 hours', 'HH24:MI') s,
              to_char((now() at time zone 'UTC') + interval '3 hours', 'HH24:MI') e`,
    );
    ok(await admin.from('profiles').update({ timezone: 'UTC' }).eq('id', ID.sam), 'sam tz');
    ok(await admin.from('profiles').update({ display_name: 'Maya FIXTURE-Surname' }).eq('id', ID.maya), 'maya name');
    ok(await admin.from('notification_prefs').update({ replies: true, quiet_start: qs, quiet_end: qe }).eq('user_id', ID.sam), 'sam prefs');
    ok(await admin.from('push_tokens').insert({ user_id: ID.sam, token: samToken, platform: 'ios' }), 'sam token');
    try {
      const name = await take('maya', 4 * KB, 'PUSHMSG');
      const id = must(await voiceMessage('maya', daily, name, 7_345), 'voice message')[0].id;
      const res = notifyThread({ type: 'thread_activity', record_id: id, couple_id: couple, couple_question_id: daily, actor_user_id: ID.maya });
      expect(res.status).toBe(200);
      const mine = res.messages.filter((m) => m.to === samToken);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        title: 'Maya sent a voice message',
        body: 'Tap to listen.',
        channelId: 'thread_activity',
        data: { type: 'thread_activity', url: `bonded://question/${daily}/thread` },
      });
      const raw = JSON.stringify(mine[0]);
      for (const leak of [name, name.split('/').pop()!, '7345', '7.3', 'FIXTURE-Surname', 'm4a']) expect(raw, leak).not.toContain(leak);
      expect(`${mine[0].title} ${mine[0].body}`).not.toMatch(PRICE);
      // Maya (the sender) gets nothing.
      expect(res.messages.filter((m) => m.to !== samToken)).toEqual([]);
    } finally {
      await admin.from('push_tokens').delete().eq('token', samToken);
      await sql('delete from public.push_log where user_id = any($1::uuid[])', [users]);
      ok(await admin.from('profiles').update({ display_name: PERSONAS.maya.display_name }).eq('id', ID.maya), 'maya name back');
      ok(await admin.from('profiles').update({ timezone: PERSONAS.sam.timezone }).eq('id', ID.sam), 'sam tz back');
      ok(await admin.from('notification_prefs').update({ quiet_start: '23:00', quiet_end: '07:00' }).eq('user_id', ID.sam), 'sam prefs back');
    }
  });
});

// ───────────────────────────── delete by the owner ─────────────────────────────

describe('delete: the owner removes only unreferenced takes (BE-42/43)', () => {
  beforeAll(() => clearSlots(couple));

  it('own unreferenced take: removed; attached one: kept; the partner\'s take: kept', async () => {
    const spare = await take('maya');
    const attached = await take('maya');
    must(await voiceAnswer('maya', await freshCq(couple), attached), 'attach');
    const samSpare = await take('sam');
    await as('maya').storage.from('voice').remove([spare, attached, samSpare]);
    expect(await stored(spare)).toBeNull();
    expect(await stored(attached)).not.toBeNull();
    expect(await stored(samSpare)).not.toBeNull();
    await as('eve').storage.from('voice').remove([samSpare]);
    await anon.storage.from('voice').remove([samSpare]);
    expect(await stored(samSpare)).not.toBeNull();
  });
});

// ───────────────────────────── daily cap ─────────────────────────────

describe('VOICE_LIMIT: 20 slots per couple per local day, both partners together (BE-43)', () => {
  beforeAll(async () => {
    await clearSlots(couple);
    await clearSlots(other);
  });

  it('the 21st slot of the day is VOICE_LIMIT {max:20}; a refused call takes no slot; the other couple is not affected', async () => {
    for (let i = 0; i < 10; i++) {
      await slot('maya');
      await slot('sam');
    }
    for (const who of ['maya', 'sam'] as const) {
      const res = await slotRes(who);
      expectCode(res, 'VOICE_LIMIT');
      expect(JSON.parse(res.error!.details)).toEqual({ max: 20 });
    }
    const [{ n }] = await sql<{ n: number }>(`select count(*)::int n from private.voice_uploads where couple_id = $1`, [couple]);
    expect(n).toBe(20);
    await slot('eve');
    await slot('finn');
  });

  it('slots from the previous local day do not count', async () => {
    await sql(`update private.voice_uploads set local_date = local_date - 1 where couple_id = $1`, [couple]);
    await slot('maya');
    await sql(`update private.voice_uploads set local_date = local_date - 1 where couple_id = $1`, [couple]);
  });

  it('a retry of a failed upload uses the same name inside the hour (no new slot)', async () => {
    await clearSlots(couple);
    for (let i = 0; i < 19; i++) await slot('sam');
    const last = await slot('maya');
    expectStorage(await upload('maya', last, recording(KB), {}), '415', 'InvalidMimeType', 'failed upload');
    ok((await upload('maya', last)) as never, 'retry with the same name');
    expectCode(await slotRes('maya'), 'VOICE_LIMIT');
    await clearSlots(couple);
  });
});

// ───────────────────────────── lifecycle ─────────────────────────────

describe('lifecycle: orphan cleanup, D08 purge and delete-account remove the objects (BE-43)', () => {
  it('voice_sweep and voice_objects_of_user are service-only', async () => {
    expectPermissionDenied(await as('maya').rpc('voice_sweep', {}));
    expectPermissionDenied(await anon.rpc('voice_sweep', {}));
    expectPermissionDenied(await as('maya').rpc('voice_objects_of_user', { p_user: ID.maya }));
    expectPermissionDenied(await anon.rpc('voice_objects_of_user', { p_user: ID.maya }));
  });

  it('voice-cleanup refuses a wrong or missing secret, delete-account a missing or bad token (401)', async () => {
    const spare = await take('maya');
    await sql(`update storage.objects set created_at = now() - interval '25 hours' where bucket_id = 'voice' and name = $1`, [spare]);
    for (const bearer of ['FIXTURE-wrong-secret', '']) {
      expect(runFunction('voice-cleanup', bearer)).toEqual({ status: 401, body: expect.objectContaining({ error: 'UNAUTHORIZED' }) });
    }
    expect(await stored(spare)).not.toBeNull();
    for (const bearer of ['', 'FIXTURE-not-a-jwt']) {
      expect(runFunction('delete-account', bearer)).toEqual({ status: 401, body: expect.objectContaining({ error: 'UNAUTHORIZED' }) });
    }
  });

  it('orphans older than 24 h are removed, younger ones and attached ones kept; a second run removes nothing', async () => {
    await clearSlots(couple);
    const oldOrphan = await take('maya');
    const youngOrphan = await take('maya');
    const oldAttached = await take('maya');
    must(await voiceAnswer('maya', await freshCq(couple), oldAttached), 'attach');
    await sql(
      `update storage.objects set created_at = now() - interval '25 hours' where bucket_id = 'voice' and name = any($1)`,
      [[oldOrphan, oldAttached]],
    );
    const first = runFunction('voice-cleanup');
    expect(first.status).toBe(200);
    expect((first.body as { removed: number }).removed).toBeGreaterThanOrEqual(1);
    expect(await stored(oldOrphan)).toBeNull();
    expect(await stored(youngOrphan)).not.toBeNull();
    expect(await stored(oldAttached)).not.toBeNull();
    expect(runFunction('voice-cleanup')).toEqual({ status: 200, body: { removed: 0 } });
  });

  it('D08: the purge 30 days after the end removes the couple\'s recordings; other couples keep theirs', async () => {
    await entitle('lea');
    const cq = await freshCq(free);
    const leaAnswer = await take('lea', 3 * KB);
    const noorAnswer = await take('noor', 3 * KB);
    must(await voiceAnswer('lea', cq, leaAnswer), 'lea voice');
    must(await voiceAnswer('noor', cq, noorAnswer), 'noor voice');
    const noorMsg = await take('noor', 2 * KB);
    must(await voiceMessage('noor', cq, noorMsg), 'noor message');
    const leaSpare = await take('lea'); // unattached, younger than 24 h
    const keepMaya = await take('maya');
    must(await voiceAnswer('maya', await freshCq(couple), keepMaya), 'active couple keeps');

    ok(await as('lea').rpc('unpair'), 'lea unpairs');
    // Inside the 30 days: still readable by both (D08), nothing removed.
    expect((await fetchAs('noor', leaAnswer))?.length).toBe(3 * KB);
    expect(runFunction('voice-cleanup').status).toBe(200);
    for (const n of [leaAnswer, noorAnswer, noorMsg]) expect(await stored(n), n).not.toBeNull();

    await sql(
      `with c as (update couples set ended_at = now() - interval '31 days' where id = $1 returning id)
       update couple_members set left_at = now() - interval '31 days' where couple_id in (select id from c)`,
      [free],
    );
    await sql(`select private.purge_ended_couples()`);
    expect(await sql(`select id from couples where id = $1`, [free])).toHaveLength(0);
    const res = runFunction('voice-cleanup');
    expect(res.status).toBe(200);
    expect((res.body as { removed: number }).removed).toBeGreaterThanOrEqual(4);
    for (const n of [leaAnswer, noorAnswer, noorMsg, leaSpare]) expect(await stored(n), n).toBeNull();
    expect(await stored(keepMaya)).not.toBeNull();
    expect(runFunction('voice-cleanup')).toEqual({ status: 200, body: { removed: 0 } });
    await dropEntitlements('lea');
  });

  it('D09: delete-account removes every recording the user uploaded; the partner\'s stay readable to the partner', async () => {
    const t = await tempUser('FIXTURE Voice Temp');
    const tc = await pairWithTemp(t, 'noor');
    await entitle('noor');
    const cq = await freshCq(tc);
    const tAnswer = await take(t, 3 * KB);
    const tSpare = await take(t, 1 * KB);
    const noorAnswer = await take('noor', 3 * KB, 'NOORKEEP');
    must(await voiceAnswer(t, cq, tAnswer), 'temp voice');
    must(await voiceAnswer('noor', cq, noorAnswer), 'noor voice');
    const tMsg = await take(t, 2 * KB);
    must(await voiceMessage(t, cq, tMsg), 'temp message');
    const [{ n: listed }] = await sql<{ n: number }>(
      `select count(*)::int n from public.voice_objects_of_user($1)`,
      [t.id],
    );
    expect(listed).toBe(3);

    expect(runFunction('delete-account', 'FIXTURE-not-a-jwt').status).toBe(401);
    for (const n of [tAnswer, tSpare, tMsg]) expect(await stored(n), n).not.toBeNull();

    expect(runFunction('delete-account', t.token)).toEqual({ status: 200, body: { ok: true } });
    temps.splice(temps.indexOf(t.id), 1);
    for (const n of [tAnswer, tSpare, tMsg]) expect(await stored(n), n).toBeNull();
    expect(await stored(noorAnswer)).not.toBeNull();
    expect((await fetchAs('noor', noorAnswer))?.subarray(0, 16).toString()).toBe('FIXTURE-VOICE-NO');
    await dropEntitlements('noor');
  });
});
