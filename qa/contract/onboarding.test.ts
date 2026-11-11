// QA-33 part 3: onboarding answers (D38, BE-33) with questionnaire version 2 (D50, BE-48), and the
// after-sign-in finish of the D50 onboarding (CONTRACTS §2 "Finishing onboarding right after
// sign-in"): N's ritual time, the v2 answers and T1's day-1 answer, as the app sends them (MOB-61
// finish.ts). Signed-in personas through supabase-js; RLS and triggers are the real ones.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ID,
  admin,
  anon,
  as,
  createInvite,
  ensureContent,
  expectCode,
  expectPermissionDenied,
  firstDayId,
  joinByCode,
  must,
  ok,
  resetWorld,
} from './helpers';

const MAYA = ID.maya;
const SAM = ID.sam;
const T1 = 'FIXTURE-T1 Maya answers day one during onboarding';
const SAM_ANSWER = 'FIXTURE-T1 Sam answers day one after joining';

type V2 = { question_id: string; answer: unknown };
const VALID: V2[] = [
  { question_id: 'last_learned', answer: 'this_week' },
  { question_id: 'last_learned', answer: 'this_month' },
  { question_id: 'last_learned', answer: 'cant_remember' },
  { question_id: 'stage', answer: 'dating' },
  { question_id: 'stage', answer: 'living_together' },
  { question_id: 'stage', answer: 'engaged_married' },
  { question_id: 'stage', answer: 'long_distance' },
  { question_id: 'goals', answer: [] },
  { question_id: 'goals', answer: ['deep_talks'] },
  {
    question_id: 'goals',
    answer: ['deep_talks', 'laughing', 'romance', 'future', 'hard_conversations', 'learning'],
  },
];
const INVALID: (V2 & { why: string })[] = [
  { why: 'unknown question id', question_id: 'names', answer: 'Maya' },
  { why: 'T1 is not an onboarding answer', question_id: 't1', answer: 'FIXTURE-T1' },
  { why: 'ritual time is not one either', question_id: 'ritual_time', answer: '21:00' },
  { why: 'label text, not a key', question_id: 'stage', answer: 'Dating' },
  { why: 'unknown stage', question_id: 'stage', answer: 'married' },
  { why: 'stage as an array', question_id: 'stage', answer: ['dating'] },
  { why: 'last_learned as a number', question_id: 'last_learned', answer: 1 },
  { why: 'unknown last_learned', question_id: 'last_learned', answer: 'yesterday' },
  { why: 'goals as a string', question_id: 'goals', answer: 'deep_talks' },
  { why: 'duplicate goals', question_id: 'goals', answer: ['deep_talks', 'deep_talks'] },
  { why: 'unknown goal', question_id: 'goals', answer: ['deep_talks', 'travel'] },
  { why: 'goal label', question_id: 'goals', answer: ['Deep talks'] },
  { why: 'goal not a string', question_id: 'goals', answer: [1] },
  { why: 'goals as an object', question_id: 'goals', answer: { deep_talks: true } },
];

const upsertV2 = (q: V2, answeredAt = '2026-11-11T09:00:00Z') =>
  as('maya')
    .from('onboarding_answers')
    .upsert(
      { user_id: MAYA, question_id: q.question_id, questionnaire_version: 2, answer: q.answer as never, answered_at: answeredAt },
      { onConflict: 'user_id,question_id,questionnaire_version' },
    );
const mine = async (version: number) =>
  must(
    await as('maya')
      .from('onboarding_answers')
      .select('question_id, answer')
      .eq('questionnaire_version', version)
      .order('question_id'),
    'read own answers',
  );

async function clearAnswers() {
  ok(await admin.from('onboarding_answers').delete().in('user_id', [MAYA, SAM]), 'clear answers');
}

beforeAll(async () => {
  await resetWorld();
  await ensureContent();
});
afterAll(async () => {
  await clearAnswers();
  await resetWorld();
});

describe('onboarding_answers questionnaire version 2 (BE-48, CONTRACTS §2)', () => {
  beforeEach(clearAnswers);

  it('every documented key is accepted on upsert, and the last one per question is kept', async () => {
    for (const q of VALID) ok(await upsertV2(q), `${q.question_id} ${JSON.stringify(q.answer)}`);
    expect(await mine(2)).toEqual([
      { question_id: 'goals', answer: VALID.at(-1)!.answer },
      { question_id: 'last_learned', answer: 'cant_remember' },
      { question_id: 'stage', answer: 'long_distance' },
    ]);
  });

  it.each(INVALID)('INVALID_ONBOARDING_ANSWER on insert/upsert: $why', async (q) => {
    expectCode(await upsertV2(q), 'INVALID_ONBOARDING_ANSWER');
    expectCode(
      await as('maya')
        .from('onboarding_answers')
        .insert({ user_id: MAYA, question_id: q.question_id, questionnaire_version: 2, answer: q.answer as never }),
      'INVALID_ONBOARDING_ANSWER',
    );
    expect(await mine(2)).toEqual([]);
  });

  it('an update to an invalid value is refused and the stored answer stays', async () => {
    ok(await upsertV2({ question_id: 'stage', answer: 'dating' }), 'valid stage');
    expectCode(
      await as('maya')
        .from('onboarding_answers')
        .update({ answer: 'Dating' as never })
        .eq('user_id', MAYA)
        .eq('question_id', 'stage')
        .eq('questionnaire_version', 2),
      'INVALID_ONBOARDING_ANSWER',
    );
    expectCode(await upsertV2({ question_id: 'stage', answer: 'married' }), 'INVALID_ONBOARDING_ANSWER');
    expect(await mine(2)).toEqual([{ question_id: 'stage', answer: 'dating' }]);
  });

  it('version 1 keeps the format checks only: free-form rows stay writable and readable beside v2', async () => {
    ok(
      await as('maya')
        .from('onboarding_answers')
        .upsert(
          { user_id: MAYA, question_id: 'stage', questionnaire_version: 1, answer: 'Dating' as never },
          { onConflict: 'user_id,question_id,questionnaire_version' },
        ),
      'v1 label text',
    );
    ok(await upsertV2({ question_id: 'stage', answer: 'dating' }), 'v2 key');
    expect(await mine(1)).toEqual([{ question_id: 'stage', answer: 'Dating' }]);
    expect(await mine(2)).toEqual([{ question_id: 'stage', answer: 'dating' }]);
  });

  it('a retry with the same version and timestamp is idempotent', async () => {
    const q = { question_id: 'goals', answer: ['learning', 'romance'] };
    ok(await upsertV2(q, '2026-11-11T08:00:00Z'), 'first');
    ok(await upsertV2(q, '2026-11-11T08:00:00Z'), 'retry');
    const rows = must(
      await as('maya').from('onboarding_answers').select('answered_at').eq('questionnaire_version', 2),
      'rows',
    );
    expect(rows.map((r) => new Date(r.answered_at).toISOString())).toEqual(['2026-11-11T08:00:00.000Z']);
  });

  it('own rows only: the partner, an outsider and anon see and write nothing; no client delete', async () => {
    ok(await upsertV2({ question_id: 'stage', answer: 'dating' }), 'maya');
    expect(must(await as('sam').from('onboarding_answers').select('*').eq('user_id', MAYA), 'sam reads')).toEqual([]);
    expect(must(await as('eve').from('onboarding_answers').select('*').eq('user_id', MAYA), 'eve reads')).toEqual([]);
    const forged = await as('sam')
      .from('onboarding_answers')
      .insert({ user_id: MAYA, question_id: 'goals', questionnaire_version: 2, answer: [] as never });
    expect(forged.error).not.toBeNull();
    expectPermissionDenied(await anon.from('onboarding_answers').select('*'));
    const del = await as('maya').from('onboarding_answers').delete().eq('user_id', MAYA);
    expect(del.error?.code).toBe('42501');
    expect(await mine(2)).toEqual([{ question_id: 'stage', answer: 'dating' }]);
  });
});

describe('finishing D50 onboarding after sign-in: ritual time, v2 answers, T1 (CONTRACTS §2, MOB-61)', () => {
  beforeEach(async () => {
    await resetWorld();
    await clearAnswers();
    ok(await admin.from('notification_prefs').update({ ritual_time: '21:00' }).eq('user_id', MAYA), 'prefs');
  });

  it('N, 03/05/06 and T1 in the documented order: T1 counts for day 1 and stays locked for the joiner until he answers', async () => {
    // 4. Solo couple from 05/06/07.
    const coupleId = must(
      await as('maya').rpc('create_couple', { p_stage: 'dating', p_goals: ['deep_talks'], p_partner_name: 'Sam' }),
      'create_couple',
    );
    // 5. N: the ritual time, also after "Not now".
    ok(
      await as('maya').from('notification_prefs').upsert({ user_id: MAYA, ritual_time: '12:30' }, { onConflict: 'user_id' }),
      'ritual time',
    );
    // 6. The three version-2 answers.
    for (const q of [
      { question_id: 'last_learned', answer: 'this_week' },
      { question_id: 'stage', answer: 'dating' },
      { question_id: 'goals', answer: ['deep_talks'] },
    ])
      ok(await upsertV2(q), q.question_id);
    // 7. T1: today's question (day 1 = first_day, D12), then the answer without client_written_at.
    const cq = must(await as('maya').rpc('get_daily_question'), 'get_daily_question');
    expect(cq.couple_id).toBe(coupleId);
    expect(cq.question_id).toBe(await firstDayId());
    ok(
      await as('maya')
        .from('answers')
        .upsert({ couple_question_id: cq.id, user_id: MAYA, body: T1 }, { onConflict: 'couple_question_id,user_id' }),
      'T1 answer',
    );
    // A retry (the app lost the response) writes nothing new.
    ok(
      await as('maya')
        .from('answers')
        .upsert({ couple_question_id: cq.id, user_id: MAYA, body: T1 }, { onConflict: 'couple_question_id,user_id' }),
      'T1 retry',
    );

    const prefs = must(await as('maya').from('notification_prefs').select('ritual_time, daily_reminder').single(), 'prefs');
    expect(prefs.ritual_time.slice(0, 5)).toBe('12:30');
    expect(prefs.daily_reminder).toBe(true); // "Not now" leaves it as it is
    expect((await mine(2)).map((r) => r.question_id)).toEqual(['goals', 'last_learned', 'stage']);
    const t1 = must(
      await admin.from('answers').select('user_id, counts_for_streak').eq('couple_question_id', cq.id),
      'T1 row',
    );
    // Without client_written_at the server uses arrival time, so it counts for day 1.
    expect(t1).toEqual([{ user_id: MAYA, counts_for_streak: true }]);

    // Sam joins with Maya's code: the same day-1 question, Maya's answer locked until he answers.
    const invite = await createInvite('maya');
    await joinByCode('sam', 'maya', invite.code);
    const samCq = must(await as('sam').rpc('get_daily_question'), 'sam get_daily_question');
    expect(samCq.id).toBe(cq.id);
    expect(samCq.answer_count).toBe(1);
    const before = must(await as('sam').from('answers').select('user_id, body').eq('couple_question_id', cq.id), 'sam before');
    expect(before.map((a) => a.user_id)).not.toContain(MAYA);
    expect(JSON.stringify(before)).not.toContain(T1);
    ok(
      await as('sam').from('answers').upsert({ couple_question_id: cq.id, user_id: SAM, body: SAM_ANSWER }, { onConflict: 'couple_question_id,user_id' }),
      'sam answers',
    );
    const after = must(await as('sam').from('answers').select('user_id, body').eq('couple_question_id', cq.id), 'sam after');
    expect(after.find((a) => a.user_id === MAYA)?.body).toBe(T1);
  });

  it('ALREADY_PAIRED: a paired account that signs in again gets no second couple (the app drops T1)', async () => {
    must(await as('maya').rpc('create_couple', { p_stage: 'dating' }), 'maya couple');
    const invite = await createInvite('maya');
    await joinByCode('sam', 'maya', invite.code);
    expectCode(await as('sam').rpc('create_couple', { p_stage: 'dating', p_goals: ['deep_talks'], p_partner_name: 'Maya' }), 'ALREADY_PAIRED');
  });
});
